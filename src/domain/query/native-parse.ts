import { t } from '../../i18n';
import { balancedArgs, entry, JsParser, parseArgs, type JsValue } from '../import/js-literal';
import { discriminator } from '../outputs/couchdb';
import type { Project } from '../types';
import type { AggFn, Comparison, Cond, Diagnostic, Join, QueryIR, Ref, SelectItem, Value } from './ir';

/**
 * Reads a native query back into the IR: mongosh find, countDocuments and aggregate for MongoDB, a
 * Mango _find body for CouchDB, and modular SDK calls for Firestore. What has no SQL form is kept
 * as a note ($facet, $graphLookup, $lookup with a pipeline, $expr...) and reported as a warning.
 */

export type NativeParse = { ir?: QueryIR; diagnostics: Diagnostic[] };

class NativeError extends Error {}

const and = (items: Cond[]): Cond | undefined => (items.length === 0 ? undefined : items.length === 1 ? items[0] : { op: 'and', items: items.flatMap((c) => (c.op === 'and' ? c.items : [c])) });

const andWith = (a: Cond | undefined, b: Cond | undefined) => and([a, b].filter((x): x is Cond => Boolean(x)));

/** A regular expression as a LIKE pattern, when it is only text with anchors, `.` and `.*`. */
export const regexToLike = (source: string): string | undefined => {
  let s = source;
  const start = s.startsWith('^');
  if (start) s = s.slice(1);
  const end = s.endsWith('$') && !s.endsWith('\\$');
  if (end) s = s.slice(0, -1);
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === '\\') {
      const next = s[i + 1];
      if (next === undefined || /[A-Za-z0-9]/.test(next)) return undefined;
      if (next === '%' || next === '_') return undefined;
      out += next;
      i += 1;
    } else if (ch === '.' && s[i + 1] === '*') {
      out += '%';
      i += 1;
    } else if (ch === '.') out += '_';
    else if ('()[]{}|+?*^$'.includes(ch)) return undefined;
    else if (ch === '%' || ch === '_') return undefined;
    else out += ch;
  }
  return `${start ? '' : '%'}${out}${end ? '' : '%'}`.replace(/^%%$/, '%');
};

const valueOf = (v: JsValue): Value | undefined => {
  switch (v.kind) {
    case 'string':
      return { kind: 'string', value: v.value };
    case 'number':
      return { kind: 'number', value: v.value };
    case 'bool':
      return { kind: 'bool', value: v.value };
    case 'null':
      return { kind: 'null' };
    case 'call': {
      const name = v.callee.split('.').pop()!.toLowerCase();
      const arg = v.args[0];
      if (name === 'objectid' && arg?.kind === 'string') return { kind: 'objectId', value: arg.value };
      if ((name === 'isodate' || name === 'date') && arg?.kind === 'string') return { kind: 'date', value: arg.value };
      if (name === 'fromdate' && arg) return valueOf(arg);
      // doc(db, "clientes", "id") is a reference: its id is what SQL compares.
      if (name === 'doc' && v.args.length >= 3 && v.args[v.args.length - 1].kind === 'string') return { kind: 'string', value: (v.args[v.args.length - 1] as { value: string }).value };
      return undefined;
    }
    case 'object': {
      const oid = entry(v, '$oid');
      const date = entry(v, '$date');
      if (oid?.kind === 'string') return { kind: 'objectId', value: oid.value };
      if (date?.kind === 'string') return { kind: 'date', value: date.value };
      return undefined;
    }
    default:
      return undefined;
  }
};

type Reader = { ref: (path: string) => Ref; notes: string[]; diagnostics: Diagnostic[] };

const regexCond = (field: Ref, source: string, insensitive: boolean, negate: boolean, r: Reader): Cond => {
  const like = regexToLike(source);
  if (like !== undefined) return { op: 'like', field, pattern: like, ...(negate ? { negate } : {}), ...(insensitive ? { insensitive } : {}) };
  r.diagnostics.push({ severity: 'info', message: t('qe.regexKept', { pattern: source }) });
  return { op: 'regex', field, pattern: source, ...(negate ? { negate } : {}), ...(insensitive ? { insensitive } : {}) };
};

const CMP: Record<string, Comparison> = { $eq: '=', $ne: '!=', $gt: '>', $gte: '>=', $lt: '<', $lte: '<=' };

/** A MongoDB or Mango filter as a condition. */
const filterToCond = (v: JsValue, r: Reader): Cond | undefined => {
  if (v.kind !== 'object') return undefined;
  const items: Cond[] = [];
  for (const [key, value] of v.entries) {
    if (key === '$and' || key === '$or' || key === '$nor') {
      const parts = value.kind === 'array' ? value.items.map((x) => filterToCond(x, r)).filter((x): x is Cond => Boolean(x)) : [];
      if (key === '$and') items.push(...(and(parts) ? [and(parts)!] : []));
      else if (key === '$or') items.push(parts.length === 1 ? parts[0] : { op: 'or', items: parts });
      else items.push({ op: 'not', item: parts.length === 1 ? parts[0] : { op: 'or', items: parts } });
      continue;
    }
    if (key.startsWith('$')) {
      r.notes.push(key);
      continue;
    }
    items.push(...fieldConds(key, value, r));
  }
  return and(items);
};

const fieldConds = (key: string, value: JsValue, r: Reader): Cond[] => {
  const field = r.ref(key);
  if (value.kind === 'regex') {
    return [regexCond(field, value.source, value.flags.includes('i'), false, r)];
  }
  const plain = valueOf(value);
  if (plain) return [plain.kind === 'null' ? { op: 'null', field } : { op: 'cmp', field, cmp: '=', value: plain }];
  if (value.kind !== 'object' || !value.entries.every(([k]) => k.startsWith('$'))) {
    r.notes.push(`${key}: { ... }`);
    return [];
  }
  const out: Cond[] = [];
  const options = entry(value, '$options');
  for (const [op, operand] of value.entries) {
    if (op === '$options') continue;
    if (CMP[op]) {
      const val = valueOf(operand);
      if (!val) r.notes.push(`${key}.${op}`);
      else if (val.kind === 'null' && (op === '$eq' || op === '$ne')) out.push({ op: 'null', field, ...(op === '$ne' ? { negate: true } : {}) });
      else out.push({ op: 'cmp', field, cmp: CMP[op], value: val });
    } else if (op === '$in' || op === '$nin') {
      const values = operand.kind === 'array' ? operand.items.map(valueOf).filter((x): x is Value => Boolean(x)) : [];
      out.push({ op: 'in', field, values, ...(op === '$nin' ? { negate: true } : {}) });
    } else if (op === '$exists') {
      out.push({ op: 'exists', field, ...(operand.kind === 'bool' && !operand.value ? { negate: true } : {}) });
    } else if (op === '$regex') {
      const source = operand.kind === 'string' ? operand.value : operand.kind === 'regex' ? operand.source : '';
      const insensitive = (options?.kind === 'string' && options.value.includes('i')) || source.startsWith('(?i)');
      out.push(regexCond(field, source.replace(/^\(\?i\)/, ''), insensitive, false, r));
    } else if (op === '$not') {
      if (operand.kind === 'regex') out.push(regexCond(field, operand.source, operand.flags.includes('i'), true, r));
      else {
        const inner = fieldConds(key, operand, r);
        if (inner.length) out.push({ op: 'not', item: and(inner)! });
      }
    } else if (op === '$elemMatch' && operand.kind === 'object') {
      // Conditions on the elements read as conditions on their paths.
      r.diagnostics.push({ severity: 'info', message: t('qe.elemMatch', { path: key }) });
      for (const [sub, x] of operand.entries) out.push(...(sub.startsWith('$') ? fieldConds(key, { kind: 'object', entries: [[sub, x]] }, r) : fieldConds(`${key}.${sub}`, x, r)));
    } else r.notes.push(`${key}.${op}`);
  }
  return out;
};

/** A key of the documents in the pipeline: the joined documents live under their `as`. */
const refReader = (aliases: () => string[]) => (path: string): Ref => {
  const [head, ...rest] = path.split('.');
  return rest.length && aliases().includes(head) ? { alias: head, path: rest.join('.') } : { path };
};

const fieldPath = (v: JsValue | undefined) => (v?.kind === 'string' && v.value.startsWith('$') ? v.value.slice(1) : undefined);

/* MongoDB */

const parseMongo = (text: string): NativeParse => {
  const diagnostics: Diagnostic[] = [];
  const at = text.search(/\bdb\s*\./);
  if (at < 0) throw new NativeError(t('qe.expectedDb'));
  let i = text.indexOf('.', at) + 1;
  const ws = () => {
    while (/\s/.test(text[i] ?? '')) i += 1;
  };
  ws();
  let collection: string;
  if (text.startsWith('getCollection', i)) {
    const open = text.indexOf('(', i);
    const inside = balancedArgs(text, open);
    const [name] = inside === undefined ? [] : parseArgs(inside);
    if (name?.kind !== 'string') throw new NativeError(t('qe.expectedCollection'));
    collection = name.value;
    i = open + inside!.length + 2;
  } else {
    const m = /^[A-Za-z_$][\w$]*/.exec(text.slice(i));
    if (!m) throw new NativeError(t('qe.expectedCollection'));
    collection = m[0];
    i += m[0].length;
  }
  const calls: { method: string; args: JsValue[] }[] = [];
  for (;;) {
    ws();
    if (text[i] !== '.') break;
    i += 1;
    ws();
    const m = /^[A-Za-z_$][\w$]*/.exec(text.slice(i));
    if (!m) throw new NativeError(t('qe.expectedMethod'));
    i += m[0].length;
    ws();
    if (text[i] !== '(') throw new NativeError(t('qe.expectedKeyword', { keyword: '(' }));
    const inside = balancedArgs(text, i);
    if (inside === undefined) throw new NativeError(t('qe.unclosed'));
    calls.push({ method: m[0], args: parseArgs(inside) });
    i += inside.length + 2;
  }
  if (!calls.length) throw new NativeError(t('qe.expectedMethod'));
  const ir: QueryIR = { from: { collection }, joins: [], select: [], groupBy: [], orderBy: [] };
  const notes: string[] = [];
  const [first, ...rest] = calls;
  const r: Reader = { ref: refReader(() => ir.joins.map((j) => j.alias!)), notes, diagnostics };
  if (first.method === 'find' || first.method === 'findOne' || first.method === 'countDocuments' || first.method === 'count') {
    ir.where = first.args[0] ? filterToCond(first.args[0], r) : undefined;
    if (first.method.startsWith('count')) ir.select.push({ kind: 'field', ref: { path: '*', agg: 'count' } });
    else readProjection(first.args[1], ir, r);
    if (first.method === 'findOne') ir.limit = 1;
    for (const call of rest) {
      const arg = call.args[0];
      if (call.method === 'sort' && arg?.kind === 'object') ir.orderBy = arg.entries.map(([k, v]) => ({ ref: r.ref(k), desc: v.kind === 'number' && v.value < 0 }));
      else if (call.method === 'limit' && arg?.kind === 'number') ir.limit = arg.value;
      else if (call.method === 'skip' && arg?.kind === 'number') ir.offset = arg.value;
      else notes.push(`.${call.method}()`);
    }
    if (!ir.select.length) ir.select.push({ kind: 'all' });
  } else if (first.method === 'aggregate') {
    const pipeline = first.args[0];
    if (pipeline?.kind !== 'array') throw new NativeError(t('qe.expectedPipeline'));
    readPipeline(pipeline.items, ir, r);
  } else throw new NativeError(t('qe.unsupportedMethod', { method: first.method }));
  if (notes.length) ir.untranslated = [...new Set(notes)];
  return { ir, diagnostics };
};

const readProjection = (v: JsValue | undefined, ir: QueryIR, r: Reader) => {
  if (v?.kind !== 'object' || !v.entries.length) return;
  for (const [key, value] of v.entries) {
    if (key === '_id' && value.kind === 'number' && value.value === 0) continue;
    const from = fieldPath(value);
    if (from) ir.select.push({ kind: 'field', ref: r.ref(from), as: key });
    else if ((value.kind === 'number' && value.value) || (value.kind === 'bool' && value.value)) {
      // A whole joined document reads as alias.*.
      if (ir.joins.some((j) => j.alias === key)) ir.select.push({ kind: 'all', alias: key });
      else ir.select.push({ kind: 'field', ref: r.ref(key) });
    } else r.notes.push(`$project.${key}`);
  }
};

const ACCS: Record<string, AggFn> = { $sum: 'sum', $avg: 'avg', $min: 'min', $max: 'max' };

const readPipeline = (stages: JsValue[], ir: QueryIR, r: Reader) => {
  let grouped = false;
  const groupKeys = new Map<string, Ref>();
  const accs = new Map<string, Ref>();
  const named = (name: string): Ref => accs.get(name) ?? groupKeys.get(name) ?? { path: name };
  const select: SelectItem[] = [];
  for (let k = 0; k < stages.length; k += 1) {
    const stage = stages[k];
    if (stage.kind !== 'object' || stage.entries.length !== 1) {
      r.notes.push('stage');
      continue;
    }
    const [name, body] = stage.entries[0];
    if (name === '$match') {
      if (grouped) {
        const cond = filterToCond(body, { ...r, ref: named });
        ir.having = andWith(ir.having, cond);
      } else ir.where = andWith(ir.where, filterToCond(body, r));
    } else if (name === '$lookup') {
      const from = entry(body, 'from');
      const local = entry(body, 'localField');
      const foreign = entry(body, 'foreignField');
      const as = entry(body, 'as');
      if (entry(body, 'pipeline') || from?.kind !== 'string' || local?.kind !== 'string' || foreign?.kind !== 'string' || as?.kind !== 'string') {
        r.notes.push('$lookup { pipeline }');
        continue;
      }
      const join: Join = { collection: from.value, alias: as.value, on: { left: r.ref(local.value), right: { alias: as.value, path: foreign.value } }, left: true };
      const next = stages[k + 1];
      const unwind = next?.kind === 'object' && next.entries[0]?.[0] === '$unwind' ? next.entries[0][1] : undefined;
      const unwindPath = unwind?.kind === 'string' ? unwind.value : fieldPath(entry(unwind, 'path')) ? `$${fieldPath(entry(unwind, 'path'))}` : undefined;
      if (unwindPath === `$${as.value}`) {
        const preserve = entry(unwind, 'preserveNullAndEmptyArrays');
        join.left = preserve?.kind === 'bool' && preserve.value;
        k += 1;
      } else r.diagnostics.push({ severity: 'info', message: t('qe.lookupArray', { as: as.value }) });
      ir.joins.push(join);
    } else if (name === '$group') {
      grouped = true;
      const id = entry(body, '_id');
      if (id?.kind === 'object') {
        for (const [key, v] of id.entries) {
          const p = fieldPath(v);
          if (p) groupKeys.set(key, r.ref(p));
        }
      } else if (fieldPath(id)) groupKeys.set(fieldPath(id)!.replace(/\./g, '_'), r.ref(fieldPath(id)!));
      // A group on an object _id with no accumulators, then $replaceRoot, is SELECT DISTINCT.
      const next = stages[k + 1];
      const accEntries = body.kind === 'object' ? body.entries.filter(([key]) => key !== '_id') : [];
      if (!accEntries.length && id?.kind === 'object' && next?.kind === 'object' && next.entries[0]?.[0] === '$replaceRoot') {
        ir.distinct = true;
        grouped = false;
        for (const [key, ref] of groupKeys) select.push({ kind: 'field', ref, ...(key !== ref.path.replace(/\./g, '_') ? { as: key } : {}) });
        groupKeys.clear();
        k += 1;
        continue;
      }
      ir.groupBy = [...groupKeys.values()];
      for (const [key, acc] of accEntries) {
        const op = acc.kind === 'object' ? acc.entries[0] : undefined;
        if (!op) continue;
        let ref: Ref | undefined;
        if (op[0] === '$sum' && op[1].kind === 'number' && op[1].value === 1) ref = { path: '*', agg: 'count' };
        else if (op[0] === '$sum' && op[1].kind === 'object' && entry(op[1], '$cond')) {
          const cond = entry(op[1], '$cond');
          const ne = cond?.kind === 'array' ? entry(cond.items[0], '$ne') : undefined;
          const p = ne?.kind === 'array' ? fieldPath(ne.items[0]) : undefined;
          if (p) ref = { ...r.ref(p), agg: 'count' };
        } else if (op[0] === '$count') ref = { path: '*', agg: 'count' };
        else if (ACCS[op[0]] && fieldPath(op[1])) ref = { ...r.ref(fieldPath(op[1])!), agg: ACCS[op[0]] };
        if (ref) accs.set(key, ref);
        else r.notes.push(`$group.${key}`);
      }
    } else if (name === '$project' && grouped) {
      if (body.kind !== 'object') continue;
      for (const [key, v] of body.entries) {
        if (key === '_id') continue;
        const p = fieldPath(v);
        if (p === '_id' || p?.startsWith('_id.')) {
          const ref = p === '_id' ? [...groupKeys.values()][0] : groupKeys.get(p.slice(4));
          if (!ref) continue;
          groupKeys.delete([...groupKeys].find(([, x]) => x === ref)![0]);
          groupKeys.set(key, ref);
          select.push({ kind: 'field', ref, ...(key !== ref.path.replace(/\./g, '_') ? { as: key } : {}) });
        } else if (accs.has(key)) {
          const ref = accs.get(key)!;
          select.push({ kind: 'field', ref, ...(key !== aggDefault(ref) ? { as: key } : {}) });
        }
      }
    } else if (name === '$project') readProjection(body, Object.assign(ir, { select }), r);
    else if (name === '$sort' && body.kind === 'object') ir.orderBy = body.entries.map(([key, v]) => {
        // A named aggregate is sorted by its name, as SQL writes it.
        const acc = accs.get(key);
        const ref = grouped ? (acc && key !== aggDefault(acc) ? { path: key } : named(key)) : r.ref(key);
        return { ref, desc: v.kind === 'number' && v.value < 0 };
      });
    else if (name === '$skip' && body.kind === 'number') ir.offset = body.value;
    else if (name === '$limit' && body.kind === 'number') ir.limit = body.value;
    else if (name === '$count' && body.kind === 'string') select.splice(0, select.length, { kind: 'field', ref: { path: '*', agg: 'count' }, as: body.value });
    else r.notes.push(name);
  }
  // Accumulators not listed in a $project are still part of the result.
  if (grouped && !select.length) {
    for (const [key, ref] of groupKeys) select.push({ kind: 'field', ref, ...(key !== ref.path.replace(/\./g, '_') ? { as: key } : {}) });
    for (const [key, ref] of accs) select.push({ kind: 'field', ref, ...(key !== aggDefault(ref) ? { as: key } : {}) });
  }
  ir.select = select.length ? select : [{ kind: 'all' }];
};

const aggDefault = (ref: Ref) => (ref.agg === 'count' ? 'count' : `${ref.agg}_${ref.path.split('.').pop()!.replace(/\W/g, '_')}`);

/* CouchDB */

const parseCouch = (project: Project, text: string): NativeParse => {
  const diagnostics: Diagnostic[] = [];
  const body = new JsParser(text.trim()).value();
  if (body.kind !== 'object') throw new NativeError(t('qe.expectedMango'));
  const selector = entry(body, 'selector');
  if (selector?.kind !== 'object') throw new NativeError(t('qe.expectedMango'));
  // The type field says which "collection" the documents belong to.
  let collection: string | undefined;
  const rest: [string, JsValue][] = [];
  const parts = selector.entries.length === 1 && selector.entries[0][0] === '$and' && selector.entries[0][1].kind === 'array' ? selector.entries[0][1].items.flatMap((x) => (x.kind === 'object' ? x.entries : [])) : selector.entries;
  for (const [key, value] of parts) {
    const match = !collection && value.kind === 'string' ? project.collections.find((c) => discriminator(c).field === key && discriminator(c).value === value.value) : undefined;
    if (match) collection = match.name;
    else rest.push([key, value]);
  }
  if (!collection) {
    diagnostics.push({ severity: 'error', message: t('qe.couchNoType') });
    collection = project.collections[0]?.name ?? '';
  }
  const notes: string[] = [];
  const r: Reader = { ref: (path) => ({ path }), notes, diagnostics };
  const ir: QueryIR = { from: { collection }, joins: [], select: [], groupBy: [], orderBy: [] };
  ir.where = filterToCond({ kind: 'object', entries: rest }, r);
  const fields = entry(body, 'fields');
  ir.select = fields?.kind === 'array' ? fields.items.flatMap((f) => (f.kind === 'string' ? [{ kind: 'field' as const, ref: { path: f.value } }] : [])) : [{ kind: 'all' }];
  const sort = entry(body, 'sort');
  if (sort?.kind === 'array') {
    ir.orderBy = sort.items.flatMap((s) =>
      s.kind === 'string' ? [{ ref: { path: s.value }, desc: false }] : s.kind === 'object' ? s.entries.map(([k, v]) => ({ ref: { path: k }, desc: v.kind === 'string' && v.value === 'desc' })) : [],
    );
  }
  const limit = entry(body, 'limit');
  const skip = entry(body, 'skip');
  if (limit?.kind === 'number') ir.limit = limit.value;
  if (skip?.kind === 'number') ir.offset = skip.value;
  if (notes.length) ir.untranslated = notes;
  return { ir, diagnostics };
};

/* Firestore */

const FS_CMP: Record<string, Comparison> = { '==': '=', '!=': '!=', '<': '<', '<=': '<=', '>': '>', '>=': '>=' };

const parseFirestore = (text: string): NativeParse => {
  const diagnostics: Diagnostic[] = [];
  const source = text.trim().replace(/;\s*$/, '').replace(/^(?:const|let|var)\s+\w+\s*=\s*/, '').replace(/^await\s+/, '');
  const root = new JsParser(source).value();
  if (root.kind !== 'call') throw new NativeError(t('qe.expectedQuery'));
  const notes: string[] = [];
  let q = root;
  const select: SelectItem[] = [];
  if (root.callee === 'getAggregateFromServer' || root.callee === 'getCountFromServer') {
    if (root.args[0]?.kind !== 'call') throw new NativeError(t('qe.expectedQuery'));
    q = root.args[0];
    if (root.callee === 'getCountFromServer') select.push({ kind: 'field', ref: { path: '*', agg: 'count' } });
    const spec = root.args[1];
    if (spec?.kind === 'object') {
      for (const [name, v] of spec.entries) {
        if (v.kind !== 'call') continue;
        const fn = v.callee === 'count' ? 'count' : v.callee === 'sum' ? 'sum' : v.callee === 'average' ? 'avg' : undefined;
        const path = v.args[0]?.kind === 'string' ? v.args[0].value : '*';
        if (!fn) continue;
        const ref: Ref = { path, agg: fn };
        select.push({ kind: 'field', ref, ...(name !== aggDefault(ref) ? { as: name } : {}) });
      }
    }
  }
  if (q.kind !== 'call' || q.callee !== 'query') throw new NativeError(t('qe.expectedQuery'));
  const [src, ...constraints] = q.args;
  const name = src?.kind === 'call' && (src.callee === 'collection' || src.callee === 'collectionGroup') ? src.args.filter((a) => a.kind === 'string').map((a) => (a as { value: string }).value).pop() : undefined;
  if (!name) throw new NativeError(t('qe.expectedCollection'));
  const ir: QueryIR = { from: { collection: name }, joins: [], select: select.length ? select : [{ kind: 'all' }], groupBy: [], orderBy: [] };
  const read = (c: JsValue): Cond | undefined => {
    if (c.kind !== 'call') return undefined;
    if (c.callee === 'and' || c.callee === 'or') {
      const items = c.args.map(read).filter((x): x is Cond => Boolean(x));
      return c.callee === 'and' ? and(items) : { op: 'or', items };
    }
    if (c.callee !== 'where') {
      notes.push(`${c.callee}()`);
      return undefined;
    }
    const [f, op, v] = c.args;
    if (f?.kind !== 'string' || op?.kind !== 'string' || !v) return undefined;
    const field: Ref = { path: f.value };
    if (op.value === 'in' || op.value === 'not-in' || op.value === 'array-contains-any') {
      const values = v.kind === 'array' ? v.items.map(valueOf).filter((x): x is Value => Boolean(x)) : [];
      return { op: 'in', field, values, ...(op.value === 'not-in' ? { negate: true } : {}) };
    }
    const value = valueOf(v);
    if (!value) return undefined;
    if (op.value === 'array-contains') return { op: 'cmp', field, cmp: '=', value };
    if (value.kind === 'null' && (op.value === '==' || op.value === '!=')) return { op: 'null', field, ...(op.value === '!=' ? { negate: true } : {}) };
    const cmp = FS_CMP[op.value];
    return cmp ? { op: 'cmp', field, cmp, value } : undefined;
  };
  const conds: Cond[] = [];
  for (const c of constraints) {
    if (c.kind === 'call' && c.callee === 'orderBy') {
      const [f, dir] = c.args;
      if (f?.kind === 'string') ir.orderBy.push({ ref: { path: f.value }, desc: dir?.kind === 'string' && dir.value === 'desc' });
    } else if (c.kind === 'call' && c.callee === 'limit' && c.args[0]?.kind === 'number') ir.limit = c.args[0].value;
    else {
      const cond = read(c);
      if (cond) conds.push(cond);
    }
  }
  ir.where = prefixRanges(and(conds));
  if (notes.length) ir.untranslated = notes;
  return { ir, diagnostics };
};

/** `f >= 'ab'` with `f < 'ab'` is how Firestore says LIKE 'ab%'. */
const prefixRanges = (c: Cond | undefined): Cond | undefined => {
  if (!c || c.op !== 'and') return c;
  const items = [...c.items];
  for (const low of c.items) {
    if (low.op !== 'cmp' || low.cmp !== '>=' || low.value.kind !== 'string') continue;
    const prefix = low.value.value;
    const high = items.find((x) => x.op === 'cmp' && x.cmp === '<' && x.field.path === low.field.path && x.value.kind === 'string' && x.value.value === `${prefix}`);
    if (!high) continue;
    items.splice(items.indexOf(low), 1, { op: 'like', field: low.field, pattern: `${prefix}%` });
    items.splice(items.indexOf(high), 1);
  }
  return and(items);
};

export const parseNative = (project: Project, text: string): NativeParse => {
  if (!text.trim()) return { diagnostics: [] };
  try {
    if (project.engine === 'mongodb') return parseMongo(text);
    if (project.engine === 'couchdb') return parseCouch(project, text);
    return parseFirestore(text);
  } catch (e) {
    const message = e instanceof NativeError ? e.message : t('qe.nativeSyntax', { error: e instanceof Error ? e.message : String(e) });
    return { diagnostics: [{ severity: 'error', message, pos: { start: 0, end: text.length } }] };
  }
};
