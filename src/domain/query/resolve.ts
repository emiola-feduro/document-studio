import { t } from '../../i18n';
import { displayType } from '../outputs/json-schema';
import { fieldAtPath, toMongoPath, walkFields } from '../paths';
import type { Collection, Field, Project } from '../types';
import type { Cond, Diagnostic, Join, QueryIR, Ref, Value } from './ir';

/**
 * Binds a query to the model: which collection each alias stands for, which field each path is,
 * and what is wrong (unknown names with the closest one as a fix, undeclared aliases, operators that
 * do not fit the field type). Values are converted to the field type, so text compared with an
 * objectId field becomes an ObjectId and text compared with a date becomes a date.
 */

export type Scope = { name: string; collection: Collection; join?: Join; index: number };

export type Bound = { ir: QueryIR; scopes: Scope[]; diagnostics: Diagnostic[] };

const NUMBERS = new Set(['int', 'long', 'double', 'decimal', 'number']);
const VIRTUAL = new Set(['_id', '__name__']);

export const distance = (a: string, b: string) => {
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j += 1) d[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[m][n];
};

/** The candidate closest to a misspelled name, when it is close enough to be a typo. */
export const closest = (name: string, candidates: string[]) => {
  const lower = name.toLowerCase();
  let best: string | undefined;
  let score = Infinity;
  for (const c of candidates) {
    const s = c.toLowerCase() === lower ? 0 : distance(lower, c.toLowerCase());
    if (s < score) {
      score = s;
      best = c;
    }
  }
  return best && score <= Math.max(2, Math.floor(name.length / 3)) ? best : undefined;
};

export const pathsOf = (collection: Collection) => ['_id', ...walkFields(collection.fields).map((e) => toMongoPath(e.path)).filter((p) => p !== '_id')];

export const fieldOf = (collection: Collection, path: string): Field | undefined => {
  if (path === '__name__') return { id: '__name__', name: '__name__', type: 'string', required: true, nullable: false };
  return fieldAtPath(collection.fields, path);
};

export const findCollection = (project: Project, name: string) => project.collections.find((c) => c.name === name) ?? project.collections.find((c) => c.name.toLowerCase() === name.toLowerCase());

export type RefTarget = { scope: Scope; field?: Field };

/** Which collection and field a reference reads: by its alias, or the first collection that has the path. */
export const resolveRef = (scopes: Scope[], ref: Ref): RefTarget | undefined => {
  if (ref.alias) {
    const scope = scopes.find((s) => s.name === ref.alias) ?? scopes.find((s) => s.collection.name === ref.alias);
    return scope ? { scope, field: fieldOf(scope.collection, ref.path) } : undefined;
  }
  for (const scope of scopes) {
    const field = fieldOf(scope.collection, ref.path);
    if (field || VIRTUAL.has(ref.path)) return { scope, field };
  }
  return scopes[0] ? { scope: scopes[0], field: undefined } : undefined;
};

const coerce = (value: Value, field: Field | undefined): Value => {
  if (!field || value.kind !== 'string') return value;
  const holder = field.type === 'array' ? field.items : field;
  const type = holder?.type;
  if ((type === 'objectId' || (type === 'reference' && /^[a-f0-9]{24}$/i.test(value.value))) && /^[a-f0-9]{24}$/i.test(value.value)) return { kind: 'objectId', value: value.value, pos: value.pos };
  if ((type === 'date' || type === 'timestamp') && !Number.isNaN(Date.parse(value.value))) return { kind: 'date', value: value.value, pos: value.pos };
  return value;
};

export const bindQuery = (project: Project, source: QueryIR): Bound => {
  const ir: QueryIR = structuredClone(source);
  const diagnostics: Diagnostic[] = [];
  const names = project.collections.map((c) => c.name);
  const scopes: Scope[] = [];
  const addScope = (name: string, alias: string | undefined, pos: Join['pos'], join?: Join) => {
    const collection = findCollection(project, name);
    if (!collection) {
      const guess = closest(name, names);
      diagnostics.push({ severity: 'error', message: t('qe.unknownCollection', { name }), pos, ...(guess ? { fix: { label: t('qe.didYouMean', { name: guess }), text: guess } } : {}) });
      return;
    }
    scopes.push({ name: alias ?? collection.name, collection, join, index: scopes.length });
  };
  addScope(ir.from.collection, ir.from.alias, ir.from.pos);
  for (const join of ir.joins) addScope(join.collection, join.alias, join.collectionPos, join);
  if (!scopes.length) return { ir, scopes, diagnostics };

  const selectAliases = new Set(ir.select.flatMap((s) => (s.kind === 'field' && s.as ? [s.as] : [])));
  const check = (ref: Ref, allowSelectAlias = false): RefTarget | undefined => {
    if (ref.path === '*') return undefined;
    if (allowSelectAlias && !ref.alias && selectAliases.has(ref.path)) return undefined;
    if (ref.alias && !scopes.some((s) => s.name === ref.alias || s.collection.name === ref.alias)) {
      const guess = closest(ref.alias, scopes.map((s) => s.name));
      const pos = ref.pos ? { start: ref.pos.start + (ref.agg ? ref.agg.length + 1 : 0), end: ref.pos.start + (ref.agg ? ref.agg.length + 1 : 0) + ref.alias.length } : undefined;
      diagnostics.push({ severity: 'error', message: t('qe.unknownAlias', { alias: ref.alias }), pos, ...(guess ? { fix: { label: t('qe.didYouMean', { name: guess }), text: guess } } : {}) });
      return undefined;
    }
    // `x.nombre` where x is neither an alias nor a field: x is an alias that was never declared.
    const head = ref.path.split('.')[0];
    if (!ref.alias && head !== ref.path && !scopes.some((s) => fieldOf(s.collection, ref.path) || fieldOf(s.collection, head))) {
      const guess = closest(head, scopes.map((s) => s.name));
      const start = ref.pos ? ref.pos.start + (ref.agg ? ref.agg.length + 1 : 0) : 0;
      diagnostics.push({ severity: 'error', message: t('qe.unknownAlias', { alias: head }), pos: ref.pos ? { start, end: start + head.length } : undefined, ...(guess ? { fix: { label: t('qe.didYouMean', { name: guess }), text: guess } } : {}) });
      return undefined;
    }
    const target = resolveRef(scopes, ref);
    if (!target) return undefined;
    if (!target.field && !VIRTUAL.has(ref.path)) {
      const candidates = ref.alias ? pathsOf(target.scope.collection) : scopes.flatMap((s) => pathsOf(s.collection));
      const guess = closest(ref.path, candidates);
      // The underline covers the path only, after the alias.
      const start = ref.pos ? ref.pos.start + (ref.agg ? ref.agg.length + 1 : 0) + (ref.alias ? ref.alias.length + 1 : 0) : 0;
      diagnostics.push({
        severity: 'error',
        message: t('qe.unknownField', { path: ref.path, collection: target.scope.collection.name }),
        pos: ref.pos ? { start, end: start + ref.path.length } : undefined,
        ...(guess ? { fix: { label: t('qe.didYouMean', { name: guess }), text: guess } } : {}),
      });
    }
    if (ref.agg && ref.agg !== 'count' && ref.agg !== 'min' && ref.agg !== 'max' && target.field && !NUMBERS.has(target.field.type)) {
      diagnostics.push({ severity: 'warning', message: t('qe.aggType', { fn: ref.agg.toUpperCase(), path: ref.path, type: target.field.type }), pos: ref.pos });
    }
    return target;
  };

  const walk = (c: Cond | undefined, having = false) => {
    if (!c) return;
    if (c.op === 'and' || c.op === 'or') return c.items.forEach((i) => walk(i, having));
    if (c.op === 'not') return walk(c.item, having);
    const target = check(c.field, having);
    const field = target?.field;
    const type = field ? displayType(project.engine, field) : undefined;
    if (c.op === 'like' && field && !['string', 'enum', 'uuid', 'objectId', 'reference'].includes(field.type)) {
      diagnostics.push({ severity: 'warning', message: t('qe.likeType', { path: c.field.path, type: type! }), pos: c.field.pos });
    }
    if ((c.op === 'between' || (c.op === 'cmp' && ['<', '<=', '>', '>='].includes(c.cmp))) && field && ['bool', 'object', 'array'].includes(field.type)) {
      diagnostics.push({ severity: 'warning', message: t('qe.rangeType', { path: c.field.path, type: type! }), pos: c.field.pos });
    }
    if (c.op === 'cmp') c.value = coerce(c.value, field);
    if (c.op === 'in') c.values = c.values.map((v) => coerce(v, field));
    if (c.op === 'between') {
      c.low = coerce(c.low, field);
      c.high = coerce(c.high, field);
    }
  };

  for (const s of ir.select) {
    if (s.kind === 'field') check(s.ref);
    else if (s.alias && !scopes.some((x) => x.name === s.alias)) diagnostics.push({ severity: 'error', message: t('qe.unknownAlias', { alias: s.alias }) });
  }
  for (const j of ir.joins) {
    check(j.on.left);
    check(j.on.right);
  }
  walk(ir.where);
  ir.groupBy.forEach((r) => check(r));
  walk(ir.having, true);
  ir.orderBy.forEach((o) => check(o.ref, true));
  return { ir, scopes, diagnostics };
};
