import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../lib/sample-project';
import { changeEngine } from './engine-change';
import { buildQuery, couchQuery, firestoreQuery, joinOptions, mongoQuery, queryPaths, type QuerySpec } from './query-builder';
import { filterCompletions } from './query-filter';
import type { Project } from './types';

const setup = () => {
  const project = createSampleProject();
  const id = (name: string) => project.collections.find((c) => c.name === name)!.id;
  return { project, pedidos: id('pedidos'), clientes: id('clientes') };
};

/** Runs a mongosh snippet against a fake db and returns what aggregate or find received. */
const runShell = (code: string) => {
  const calls: { method: string; args: unknown[] }[] = [];
  const cursor: Record<string, unknown> = {};
  for (const m of ['sort', 'skip', 'limit']) cursor[m] = (...args: unknown[]) => (calls.push({ method: m, args }), cursor);
  const collection = {
    aggregate: (...args: unknown[]) => calls.push({ method: 'aggregate', args }),
    find: (...args: unknown[]) => (calls.push({ method: 'find', args }), cursor),
  };
  const db = new Proxy({}, { get: (_t, name) => (name === 'getCollection' ? () => collection : collection) });
  new Function('db', 'use', 'ObjectId', 'ISODate', 'NumberDecimal', code)(db, () => {}, (s: string) => ({ oid: s }), (s: string) => ({ date: s }), (s: string) => ({ dec: s }));
  return calls;
};

describe('query builder', () => {
  it('offers the references of the base collection and of single joins', () => {
    const { project, pedidos } = setup();
    const spec: QuerySpec = { rootId: pedidos, joins: [], limit: 0 };
    const options = joinOptions(project, spec);
    expect(options.map((o) => [o.id, o.as, o.many])).toEqual([
      ['clienteId', 'cliente', false],
      ['items[].productoId', 'productos', true],
    ]);
  });

  it('builds a MongoDB pipeline with two references, $and and $or', () => {
    const { project, pedidos } = setup();
    const spec: QuerySpec = {
      rootId: pedidos,
      joins: ['clienteId', 'items[].productoId'],
      filter: JSON.stringify({ $and: [{ estado: 'pagado' }, { $or: [{ total: { $gt: 100 } }, { 'cliente.nombre': { $regex: '^A' } }] }] }),
      sortPath: 'fecha',
      sortOrder: -1,
      skip: 20,
      limit: 10,
    };
    const result = mongoQuery(project, spec)!;
    expect(result.warnings).toEqual([]);
    const [call] = runShell(result.code);
    expect(call.method).toBe('aggregate');
    expect(call.args[0]).toEqual([
      { $lookup: { from: 'clientes', localField: 'clienteId', foreignField: '_id', as: 'cliente' } },
      { $unwind: { path: '$cliente', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'productos', localField: 'items.productoId', foreignField: '_id', as: 'productos' } },
      // The filter uses a joined field, so it runs after the lookups.
      { $match: JSON.parse(spec.filter!) },
      { $sort: { fecha: -1 } },
      { $skip: 20 },
      { $limit: 10 },
    ]);
  });

  it('matches first when the filter only uses the base collection, and inner joins drop unmatched documents', () => {
    const { project, pedidos } = setup();
    const spec: QuerySpec = { rootId: pedidos, joins: ['clienteId'], modes: { clienteId: 'inner' }, filter: '{ "fecha": { "$gte": { "$date": "2026-01-01T00:00:00Z" } } }', fields: { '': ['fecha', 'total'], clienteId: ['nombre'] }, limit: 0 };
    const [call] = runShell(mongoQuery(project, spec)!.code);
    const stages = call.args[0] as Record<string, unknown>[];
    expect(stages[0]).toEqual({ $match: { fecha: { $gte: { date: '2026-01-01T00:00:00Z' } } } });
    expect(stages[2]).toEqual({ $unwind: { path: '$cliente', preserveNullAndEmptyArrays: false } });
    expect(stages[3]).toEqual({ $project: { fecha: 1, total: 1, 'cliente.nombre': 1 } });
  });

  it('uses find without references, with projection, sort and limit', () => {
    const { project, clientes } = setup();
    const calls = runShell(mongoQuery(project, { rootId: clientes, joins: [], filter: '{ "direccion.ciudad": "Lima" }', fields: { '': ['nombre', 'email'] }, sortPath: 'nombre', limit: 5 })!.code);
    expect(calls).toEqual([
      { method: 'find', args: [{ 'direccion.ciudad': 'Lima' }, { nombre: 1, email: 1 }] },
      { method: 'sort', args: [{ nombre: 1 }] },
      { method: 'limit', args: [5] },
    ]);
  });

  it('reports a filter that is not valid JSON', () => {
    const { project, clientes } = setup();
    const result = mongoQuery(project, { rootId: clientes, joins: [], filter: '{ "nombre": "Ana', limit: 0 })!;
    expect(result.warnings).toEqual([]);
    expect(result.filterError).toMatch(/JSON/);
  });

  it('writes Firestore SDK code, reads references apart and asks for the composite index', () => {
    const { project, pedidos } = setup();
    changeEngine(project, 'firestore');
    const spec: QuerySpec = { rootId: pedidos, joins: ['clienteId'], filter: '{ "estado": "pagado", "total": { "$gte": 10 } }', sortPath: 'fecha', sortOrder: -1, limit: 20 };
    const result = firestoreQuery(project, spec)!;
    expect(result.code).toContain(`where("estado", "==", "pagado")`);
    expect(result.code).toContain(`where("total", ">=", 10)`);
    expect(result.code).toContain(`orderBy("fecha", "desc")`);
    expect(result.code).toContain('limit(20)');
    expect(result.code).toContain('getDoc(data.clienteId)');
    expect(result.code).toMatch(/^import \{ collection, getDoc, getDocs, limit, orderBy, query, where, type Firestore \} from 'firebase\/firestore';/);
    expect(result.missingIndex?.keys).toEqual([
      { path: 'estado', order: 1 },
      { path: 'total', order: 1 },
      { path: 'fecha', order: -1 },
    ]);
    // Once the model has that index, the warning says so and nothing is missing.
    const collection = project.collections.find((c) => c.id === pedidos)!;
    collection.indexes.push({ id: 'x', name: 'x', nameIsCustom: true, keys: result.missingIndex!.keys });
    const again = firestoreQuery(project, spec)!;
    expect(again.missingIndex).toBeUndefined();
  });

  it('translates $or into or() and leaves out what Firestore cannot do', () => {
    const { project, pedidos } = setup();
    changeEngine(project, 'firestore');
    const result = firestoreQuery(project, { rootId: pedidos, joins: [], filter: '{ "$or": [{ "estado": "pagado" }, { "total": { "$gt": 5 } }], "notas": { "$regex": "x" } }', skip: 10, limit: 0 })!;
    expect(result.code).toContain('and(\n');
    expect(result.code).toContain('or(\n');
    expect(result.code).toContain(`where("total", ">", 5)`);
    expect(result.warnings.some((w) => w.includes('$regex'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('startAfter'))).toBe(true);
  });

  it('writes a Mango query with the type field and one _all_docs read per reference', () => {
    const { project, pedidos } = setup();
    changeEngine(project, 'couchdb');
    const result = couchQuery(project, { rootId: pedidos, joins: ['clienteId'], filter: '{ "estado": { "$in": ["pagado", "enviado"] } }', fields: { '': ['fecha'] }, sortPath: 'fecha', limit: 50 })!;
    const body = JSON.parse(result.code.split('Content-Type: application/json\n\n')[1].split('\n\n')[0]);
    expect(body).toEqual({ selector: { type: 'pedidos', estado: { $in: ['pagado', 'enviado'] } }, fields: ['_id', 'fecha', 'clienteId'], sort: [{ fecha: 'asc' }], limit: 50 });
    expect(result.code).toContain('_all_docs?include_docs=true');
    expect(result.warnings[0]).toContain('fecha');
  });

  it('picks the output of the project engine', () => {
    const { project, pedidos } = setup();
    expect(buildQuery(project, { rootId: pedidos, joins: [], limit: 0 })?.language).toBe('js');
    expect(buildQuery(project, { joins: [], limit: 0 })).toBeUndefined();
  });
});

describe('filter completions', () => {
  const paths = (project: Project, id: string) => queryPaths(project.collections.find((c) => c.id === id)!);

  it('suggests a condition per field and $or when the filter is empty', () => {
    const { project, pedidos } = setup();
    const items = filterCompletions('mongodb', paths(project, pedidos), '', '', 'texto');
    expect(items.map((i) => i.value)).toContain('{ "estado": "pendiente" }');
    expect(items.some((i) => i.meaning === 'or' && i.value.startsWith('{ "$or": ['))).toBe(true);
  });

  it('completes a path from its last part and then offers values that fit the type', () => {
    const { project, clientes, pedidos } = setup();
    const keys = filterCompletions('mongodb', paths(project, clientes), '{ "ciu', '', 'texto');
    expect(keys.map((i) => i.value)).toEqual(['{ "direccion.ciudad": ']);
    const values = filterCompletions('mongodb', paths(project, pedidos), '{ "total": ', '', 'texto').map((i) => i.value);
    expect(values).toContain('{ "total": { "$gt": 0 }');
    const ops = filterCompletions('mongodb', paths(project, pedidos), '{ "total": { "', '', 'texto').map((i) => i.value);
    expect(ops).toContain('{ "total": { "$gt": 0');
  });

  it('after a condition offers the next one, another alternative of $or and closing the brackets', () => {
    const { project, pedidos } = setup();
    const p = paths(project, pedidos);
    expect(filterCompletions('mongodb', p, '{ "estado": "pagado"', '', 'texto').map((i) => i.value)).toEqual(['{ "estado": "pagado", "', '{ "estado": "pagado" }']);
    const inOr = filterCompletions('mongodb', p, '{ "$or": [{ "total": 1', '', 'texto').map((i) => [i.meaning, i.value]);
    expect(inOr).toEqual([
      ['next', '{ "$or": [{ "total": 1, "'],
      ['nextAlternative', '{ "$or": [{ "total": 1 }, { "'],
      ['close', '{ "$or": [{ "total": 1 }] }'],
    ]);
  });

  it('builds valid JSON by accepting suggestions step by step', () => {
    const { project, pedidos } = setup();
    const p = paths(project, pedidos);
    let text = '{ "';
    const pick = (meaning: string, contains = '') => {
      const all = filterCompletions('mongodb', p, text, '', 'texto');
      const item = all.find((i) => i.meaning === meaning && i.value.includes(contains));
      if (!item) throw new Error(`${meaning} not in ${JSON.stringify(all.map((i) => [i.meaning, i.value]))} for ${text}`);
      text = item.value;
    };
    pick('or');
    pick('field', '"estado"');
    pick('equals', 'pagado');
    pick('nextAlternative');
    pick('field', '"total"');
    pick('greater');
    pick('close');
    expect(JSON.parse(text)).toEqual({ $or: [{ estado: 'pagado' }, { total: { $gt: 0 } }] });
  });

  it('leaves out operators the engine does not have', () => {
    const { project, clientes } = setup();
    const p = paths(project, clientes);
    const mongo = filterCompletions('mongodb', p, '{ "nombre": ', '', 'texto').map((i) => i.meaning);
    const firestore = filterCompletions('firestore', p, '{ "nombre": ', '', 'texto').map((i) => i.meaning);
    expect(mongo).toContain('containsCi');
    expect(firestore).not.toContain('containsCi');
    expect(filterCompletions('couchdb', p, '{ "nombre": ', '', 'texto').find((i) => i.meaning === 'containsCi')?.value).toContain('(?i)');
  });
});
