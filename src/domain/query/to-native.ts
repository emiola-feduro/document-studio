import { t } from '../../i18n';
import { discriminator } from '../outputs/couchdb';
import { jsLiteral, RawJs } from '../outputs/shared';
import type { EngineId, Project } from '../types';
import { condRefs, refText, type AggFn, type Cond, type Diagnostic, type QueryIR, type Ref, type Value } from './ir';
import { bindQuery, resolveRef, type Scope } from './resolve';

/**
 * Writes the query IR in each engine's own language: mongosh (find, countDocuments or an
 * aggregation pipeline) for MongoDB, a Mango _find body for CouchDB, and modular SDK code for
 * Firestore. What an engine cannot do is reported as a warning, never silently dropped.
 */

export type NativeLanguage = 'js' | 'json' | 'ts';
export type NativeResult = { text: string; language: NativeLanguage; diagnostics: Diagnostic[] };

export const NATIVE_LANGUAGE: Record<EngineId, NativeLanguage> = { mongodb: 'js', couchdb: 'json', firestore: 'ts' };

const warn = (diagnostics: Diagnostic[], message: string, pos?: Ref['pos']) => diagnostics.push({ severity: 'warning', message, pos });

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** LIKE pattern as a regular expression: 'ab%' is ^ab, '%ab%' is ab, '_' is any one character. */
export const likeToRegex = (pattern: string) => {
  let body = '';
  for (const ch of pattern) body += ch === '%' ? '.*' : ch === '_' ? '.' : escapeRegex(ch);
  const start = body.startsWith('.*') ? body.slice(2) : `^${body}`;
  return start.endsWith('.*') && !start.endsWith('\\.*') ? start.slice(0, -2) : `${start}$`;
};

const lastSegment = (path: string) => path.split('.').pop() ?? path;

/** Name an aggregate takes in the result when the SELECT gives none. */
export const aggName = (fn: AggFn, path: string) => (fn === 'count' ? 'count' : `${fn}_${lastSegment(path).replace(/\W/g, '_')}`);

type Ctx = { scopes: Scope[]; project: Project; diagnostics: Diagnostic[]; base: boolean };

/** Where a path lives in the documents the pipeline is working on. */
const mongoPath = (ctx: Ctx, ref: Ref) => {
  if (ref.path === '*') return '*';
  const target = resolveRef(ctx.scopes, ref);
  if (!target || target.scope.index === 0 || ctx.base) return ref.path;
  return `${target.scope.name}.${ref.path}`;
};

/* MongoDB */

const shellValue = (v: Value): unknown => {
  switch (v.kind) {
    case 'date':
      return new RawJs(`ISODate(${JSON.stringify(v.value)})`);
    case 'objectId':
      return new RawJs(`ObjectId(${JSON.stringify(v.value)})`);
    case 'null':
      return null;
    default:
      return v.value;
  }
};

const regexLiteral = (pattern: string, insensitive?: boolean) => new RawJs(`/${pattern.replace(/\//g, '\\/')}/${insensitive ? 'i' : ''}`);

const isPlain = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v) && !(v instanceof RawJs);
const isOperatorObject = (v: unknown) => isPlain(v) && Object.keys(v).length > 0 && Object.keys(v).every((k) => k.startsWith('$'));

/** Joins filters with AND: one object when the keys do not clash, operators of the same field merged. */
const mergeAnd = (parts: Record<string, unknown>[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const part of parts) {
    for (const [key, value] of Object.entries(part)) {
      if (!(key in out)) out[key] = value;
      else if (isOperatorObject(out[key]) && isOperatorObject(value) && Object.keys(value as object).every((k) => !(k in (out[key] as object)))) out[key] = { ...(out[key] as object), ...(value as object) };
      else return { $and: parts };
    }
  }
  return out;
};

export type ValueWriter = (v: Value) => unknown;
export type RegexWriter = (pattern: string, insensitive?: boolean) => unknown;

/** A condition as a MongoDB or Mango filter. */
export const condToFilter = (c: Cond, path: (r: Ref) => string, value: ValueWriter, regex: RegexWriter): Record<string, unknown> => {
  const f = (x: Cond) => condToFilter(x, path, value, regex);
  switch (c.op) {
    case 'and':
      return mergeAnd(c.items.map(f));
    case 'or':
      return { $or: c.items.map(f) };
    case 'not': {
      const inner = f(c.item);
      const keys = Object.keys(inner);
      if (keys.length === 1 && !keys[0].startsWith('$') && (isOperatorObject(inner[keys[0]]) || inner[keys[0]] instanceof RawJs)) return { [keys[0]]: { $not: inner[keys[0]] } };
      return { $nor: [inner] };
    }
    case 'cmp': {
      const v = value(c.value);
      const ops = { '=': '$eq', '!=': '$ne', '<': '$lt', '<=': '$lte', '>': '$gt', '>=': '$gte' } as const;
      return { [path(c.field)]: c.cmp === '=' ? v : { [ops[c.cmp]]: v } };
    }
    case 'in':
      return { [path(c.field)]: { [c.negate ? '$nin' : '$in']: c.values.map(value) } };
    case 'between': {
      const p = path(c.field);
      if (c.negate) return { $or: [{ [p]: { $lt: value(c.low) } }, { [p]: { $gt: value(c.high) } }] };
      return { [p]: { $gte: value(c.low), $lte: value(c.high) } };
    }
    case 'like':
    case 'regex': {
      const re = regex(c.op === 'like' ? likeToRegex(c.pattern) : c.pattern, c.insensitive);
      return { [path(c.field)]: c.negate ? { $not: re } : re };
    }
    case 'null':
      return { [path(c.field)]: c.negate ? { $ne: null } : null };
    case 'exists':
      return { [path(c.field)]: { $exists: !c.negate } };
  }
};

const shellName = (name: string) => (/^[A-Za-z_$][\w$]*$/.test(name) ? `db.${name}` : `db.getCollection(${JSON.stringify(name)})`);

const toMongo = (project: Project, ir: QueryIR, scopes: Scope[], diagnostics: Diagnostic[]): string => {
  const ctx: Ctx = { scopes, project, diagnostics, base: false };
  const coll = shellName(scopes[0].collection.name);
  const aggs = ir.select.filter((s) => s.kind === 'field' && s.ref.agg);
  const grouped = ir.groupBy.length > 0 || aggs.length > 0;
  const regex: RegexWriter = (p, i) => regexLiteral(p, i);

  if (!ir.joins.length && !grouped && !ir.distinct) {
    const base: Ctx = { ...ctx, base: true };
    const filter = ir.where ? condToFilter(ir.where, (r) => mongoPath(base, r), shellValue, regex) : {};
    const fields = ir.select.filter((s) => s.kind === 'field');
    const projection = ir.select.some((s) => s.kind === 'all') || !fields.length ? undefined : Object.fromEntries(fields.map((s) => (s.kind === 'field' && s.as ? [s.as, `$${s.ref.path}`] : [s.kind === 'field' ? s.ref.path : '', 1])));
    let code = `${coll}.find(${jsLiteral(filter)}${projection ? `, ${jsLiteral(projection)}` : ''})`;
    if (ir.orderBy.length) code += `\n  .sort(${jsLiteral(Object.fromEntries(ir.orderBy.map((o) => [o.ref.path, o.desc ? -1 : 1])))})`;
    if (ir.offset) code += `\n  .skip(${ir.offset})`;
    if (ir.limit) code += `\n  .limit(${ir.limit})`;
    return `${code};`;
  }
  // Only COUNT(*) and a filter: countDocuments says it best.
  if (!ir.joins.length && aggs.length === 1 && ir.select.length === 1 && !ir.groupBy.length && !ir.having && !ir.orderBy.length && !ir.limit && !ir.offset) {
    const only = ir.select[0];
    if (only.kind === 'field' && only.ref.agg === 'count' && only.ref.path === '*' && !only.as) {
      const filter = ir.where ? condToFilter(ir.where, (r) => mongoPath({ ...ctx, base: true }, r), shellValue, regex) : {};
      return `${coll}.countDocuments(${jsLiteral(filter)});`;
    }
  }

  const stages: Record<string, unknown>[] = [];
  const whereRefs = condRefs(ir.where);
  const early = whereRefs.every((r) => resolveRef(scopes, r)?.scope.index === 0);
  const match = () => (ir.where ? { $match: condToFilter(ir.where, (r) => mongoPath(ctx, r), shellValue, regex) } : undefined);
  if (early && ir.where) stages.push(match()!);
  for (const scope of scopes.slice(1)) {
    const join = scope.join!;
    const leftTarget = resolveRef(scopes, join.on.left);
    const [own, other] = leftTarget?.scope === scope ? [join.on.left, join.on.right] : [join.on.right, join.on.left];
    stages.push({ $lookup: { from: scope.collection.name, localField: mongoPath(ctx, other), foreignField: own.path, as: scope.name } });
    // SQL joins give one row per match; LEFT keeps the rows without one.
    stages.push({ $unwind: join.left ? { path: `$${scope.name}`, preserveNullAndEmptyArrays: true } : `$${scope.name}` });
  }
  if (!early && ir.where) stages.push(match()!);

  if (grouped) {
    const keyName = (r: Ref) => {
      const named = ir.select.find((s) => s.kind === 'field' && !s.ref.agg && s.ref.path === r.path && s.ref.alias === r.alias);
      return named?.kind === 'field' && named.as ? named.as : mongoPath(ctx, r).replace(/\./g, '_');
    };
    const accumulators: Record<string, unknown> = {};
    const accName = new Map<string, string>();
    const addAcc = (r: Ref, as?: string) => {
      const key = refText(r);
      if (accName.has(key)) return accName.get(key)!;
      const name = as ?? aggName(r.agg!, r.path);
      const p = `$${mongoPath(ctx, r)}`;
      accumulators[name] =
        r.agg === 'count' ? (r.path === '*' ? { $sum: 1 } : { $sum: { $cond: [{ $ne: [p, null] }, 1, 0] } }) : { [`$${r.agg}`]: p };
      accName.set(key, name);
      return name;
    };
    for (const s of ir.select) if (s.kind === 'field' && s.ref.agg) addAcc(s.ref, s.as);
    const keys = ir.groupBy.map((r) => [keyName(r), `$${mongoPath(ctx, r)}`] as const);
    const id = keys.length === 0 ? null : keys.length === 1 ? keys[0][1] : Object.fromEntries(keys);
    const havingRefs = condRefs(ir.having).filter((r) => r.agg);
    for (const r of havingRefs) addAcc(r);
    stages.push({ $group: { _id: id, ...accumulators } });
    const project: Record<string, unknown> = { _id: 0 };
    if (keys.length === 1) project[keys[0][0]] = '$_id';
    else for (const [name] of keys) project[name] = `$_id.${name}`;
    for (const name of accName.values()) project[name] = 1;
    stages.push({ $project: project });
    const named = (r: Ref) => (r.agg ? accName.get(refText(r)) ?? aggName(r.agg, r.path) : ir.groupBy.some((g) => g.path === r.path && g.alias === r.alias) ? keyName(r) : r.path);
    if (ir.having) stages.push({ $match: condToFilter(ir.having, named, shellValue, regex) });
    if (ir.orderBy.length) stages.push({ $sort: Object.fromEntries(ir.orderBy.map((o) => [named(o.ref), o.desc ? -1 : 1])) });
  } else {
    if (ir.distinct) {
      const fields = ir.select.filter((s) => s.kind === 'field');
      stages.push({ $group: { _id: Object.fromEntries(fields.map((s) => (s.kind === 'field' ? [s.as ?? mongoPath(ctx, s.ref).replace(/\./g, '_'), `$${mongoPath(ctx, s.ref)}`] : ['', '']))) } });
      stages.push({ $replaceRoot: { newRoot: '$_id' } });
    } else if (!ir.select.some((s) => s.kind === 'all' && !s.alias)) {
      const project: Record<string, unknown> = {};
      for (const s of ir.select) {
        if (s.kind === 'all') project[s.alias!] = 1;
        else if (s.as) project[s.as] = `$${mongoPath(ctx, s.ref)}`;
        else project[mongoPath(ctx, s.ref)] = 1;
      }
      stages.push({ $project: project });
    }
    if (ir.orderBy.length) stages.push({ $sort: Object.fromEntries(ir.orderBy.map((o) => [ir.select.some((s) => s.kind === 'field' && s.as === o.ref.path) ? o.ref.path : mongoPath(ctx, o.ref), o.desc ? -1 : 1])) });
  }
  if (ir.offset) stages.push({ $skip: ir.offset });
  if (ir.limit) stages.push({ $limit: ir.limit });
  return `${coll}.aggregate(${jsLiteral(stages)});`;
};

/* CouchDB */

const mangoValue = (v: Value): unknown => (v.kind === 'null' ? null : v.value);

const toCouch = (ir: QueryIR, scopes: Scope[], diagnostics: Diagnostic[]): string => {
  const root = scopes[0].collection;
  const ctx: Ctx = { scopes, project: undefined as never, diagnostics, base: true };
  for (const j of ir.joins) warn(diagnostics, t('qe.couchJoin', { collection: j.collection }), j.pos);
  if (ir.groupBy.length || ir.select.some((s) => s.kind === 'field' && s.ref.agg)) warn(diagnostics, t('qe.couchGroup'));
  if (ir.distinct) warn(diagnostics, t('qe.noDistinct', { engine: 'CouchDB' }));
  const { field: typeField, value: typeValue } = discriminator(root);
  const filter = ir.where ? condToFilter(ir.where, (r) => mongoPath(ctx, r), mangoValue, (p, i) => ({ $regex: i ? `(?i)${p}` : p })) : {};
  const selector = typeField in filter ? { $and: [{ [typeField]: typeValue }, filter] } : { [typeField]: typeValue, ...filter };
  const body: Record<string, unknown> = { selector };
  const fields = ir.select.filter((s) => s.kind === 'field' && !s.ref.agg);
  if (fields.length && !ir.select.some((s) => s.kind === 'all')) body.fields = fields.map((s) => (s.kind === 'field' ? s.ref.path : ''));
  if (ir.select.some((s) => s.kind === 'field' && s.as)) warn(diagnostics, t('qe.noRename', { engine: 'CouchDB' }));
  if (ir.orderBy.length) {
    body.sort = ir.orderBy.map((o) => ({ [o.ref.path]: o.desc ? 'desc' : 'asc' }));
    warn(diagnostics, t('qe.mangoSortIndex', { fields: ir.orderBy.map((o) => o.ref.path).join(', ') }));
  }
  if (ir.limit) body.limit = ir.limit;
  if (ir.offset) body.skip = ir.offset;
  return JSON.stringify(body, null, 2);
};

/* Firestore */

const FS_OPS: Record<string, string> = { '=': '==', '!=': '!=', '<': '<', '<=': '<=', '>': '>', '>=': '>=' };

const toFirestore = (project: Project, ir: QueryIR, scopes: Scope[], diagnostics: Diagnostic[]): string => {
  const root = scopes[0].collection;
  for (const j of ir.joins) warn(diagnostics, t('qe.firestoreJoin', { collection: j.collection }), j.pos);
  if (ir.groupBy.length) warn(diagnostics, t('qe.firestoreGroup'));
  if (ir.distinct) warn(diagnostics, t('qe.noDistinct', { engine: 'Firestore' }));
  if (ir.offset) warn(diagnostics, t('query.firestoreSkip'));
  const value = (v: Value, r: Ref): unknown => {
    const target = resolveRef(scopes, r);
    const field = target?.field?.type === 'array' ? target.field.items : target?.field;
    if (v.kind === 'date') return new RawJs(`Timestamp.fromDate(new Date(${JSON.stringify(v.value)}))`);
    if (field?.type === 'reference' && (v.kind === 'string' || v.kind === 'objectId')) {
      const targetColl = project.collections.find((c) => c.id === field.reference?.collectionId);
      if (targetColl) return new RawJs(`doc(db, ${JSON.stringify(targetColl.name)}, ${JSON.stringify(v.value)})`);
    }
    return v.kind === 'null' ? null : v.value;
  };
  const w = (r: Ref, op: string, v: unknown) => `where(${JSON.stringify(r.path)}, ${JSON.stringify(op)}, ${jsLiteral(v)})`;
  const render = (c: Cond, indent: string): string[] => {
    switch (c.op) {
      case 'and':
      case 'or': {
        const parts = c.items.flatMap((i) => render(i, `${indent}  `));
        if (c.op === 'and' && !c.items.some((i) => i.op === 'or')) return parts;
        return [`${c.op}(\n${parts.map((p) => `${indent}  ${p}`).join(',\n')}\n${indent})`];
      }
      case 'cmp':
        return [w(c.field, FS_OPS[c.cmp], value(c.value, c.field))];
      case 'in':
        if (c.values.length > 30) warn(diagnostics, t('qe.firestoreInLimit'), c.field.pos);
        return [w(c.field, c.negate ? 'not-in' : resolveRef(scopes, c.field)?.field?.type === 'array' ? 'array-contains-any' : 'in', c.values.map((v) => value(v, c.field)))];
      case 'between':
        if (c.negate) return [`or(${w(c.field, '<', value(c.low, c.field))}, ${w(c.field, '>', value(c.high, c.field))})`];
        return [w(c.field, '>=', value(c.low, c.field)), w(c.field, '<=', value(c.high, c.field))];
      case 'like': {
        const prefix = /^([^%_]+)%$/.exec(c.pattern)?.[1];
        if (prefix && !c.negate && !c.insensitive) {
          warn(diagnostics, t('qe.firestorePrefix', { path: c.field.path }), c.field.pos);
          return [w(c.field, '>=', prefix), w(c.field, '<', `${prefix}`)];
        }
        warn(diagnostics, t('qe.firestoreLike', { path: c.field.path }), c.field.pos);
        return [];
      }
      case 'regex':
        warn(diagnostics, t('qe.firestoreLike', { path: c.field.path }), c.field.pos);
        return [];
      case 'null':
        return [w(c.field, c.negate ? '!=' : '==', null)];
      case 'exists':
        if (c.negate) {
          warn(diagnostics, t('qe.firestoreMissing', { path: c.field.path }), c.field.pos);
          return [];
        }
        return [w(c.field, '!=', null)];
      case 'not': {
        const inner = c.item;
        if (inner.op === 'cmp' && (inner.cmp === '=' || inner.cmp === '!=')) return [w(inner.field, inner.cmp === '=' ? '!=' : '==', value(inner.value, inner.field))];
        if (inner.op === 'in') return [w(inner.field, inner.negate ? 'in' : 'not-in', inner.values.map((v) => value(v, inner.field)))];
        warn(diagnostics, t('qe.firestoreNot'));
        return [];
      }
    }
  };
  const constraints = ir.where ? render(ir.where, '  ') : [];
  const negatives = constraints.filter((c) => /"(!=|not-in)"/.test(c)).length;
  if (negatives > 1) warn(diagnostics, t('qe.firestoreOneNegative'));
  for (const o of ir.orderBy) constraints.push(`orderBy(${JSON.stringify(o.ref.path)}${o.desc ? ', "desc"' : ''})`);
  if (ir.limit) constraints.push(`limit(${ir.limit})`);
  const source = root.kind === 'subcollection' ? `collectionGroup(db, ${JSON.stringify(root.name)})` : `collection(db, ${JSON.stringify(root.name)})`;
  const q = `query(\n  ${[source, ...constraints].join(',\n  ')}\n)`;
  const aggs = ir.select.filter((s) => s.kind === 'field' && s.ref.agg);
  if (aggs.length && !ir.groupBy.length) {
    const spec: string[] = [];
    for (const s of aggs) {
      if (s.kind !== 'field') continue;
      const name = s.as ?? aggName(s.ref.agg!, s.ref.path);
      if (s.ref.agg === 'count') spec.push(`${name}: count()`);
      else if (s.ref.agg === 'sum') spec.push(`${name}: sum(${JSON.stringify(s.ref.path)})`);
      else if (s.ref.agg === 'avg') spec.push(`${name}: average(${JSON.stringify(s.ref.path)})`);
      else warn(diagnostics, t('qe.firestoreMinMax', { fn: s.ref.agg!.toUpperCase() }), s.ref.pos);
    }
    return `getAggregateFromServer(${q.replace(/\n/g, '\n  ')}, { ${spec.join(', ')} })`;
  }
  if (ir.select.some((s) => s.kind === 'field')) warn(diagnostics, t('query.firestoreProjection'));
  return q;
};

/** The query in the project engine's language, with what does not translate as warnings. */
export const toNative = (project: Project, ir: QueryIR): NativeResult => {
  const bound = bindQuery(project, ir);
  const language = NATIVE_LANGUAGE[project.engine];
  if (!bound.scopes.length) return { text: '', language, diagnostics: bound.diagnostics };
  const diagnostics = [...bound.diagnostics];
  const text =
    project.engine === 'mongodb'
      ? toMongo(project, bound.ir, bound.scopes, diagnostics)
      : project.engine === 'couchdb'
        ? toCouch(bound.ir, bound.scopes, diagnostics)
        : toFirestore(project, bound.ir, bound.scopes, diagnostics);
  for (const note of bound.ir.untranslated ?? []) warn(diagnostics, t('qe.untranslated', { part: note }));
  return { text, language, diagnostics };
};
