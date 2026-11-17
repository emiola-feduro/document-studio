import { t } from '../../i18n';
import { balancedArgs, JsParser, parseArgs, type JsValue } from '../import/js-literal';
import { discriminator } from '../outputs/couchdb';
import { mongoQuery, type QuerySpec, buildQuery } from '../query-builder';
import type { Project } from '../types';
import { parseNative } from './native-parse';
import { parseSql } from './sql-parse';
import { toNative } from './to-native';

/**
 * Runs a query on the sample documents, in the browser. Every source (the generated query, the
 * native query of the editor, or SQL) becomes one MongoDB call that mingo runs: find, aggregate or
 * countDocuments. Native text is read, never run as code, and only reads are accepted. The project
 * documents are copied first, with ObjectIds as their hex text and dates as Date, and never changed.
 */

export type Row = Record<string, unknown>;
export type Data = Record<string, Row[]>;

export type MongoCall = {
  collection: string;
  method: 'find' | 'aggregate' | 'countDocuments';
  filter?: Row;
  projection?: Row;
  pipeline?: Row[];
  sort?: Row;
  skip?: number;
  limit?: number;
};

export type Prepared = { call?: MongoCall; error?: string; warnings: string[] };

/** Extended JSON wrappers as values mingo compares: the hex text of an ObjectId, a Date for a date. */
const fromEjson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(fromEjson);
  // Values already converted (a Date, a RegExp) stay as they are.
  if (value instanceof Date || value instanceof RegExp) return value;
  if (value && typeof value === 'object') {
    const o = value as Row;
    const keys = Object.keys(o);
    if (keys.length === 1 && keys[0] === '$oid') return String(o.$oid);
    if (keys.length === 1 && keys[0] === '$date') return new Date(String(typeof o.$date === 'object' && o.$date ? (o.$date as Row).$numberLong ?? '' : o.$date));
    if (keys.length === 1 && (keys[0] === '$numberDecimal' || keys[0] === '$numberLong' || keys[0] === '$numberInt' || keys[0] === '$numberDouble')) return Number(o[keys[0]]);
    return Object.fromEntries(keys.map((k) => [k, fromEjson(o[k])]));
  }
  return value;
};

/** A copy of every collection's sample documents; the ones that do not parse are left out. */
export const sampleData = (project: Project): Data =>
  Object.fromEntries(
    project.collections.map((c) => [
      c.name,
      (project.documents?.[c.id] ?? []).flatMap((d) => {
        try {
          const value = JSON.parse(d.json) as unknown;
          return value && typeof value === 'object' && !Array.isArray(value) ? [fromEjson(value) as Row] : [];
        } catch {
          return [];
        }
      }),
    ]),
  );

/** A value written in mongosh as data: ObjectId("x") is its text, ISODate("x") a Date, /re/ a RegExp. */
export const jsToData = (v: JsValue): unknown => {
  switch (v.kind) {
    case 'string':
    case 'number':
    case 'bool':
      return v.value;
    case 'null':
      return null;
    case 'regex':
      return new RegExp(v.source, v.flags);
    case 'array':
      return v.items.map(jsToData);
    case 'object':
      return fromEjson(Object.fromEntries(v.entries.map(([k, x]) => [k, jsToData(x)])));
    case 'call': {
      const name = v.callee.split('.').pop()!.toLowerCase();
      const arg = v.args[0] ? jsToData(v.args[0]) : undefined;
      if (name === 'objectid') return String(arg ?? '');
      if (name === 'isodate' || name === 'date') return arg === undefined ? new Date() : new Date(arg as string);
      if (name.startsWith('number')) return Number(arg);
      return undefined;
    }
    default:
      return undefined;
  }
};

class RunError extends Error {}

/** Reads db.x.find(...).sort(...).skip(...).limit(...), countDocuments(...) or aggregate([...]) without running it. */
export const readMongoCall = (text: string): MongoCall => {
  const at = text.search(/\bdb\s*\./);
  if (at < 0) throw new RunError(t('qe.expectedDb'));
  let i = text.indexOf('.', at) + 1;
  const ws = () => {
    while (/\s/.test(text[i] ?? '')) i += 1;
  };
  ws();
  let collection: string;
  if (text.startsWith('getCollection', i)) {
    const open = text.indexOf('(', i);
    const inside = balancedArgs(text, open) ?? '';
    const [name] = parseArgs(inside);
    if (name?.kind !== 'string') throw new RunError(t('qe.expectedCollection'));
    collection = name.value;
    i = open + inside.length + 2;
  } else {
    const m = /^[A-Za-z_$][\w$]*/.exec(text.slice(i));
    if (!m) throw new RunError(t('qe.expectedCollection'));
    collection = m[0];
    i += m[0].length;
  }
  const calls: { method: string; args: unknown[] }[] = [];
  for (;;) {
    ws();
    if (text[i] !== '.') break;
    i += 1;
    ws();
    const m = /^[A-Za-z_$][\w$]*/.exec(text.slice(i));
    if (!m) break;
    i += m[0].length;
    ws();
    const inside = balancedArgs(text, i);
    if (inside === undefined) throw new RunError(t('qe.unclosed'));
    calls.push({ method: m[0], args: parseArgs(inside).map(jsToData) });
    i += inside.length + 2;
  }
  const [first, ...rest] = calls;
  if (!first) throw new RunError(t('qe.expectedMethod'));
  if (first.method === 'aggregate') {
    const pipeline = (first.args[0] as Row[] | undefined) ?? [];
    if (pipeline.some((s) => s && typeof s === 'object' && ('$out' in s || '$merge' in s))) throw new RunError(t('run.readOnly'));
    return { collection, method: 'aggregate', pipeline };
  }
  if (first.method === 'countDocuments' || first.method === 'count') return { collection, method: 'countDocuments', filter: (first.args[0] as Row) ?? {} };
  if (first.method !== 'find' && first.method !== 'findOne') throw new RunError(t('run.readOnly'));
  const call: MongoCall = { collection, method: 'find', filter: (first.args[0] as Row) ?? {}, projection: first.args[1] as Row | undefined };
  if (first.method === 'findOne') call.limit = 1;
  for (const c of rest) {
    if (c.method === 'sort') call.sort = c.args[0] as Row;
    else if (c.method === 'skip') call.skip = Number(c.args[0]);
    else if (c.method === 'limit') call.limit = Number(c.args[0]);
  }
  return call;
};

const asMongo = (project: Project): Project => ({ ...project, engine: 'mongodb' });

const prepared = (build: () => MongoCall, warnings: string[] = []): Prepared => {
  try {
    return { call: build(), warnings };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), warnings };
  }
};

/** SQL: translated to MongoDB to run; what the project engine could not do comes as warnings. */
export const prepareSql = (project: Project, text: string): Prepared => {
  const parsed = parseSql(text);
  if (!parsed.ir) return { error: parsed.diagnostics[0]?.message ?? t('run.empty'), warnings: [] };
  const engineWarnings = project.engine === 'mongodb' ? [] : toNative(project, parsed.ir).diagnostics.filter((d) => d.severity === 'warning').map((d) => d.message);
  const mongo = toNative(asMongo(project), parsed.ir);
  const errors = mongo.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length) return { error: errors[0].message, warnings: engineWarnings };
  return prepared(() => readMongoCall(mongo.text), engineWarnings);
};

/** The editor's native query: mongosh as written, Mango as a find, Firestore through its IR. */
export const prepareNative = (project: Project, text: string): Prepared => {
  if (!text.trim()) return { error: t('run.empty'), warnings: [] };
  if (project.engine === 'mongodb') return prepared(() => readMongoCall(text));
  if (project.engine === 'couchdb') {
    return prepared(() => {
      const body = jsToData(new JsParser(text.trim()).value()) as Row;
      const selector = { ...((body?.selector as Row) ?? {}) };
      // The type field says which collection; the rest is the filter.
      const root = project.collections.find((c) => selector[discriminator(c).field] === discriminator(c).value);
      if (!root) throw new RunError(t('qe.couchNoType'));
      delete selector[discriminator(root).field];
      const fields = Array.isArray(body.fields) ? Object.fromEntries((body.fields as string[]).map((f) => [f, 1])) : undefined;
      const sort = Array.isArray(body.sort) ? Object.fromEntries((body.sort as unknown[]).flatMap((s) => (typeof s === 'string' ? [[s, 1]] : Object.entries(s as Row).map(([k, d]) => [k, d === 'desc' ? -1 : 1])))) : undefined;
      return { collection: root.name, method: 'find', filter: selector, projection: fields, sort, skip: Number(body.skip) || undefined, limit: Number(body.limit) || undefined };
    });
  }
  const parsed = parseNative(project, text);
  if (!parsed.ir) return { error: parsed.diagnostics[0]?.message ?? t('run.empty'), warnings: [] };
  const mongo = toNative(asMongo(project), parsed.ir);
  return prepared(() => readMongoCall(mongo.text), [t('run.firestoreApprox')]);
};

/** The builder's query, built for MongoDB to run, with the project engine's warnings. */
export const prepareGenerated = (project: Project, spec: QuerySpec): Prepared => {
  const code = mongoQuery(asMongo(project), spec)?.code;
  if (!code) return { error: t('query.empty'), warnings: [] };
  const warnings = project.engine === 'mongodb' ? [] : (buildQuery(project, spec)?.warnings ?? []);
  return prepared(() => readMongoCall(code), warnings);
};

export type RunResult = { rows: Row[]; total: number; ms: number; emptyCollections: string[] };

export const MAX_ROWS = 500;

type Mingo = typeof import('mingo');

/** Runs a prepared call with mingo; `$lookup` reads the other collections of the copy. */
export const runCall = (mingo: Mingo, call: MongoCall, data: Data): RunResult => {
  const start = performance.now();
  const source = data[call.collection];
  if (!source) throw new RunError(t('qe.unknownCollection', { name: call.collection }));
  const options = { collectionResolver: (name: string) => data[name] ?? [] };
  let rows: Row[];
  if (call.method === 'aggregate') rows = mingo.aggregate(source, call.pipeline ?? [], options) as Row[];
  else if (call.method === 'countDocuments') rows = [{ count: mingo.find(source, call.filter ?? {}, undefined, options).all().length }];
  else {
    let cursor = mingo.find(source, call.filter ?? {}, call.projection, options);
    if (call.sort) cursor = cursor.sort(call.sort as Record<string, 1 | -1>);
    if (call.skip) cursor = cursor.skip(call.skip);
    if (call.limit) cursor = cursor.limit(call.limit);
    rows = cursor.all() as Row[];
  }
  // Collections the query reads that have no sample documents, to say why a result may be empty.
  const read = new Set([call.collection, ...JSON.stringify(call.pipeline ?? []).match(/"from":"([^"]+)"/g)?.map((m) => m.slice(8, -1)) ?? []]);
  const emptyCollections = [...read].filter((n) => (data[n] ?? []).length === 0);
  return { rows, total: rows.length, ms: performance.now() - start, emptyCollections };
};

