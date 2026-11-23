import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../lib/sample-project';
import { changeEngine } from './engine-change';
import { firestoreQuery, mongoQuery, queryPaths, type QuerySpec } from './query-builder';
import { filterCompletions, NEGATIVE_MEANINGS, sampleIdOf, type FilterCompletion } from './query-filter';
import type { EngineId, Project } from './types';

const CLIENT_ID = '64b7f0c2a1b2c3d4e5f60718';

const setup = (engine: EngineId = 'mongodb') => {
  const project = createSampleProject();
  if (engine !== 'mongodb') changeEngine(project, engine);
  const id = (name: string) => project.collections.find((c) => c.name === name)!.id;
  project.documents = { [id('clientes')]: [{ id: 'd1', json: JSON.stringify({ _id: { $oid: CLIENT_ID }, nombre: 'Ana' }) }] };
  const paths = (name: string) => queryPaths(project.collections.find((c) => c.name === name)!);
  const complete = (name: string, before: string, after = '') => filterCompletions(engine, paths(name), before, after, 'texto', sampleIdOf(project, id(name)));
  return { project, id, paths, complete };
};

const values = (items: FilterCompletion[]) => items.map((i) => i.value);
const meanings = (items: FilterCompletion[]) => items.map((i) => i.meaning);
const byMeaning = (items: FilterCompletion[], meaning: string) => items.find((i) => i.meaning === meaning)?.value;

describe('negative conditions by engine', () => {
  it('MongoDB: $ne, $nin, $not with $regex, $exists: false, null and out of range with $or', () => {
    const { complete } = setup();
    const estado = complete('pedidos', '{ "estado": ');
    expect(byMeaning(estado, 'notEquals')).toBe('{ "estado": { "$ne": "pendiente" }');
    expect(byMeaning(estado, 'notOneOf')).toBe('{ "estado": { "$nin": ["pendiente","pagado"] }');
    expect(byMeaning(complete('productos', '{ "nombre": '), 'notContains')).toBe('{ "nombre": { "$not": { "$regex": "texto", "$options": "i" } }');
    const stock = complete('productos', '{ "stock": ');
    expect(byMeaning(stock, 'notExists')).toBe('{ "stock": { "$exists": false }');
    expect(byMeaning(stock, 'missing')).toBe('{ "stock": null');
    // Out of range replaces the pair being written with a whole condition.
    const range = byMeaning(stock, 'outsideRange')!;
    expect(JSON.parse(`${range} }`)).toEqual({ $or: [{ stock: { $lt: 1 } }, { stock: { $gt: 100 } }] });
    // On an array $ne means that no element is that value.
    expect(byMeaning(complete('productos', '{ "categorias": '), 'notContains')).toBe('{ "categorias": { "$ne": "texto" }');
  });

  it('a required field gets no $exists: false and no null', () => {
    const { complete } = setup();
    const items = meanings(complete('pedidos', '{ "estado": '));
    expect(items).not.toContain('notExists');
    expect(items).not.toContain('missing');
  });

  it('CouchDB: $ne, $nin, $not and $exists: false, with the regex Mango reads', () => {
    const { complete } = setup('couchdb');
    const nombre = complete('productos', '{ "nombre": ');
    expect(byMeaning(nombre, 'notContains')).toBe('{ "nombre": { "$not": { "$regex": "(?i)texto" } }');
    expect(meanings(nombre)).toEqual(expect.arrayContaining(['notEquals', 'notOneOf']));
    expect(byMeaning(complete('productos', '{ "stock": '), 'notExists')).toBe('{ "stock": { "$exists": false }');
    // { field: null } is MongoDB's way to find missing fields.
    expect(meanings(complete('productos', '{ "stock": '))).not.toContain('missing');
    expect(meanings(complete('productos', '{ "categorias": '))).not.toContain('notContains');
  });

  it('Firestore: only != and not-in, and no "does not contain"', () => {
    const { complete } = setup('firestore');
    const stock = meanings(complete('productos', '{ "stock": '));
    expect(stock).toEqual(expect.arrayContaining(['notEquals', 'notOneOf']));
    for (const m of ['notContains', 'notExists', 'missing', 'outsideRange']) expect(stock).not.toContain(m);
    expect(meanings(complete('productos', '{ "nombre": '))).not.toContain('notContains');
    expect(meanings(complete('productos', '{ "categorias": '))).not.toContain('notContains');
    expect(meanings(complete('productos', '{ "nombre": { "'))).not.toContain('not');
  });

  it('after "field": { "$not": { the operators to negate follow', () => {
    const { complete } = setup();
    const ops = complete('productos', '{ "nombre": { "');
    expect(byMeaning(ops, 'not')).toBe('{ "nombre": { "$not": { "');
    const inside = complete('productos', '{ "nombre": { "$not": { "');
    expect(inside.length).toBeGreaterThan(0);
    expect(inside.every((i) => i.meaning === 'not')).toBe(true);
    expect(values(inside)).toContain('{ "nombre": { "$not": { "$regex": "^texto"');
    expect(values(inside).some((v) => v.includes('$ne') || v.includes('$exists'))).toBe(false);
    // "$n" finds the negative operators of the field.
    expect(values(complete('pedidos', '{ "total": { "$n')).map((v) => v.slice('{ "total": { '.length))).toEqual(['"$ne": 1', '"$nin": [1, 2, 3]', '"$not": { "']);
  });
});

describe('values after an operator', () => {
  it('offers values of the field type: enum, true and false, numbers, text and dates', () => {
    const { complete } = setup();
    expect(values(complete('pedidos', '{ "estado": { "$ne": '))).toEqual(['pendiente', 'pagado', 'enviado', 'cancelado'].map((v) => `{ "estado": { "$ne": "${v}"`));
    expect(meanings(complete('pedidos', '{ "total": { "$gt": '))).toEqual(['number', 'number']);
    expect(values(complete('productos', '{ "nombre": { "$ne": '))).toEqual(['{ "nombre": { "$ne": "texto"']);
    expect(values(complete('pedidos', '{ "fecha": { "$lt": '))[0]).toMatch(/^\{ "fecha": \{ "\$lt": \{ "\$date": "\d{4}-01-01T00:00:00Z" \}$/);
    expect(values(complete('productos', '{ "stock": { "$exists": '))).toEqual(['{ "stock": { "$exists": true', '{ "stock": { "$exists": false']);
    expect(values(complete('pedidos', '{ "estado": { "$nin": '))).toEqual(['{ "estado": { "$nin": ["pendiente", "pagado"]']);
  });

  it('inside $in and $nin, one value and then another', () => {
    const { complete } = setup();
    expect(values(complete('pedidos', '{ "estado": { "$nin": ['))[1]).toBe('{ "estado": { "$nin": ["pagado"');
    const next = complete('pedidos', '{ "estado": { "$nin": ["pagado"');
    expect(byMeaning(next, 'nextValue')).toBe('{ "estado": { "$nin": ["pagado", ');
    expect(JSON.parse(byMeaning(next, 'close')!)).toEqual({ estado: { $nin: ['pagado'] } });
  });

  it('an id is the one of a real sample document of the referenced collection', () => {
    const { complete } = setup();
    expect(values(complete('pedidos', '{ "clienteId": { "$ne": '))).toEqual([`{ "clienteId": { "$ne": { "$oid": "${CLIENT_ID}" }`]);
    const direct = complete('pedidos', '{ "clienteId": ');
    expect(direct[0]).toMatchObject({ meaning: 'sampleId', value: `{ "clienteId": { "$oid": "${CLIENT_ID}" }` });
    // Without sample documents there is still a valid placeholder.
    expect(values(complete('productos', '{ "_id": { "$ne": '))[0]).toContain('000000000000000000000000');
  });
});

describe('multi-line filter', () => {
  it('$or and $and open on a new line, each alternative on its own line, and close on their own lines', () => {
    const { complete } = setup();
    let text = '{ "';
    const pick = (meaning: string, contains = '') => {
      const item = complete('pedidos', text).find((i) => i.meaning === meaning && i.value.includes(contains));
      if (!item) throw new Error(`${meaning} not in ${JSON.stringify(complete('pedidos', text).map((i) => [i.meaning, i.value]))} for ${text}`);
      text = item.value;
    };
    pick('or');
    expect(text).toBe('{\n  "$or": [\n    { "');
    pick('field', '"estado"');
    pick('notEquals');
    pick('nextAlternative');
    expect(text.endsWith('},\n    { "')).toBe(true);
    pick('field', '"total"');
    pick('outsideRange');
    pick('close');
    expect(text).toBe('{\n  "$or": [\n    { "estado": { "$ne": "pendiente" } },\n    { "$or": [{ "total": { "$lt": 1 } }, { "total": { "$gt": 100 } }] }\n  ]\n}');
    expect(JSON.parse(text)).toEqual({ $or: [{ estado: { $ne: 'pendiente' } }, { $or: [{ total: { $lt: 1 } }, { total: { $gt: 100 } }] }] });
  });

  it('works from the text before the cursor, so a condition can go in the middle', () => {
    const { complete } = setup();
    const before = '{ "estado": "pagado", "';
    const after = '"total": 1 }';
    expect(values(complete('pedidos', before, after))).toContain('{ "estado": "pagado", "total": ');
    // With text after the cursor, closing everything is not offered.
    expect(meanings(complete('pedidos', '{ "estado": "pagado"', ', "total": 1 }'))).not.toContain('close');
  });

  it('a partial index filter can leave the negative suggestions out', () => {
    const { complete } = setup();
    const kept = complete('productos', '{ "stock": ').filter((c) => !NEGATIVE_MEANINGS.has(c.meaning));
    expect(meanings(kept)).toEqual(expect.arrayContaining(['equals', 'greater', 'exists']));
    expect(kept.some((c) => /\$ne|\$nin|\$not|"\$exists": false/.test(c.value))).toBe(false);
  });
});

describe('Firestore limits of != and not-in', () => {
  const firestore = (filter: string, extra: Partial<QuerySpec> = {}) => {
    const { project, id } = setup('firestore');
    return firestoreQuery(project as Project, { rootId: id('productos'), joins: [], limit: 0, filter, ...extra })!;
  };

  it('writes != and not-in and says they leave out documents without the field', () => {
    const result = firestore('{ "stock": { "$ne": 0 } }');
    expect(result.code).toContain('where("stock", "!=", 0)');
    expect(result.warnings.join('\n')).toMatch(/stock/);
    expect(firestore('{ "nombre": { "$nin": ["a", "b"] } }').code).toContain('where("nombre", "not-in", ["a", "b"])');
  });

  it('warns about more than one, about not-in with in, and about ordering by another field', () => {
    const two = firestore('{ "stock": { "$ne": 0 }, "nombre": { "$ne": "x" } }').warnings;
    expect(two.some((w) => w.includes('stock, nombre'))).toBe(true);
    const withIn = firestore('{ "nombre": { "$nin": ["a"] }, "categorias": { "$in": ["x"] } }').warnings;
    expect(withIn.some((w) => w.includes('not-in') && w.includes('categorias'))).toBe(true);
    const sorted = firestore('{ "stock": { "$ne": 0 } }', { sortPath: 'nombre' }).warnings;
    expect(sorted.some((w) => w.includes('orderBy("stock")') && w.includes('orderBy("nombre")'))).toBe(true);
    expect(firestore('{ "stock": { "$ne": 0 } }', { sortPath: 'stock' }).warnings.some((w) => w.includes('orderBy("stock")'))).toBe(false);
  });

  it('explains what it cannot do: missing fields, $not and "does not contain" on arrays', () => {
    const missing = firestore('{ "stock": { "$exists": false } }');
    expect(missing.code).not.toContain('where(');
    expect(missing.warnings.some((w) => w.includes('stock') && w.includes('null'))).toBe(true);
    expect(firestore('{ "nombre": { "$not": { "$regex": "x" } } }').warnings.some((w) => w.includes('$not'))).toBe(true);
    const arr = firestore('{ "categorias": { "$ne": "x" } }');
    expect(arr.code).not.toContain('where(');
    expect(arr.warnings.some((w) => w.includes('categorias'))).toBe(true);
  });

  it('MongoDB keeps the negative operators as written', () => {
    const { project, id } = setup();
    const code = mongoQuery(project, { rootId: id('productos'), joins: [], limit: 0, filter: '{ "stock": { "$exists": false }, "nombre": { "$not": { "$regex": "x" } }, "categorias": { "$nin": ["a"] } }' })!.code;
    expect(code).toContain('$exists: false');
    expect(code).toContain('$not');
    expect(code).toContain('$nin');
  });
});
