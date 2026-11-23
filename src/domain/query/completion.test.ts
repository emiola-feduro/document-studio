import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../../lib/sample-project';
import { changeEngine } from '../engine-change';
import type { Project } from '../types';
import { nativeHover, signatureAt, sqlHover } from './hover';
import { nativeCompletions } from './native-completion';
import { sqlCompletions } from './sql-completion';

const project = (engine: Project['engine'] = 'mongodb') => {
  const p = createSampleProject();
  if (engine !== 'mongodb') changeEngine(p, engine);
  return p;
};

/** Completions at the `|` of the text. */
const sql = (p: Project, text: string) => {
  const caret = text.indexOf('|');
  return sqlCompletions(text.replace('|', ''), caret, p, 'texto');
};
const labels = (r: { items: { label: string }[] }) => r.items.map((i) => i.label);
const nat = (p: Project, text: string) => {
  const caret = text.includes('|') ? text.indexOf('|') : text.length;
  return nativeCompletions(p, text.replace('|', ''), caret, 'texto');
};
/** Applies the first item that matches and returns the new text. */
const accept = (text: string, r: { from: number; to: number; items: { label: string; insert: string }[] }, label: string) => {
  const item = r.items.find((i) => i.label === label);
  if (!item) throw new Error(`${label} not in ${JSON.stringify(r.items.map((i) => i.label))}`);
  const plain = text.replace('|', '');
  return plain.slice(0, r.from) + item.insert + plain.slice(r.to);
};

describe('SQL completion', () => {
  const p = project();

  it('starts with SELECT, offers * and every field before FROM', () => {
    expect(labels(sql(p, '|'))).toEqual(['SELECT']);
    const select = labels(sql(p, 'SELECT |'));
    expect(select[0]).toBe('*');
    expect(select).toContain('clientes.direccion.ciudad');
  });

  it('puts first the collection the SELECT already uses, with its alias', () => {
    expect(labels(sql(p, 'SELECT c.nombre FROM |'))[0]).toBe('clientes c');
  });

  it('after JOIN puts the related collections first and then builds ON from the reference', () => {
    expect(labels(sql(p, 'SELECT * FROM pedidos p JOIN |')).slice(0, 2)).toEqual(['clientes', 'productos']);
    expect(labels(sql(p, 'SELECT * FROM pedidos p JOIN clientes c |'))[0]).toBe('ON p.clienteId = c._id');
  });

  it('lists nested paths after the alias and does not repeat a selected field', () => {
    const paths = labels(sql(p, 'SELECT c.| FROM clientes c'));
    expect(paths).toContain('direccion.ciudad');
    expect(labels(sql(p, 'SELECT c.direccion.| FROM clientes c'))).toEqual(['direccion.calle', 'direccion.ciudad', 'direccion.codigoPostal']);
    expect(labels(sql(p, 'SELECT nombre, | FROM clientes'))).not.toContain('nombre');
    expect(labels(sql(p, 'SELECT nombre AS |'))).toEqual([]);
    expect(labels(sql(p, "SELECT * FROM clientes WHERE nombre = 'An|"))).toEqual([]);
  });

  it('offers operators of the field type, positive and negative, and NOT ones after NOT', () => {
    const ops = labels(sql(p, 'SELECT * FROM pedidos WHERE estado |'));
    expect(ops).toEqual(expect.arrayContaining(["= 'pendiente'", "<> 'pendiente'", "IN ('pendiente', 'pagado')", "NOT IN ('pendiente')"]));
    expect(labels(sql(p, 'SELECT * FROM pedidos WHERE total NOT |'))).toEqual(['BETWEEN 1 AND 100', 'IN (1, 2, 3)']);
    expect(labels(sql(p, "SELECT * FROM pedidos WHERE estado = 'pagado' |")).slice(0, 2)).toEqual(['AND', 'OR']);
    expect(labels(sql(p, 'SELECT * FROM clientes WHERE email LI|'))).toEqual(["LIKE 'texto%'", "LIKE '%texto%'"]);
    expect(labels(sql(p, 'SELECT * FROM clientes WHERE email N|'))).toEqual(["NOT LIKE '%texto%'", 'NOT']);
  });

  it('suggests the id of a real sample document for a reference', () => {
    const withDocs = project();
    const clientes = withDocs.collections.find((c) => c.name === 'clientes')!;
    withDocs.documents = { [clientes.id]: [{ id: 'd1', json: '{ "_id": { "$oid": "64b7f0c2a1b2c3d4e5f60718" } }' }] };
    expect(labels(sql(withDocs, 'SELECT * FROM pedidos WHERE clienteId |'))[0]).toBe("= ObjectId('64b7f0c2a1b2c3d4e5f60718')");
  });

  it('builds a whole query by accepting suggestions only', () => {
    let text = '|';
    const step = (label: string, typed = '') => {
      const caret = text.indexOf('|');
      const withTyped = text.slice(0, caret) + typed + '|' + text.slice(caret + 1);
      const r = sql(p, withTyped);
      const next = accept(withTyped, r, label);
      text = `${next}|`;
    };
    step('SELECT');
    step('c.nombre', 'c.nom');
    text = text.replace('|', ' |');
    step('FROM');
    step('clientes c');
    step('WHERE');
    step('email', 'c.em');
    step("LIKE 'texto%'", ' ');
    step('ORDER BY');
    step('c.nombre');
    expect(text.replace('|', '').trim()).toBe("SELECT c.nombre FROM clientes c WHERE c.email LIKE 'texto%' ORDER BY c.nombre");
  });
});

describe('native completion', () => {
  it('completes mongosh collections, methods, filter keys and values', () => {
    const p = project();
    expect(labels(nat(p, 'db.'))).toEqual(['clientes', 'pedidos', 'productos']);
    expect(labels(nat(p, 'db.pedidos.'))).toEqual(['find()', 'aggregate([])', 'countDocuments()']);
    expect(labels(nat(p, 'db.pedidos.find({ '))).toEqual(expect.arrayContaining(['$or', 'estado', 'items.productoId']));
    expect(labels(nat(p, 'db.pedidos.find({ est'))).toContain('estado');
    expect(labels(nat(p, 'db.pedidos.find({ estado: '))).toContain('"pagado"');
    expect(nat(p, 'db.pedidos.find({ clienteId: ').items[0].insert).toBe('ObjectId("000000000000000000000000")');
  });

  it('completes pipeline stages, $lookup from the model and $paths', () => {
    const p = project();
    const stages = labels(nat(p, 'db.pedidos.aggregate([\n  '));
    expect(stages.slice(0, 3)).toEqual(['$lookup clientes', '$lookup productos', '$match']);
    expect(labels(nat(p, 'db.pedidos.aggregate([{ $lookup: { from: "'))).toEqual(['clientes', 'pedidos', 'productos']);
    expect(labels(nat(p, 'db.pedidos.aggregate([{ $group: { _id: "$est'))).toEqual(['$estado']);
  });

  it('completes the Mango body and selector', () => {
    const p = project('couchdb');
    expect(labels(nat(p, '{ "selector": { '))).toEqual(['type: clientes', 'type: pedidos', 'type: productos']);
    expect(labels(nat(p, '{ "selector": { "type": "pedidos", "'))).toEqual(expect.arrayContaining(['estado', 'total']));
  });

  it('completes Firestore paths, operators of the type and values', () => {
    const p = project('firestore');
    const base = 'query(\n  collection(db, "pedidos"),\n  where("';
    expect(labels(nat(p, base))).toContain('estado');
    expect(labels(nat(p, `${base}estado", `))).toEqual(['==', '!=', '<', '<=', '>', '>=', 'in', 'not-in']);
    expect(labels(nat(p, `${base}estado", "==", `))).toEqual(['"pendiente"', '"pagado"', '"enviado"', '"cancelado"']);
  });
});

describe('hover and signature help', () => {
  it('describes fields and collections', () => {
    const p = project();
    const text = 'SELECT c.email FROM clientes c';
    const info = sqlHover(p, text, text.indexOf('email') + 2)!;
    expect(info.title).toBe('clientes.email');
    expect(info.lines[0]).toMatch(/string, requerido/);
    expect(sqlHover(p, text, text.indexOf('clientes') + 1)?.title).toBe('clientes');
    const native = 'db.pedidos.find({ estado: "x" })';
    expect(nativeHover(p, native, native.indexOf('estado') + 1)?.lines).toContain('Valores: pendiente, pagado, enviado, cancelado');
  });

  it('explains the call or stage at the cursor', () => {
    expect(signatureAt('sql', 'SELECT COUNT(', 13)).toMatch(/^COUNT\(/);
    expect(signatureAt('native', 'db.p.aggregate([{ $lookup: { ', 29)).toMatch(/^\$lookup/);
    expect(signatureAt('native', 'query(collection(db, "x"), where(', 33)).toMatch(/^where\(/);
  });
});

describe('precise completion details (phase 16.8)', () => {
  it('a comma before FROM does not make FROM read as a collection or alias', () => {
    const p = project();
    expect(labels(sql(p, 'SELECT c.nombre, FROM clientes c WHERE c.|'))).toEqual(expect.arrayContaining(['nombre', 'email', 'direccion.ciudad']));
    expect(labels(sql(p, 'SELECT nombre, FROM clientes WHERE |'))).toContain('email');
    const list = labels(sql(p, 'SELECT c.nombre, | FROM clientes c'));
    expect(list).toContain('c.email');
    expect(list.some((l) => l.startsWith('pedidos.'))).toBe(false);
    expect(list).not.toContain('FROM');
  });

  it('accepting at the start of a word keeps it, in the middle replaces it whole', () => {
    const p = project();
    const start = sql(p, 'SELECT c.nombre, |FROM clientes c');
    expect([start.from, start.to]).toEqual([17, 17]);
    const middle = sql(p, 'SELECT c.nom|bre FROM clientes c');
    expect(accept('SELECT c.nom|bre FROM clientes c', middle, 'nombre')).toBe('SELECT c.nombre FROM clientes c');
    const native = nat(p, 'db.pedidos.find({ |estado: "pagado" })');
    expect(native.to).toBe(native.from);
  });

  it('HAVING: number operators after an aggregate or its alias, and no GROUP BY after a condition', () => {
    const p = project();
    expect(labels(sql(p, 'SELECT estado, COUNT(*) FROM pedidos GROUP BY estado HAVING COUNT(*) |'))).toEqual(expect.arrayContaining(['> 0', 'BETWEEN 1 AND 100']));
    expect(labels(sql(p, 'SELECT estado, COUNT(*) AS n FROM pedidos GROUP BY estado HAVING n |'))).toContain('> 0');
    expect(labels(sql(p, 'SELECT estado, SUM(total) FROM pedidos GROUP BY estado HAVING SUM(total) NOT |'))).toEqual(['BETWEEN 1 AND 100', 'IN (1, 2, 3)']);
    const after = labels(sql(p, 'SELECT estado, COUNT(*) AS n FROM pedidos GROUP BY estado HAVING n > 1 |'));
    expect(after.slice(0, 4)).toEqual(['AND', 'OR', 'ORDER BY', 'LIMIT']);
    expect(after).not.toContain('GROUP BY');
    expect(labels(sql(p, 'SELECT * FROM pedidos p JOIN clientes c ON p.clienteId = c._id |')).slice(0, 4)).toEqual(['AND', 'OR', 'JOIN', 'LEFT JOIN']);
  });

  it('HAVING and ORDER BY offer the names given with AS first', () => {
    const p = project();
    expect(labels(sql(p, 'SELECT estado, COUNT(*) AS n FROM pedidos GROUP BY estado HAVING |'))[0]).toBe('n');
    expect(labels(sql(p, 'SELECT estado, COUNT(*) AS n FROM pedidos GROUP BY estado ORDER BY |'))[0]).toBe('n');
    expect(labels(sql(p, 'SELECT estado FROM pedidos ORDER BY |'))[0]).toBe('_id');
  });

  it('$lookup: localField from the base and foreignField from the collection in from, the reference first', () => {
    const p = project();
    const local = labels(nat(p, 'db.pedidos.aggregate([{ $lookup: { from: "clientes", localField: "|'));
    expect(local[0]).toBe('clienteId');
    const foreign = labels(nat(p, 'db.pedidos.aggregate([{ $lookup: { from: "clientes", localField: "clienteId", foreignField: "|'));
    expect(foreign[0]).toBe('_id');
    expect(foreign).toContain('email');
    expect(foreign).not.toContain('total');
    // The other way round: clientes is referenced by pedidos.
    const back = 'db.clientes.aggregate([{ $lookup: { from: "pedidos", localField: "_id", foreignField: "|';
    expect(labels(nat(p, back))[0]).toBe('clienteId');
    expect(labels(nat(p, 'db.clientes.aggregate([{ $lookup: { from: "pedidos", localField: "|'))[0]).toBe('_id');
  });

  it('$elemMatch offers the paths of an element of the array', () => {
    const p = project();
    const items = labels(nat(p, 'db.pedidos.find({ items: { $elemMatch: { |'));
    expect(items).toEqual(expect.arrayContaining(['productoId', 'nombre', 'cantidad', 'precio']));
    expect(items).not.toContain('estado');
    expect(labels(nat(p, 'db.pedidos.find({ items: { $elemMatch: { cantidad: |'))).toContain('1');
  });

  it('collections in db.getCollection("") and no Mango body key twice', () => {
    expect(labels(nat(project(), 'db.getCollection("|'))).toEqual(['clientes', 'pedidos', 'productos']);
    const couch = project('couchdb');
    expect(labels(nat(couch, '{ "selector": { "type": "pedidos" }, "|'))).toEqual(['fields', 'sort', 'limit', 'skip']);
  });

  it('no suggestions inside strings or comments', () => {
    const p = project();
    expect(labels(sql(p, "SELECT * FROM clientes c WHERE c.nombre = 'a|"))).toEqual([]);
    expect(labels(sql(p, 'SELECT * FROM clientes c -- c.|'))).toEqual([]);
    expect(labels(sql(p, 'SELECT * /* c.| */ FROM clientes c'))).toEqual([]);
    expect(labels(nat(p, 'db.pedidos.find({ estado: "pa|gado" })'))).toEqual([]);
    expect(labels(nat(p, 'db.pedidos.find({ // es|'))).toEqual([]);
  });
});
