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
