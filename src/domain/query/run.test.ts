import * as mingo from 'mingo';
import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../../lib/sample-project';
import { changeEngine } from '../engine-change';
import type { Project } from '../types';
import { prepareGenerated, prepareNative, prepareSql, readMongoCall, runCall, sampleData } from './run';

const OID = (n: number) => `00000000000000000000000${n}`;

/** The sample store with a few documents written by hand, with Extended JSON ids and dates. */
const project = (engine: Project['engine'] = 'mongodb') => {
  const p = createSampleProject();
  const id = (name: string) => p.collections.find((c) => c.name === name)!.id;
  p.documents = {
    [id('clientes')]: [
      { id: 'a', json: JSON.stringify({ _id: { $oid: OID(1) }, nombre: 'Ana', email: 'ana@x.com', creadoEn: { $date: '2026-01-01T00:00:00Z' } }) },
      { id: 'b', json: JSON.stringify({ _id: { $oid: OID(2) }, nombre: 'Luis', email: 'luis@x.com', creadoEn: { $date: '2026-02-01T00:00:00Z' } }) },
    ],
    [id('pedidos')]: [
      { id: 'p1', json: JSON.stringify({ _id: { $oid: OID(5) }, clienteId: { $oid: OID(1) }, estado: 'pagado', total: 30, fecha: { $date: '2026-03-01T00:00:00Z' } }) },
      { id: 'p2', json: JSON.stringify({ _id: { $oid: OID(6) }, clienteId: { $oid: OID(1) }, estado: 'pagado', total: 20, fecha: { $date: '2026-03-02T00:00:00Z' } }) },
      { id: 'p3', json: JSON.stringify({ _id: { $oid: OID(7) }, clienteId: { $oid: OID(2) }, estado: 'enviado', total: 5, fecha: { $date: '2026-03-03T00:00:00Z' } }) },
      { id: 'bad', json: '{ not json' },
    ],
  };
  if (engine !== 'mongodb') changeEngine(p, engine);
  return p;
};

const run = (p: Project, prepared: ReturnType<typeof prepareSql>) => {
  expect(prepared.error).toBeUndefined();
  return runCall(mingo, prepared.call!, sampleData(p));
};

describe('running queries on the sample documents', () => {
  it('copies the documents with ObjectIds as text and dates as Date, leaving the project untouched', () => {
    const p = project();
    const before = JSON.stringify(p.documents);
    const data = sampleData(p);
    expect(data.clientes[0]._id).toBe(OID(1));
    expect(data.clientes[0].creadoEn).toBeInstanceOf(Date);
    expect(data.pedidos).toHaveLength(3);
    run(p, prepareSql(p, 'SELECT * FROM pedidos'));
    expect(JSON.stringify(p.documents)).toBe(before);
  });

  it('runs SQL with a join, a filter on a date and a group', () => {
    const p = project();
    const grouped = run(p, prepareSql(p, "SELECT c.nombre, SUM(p.total) AS suma FROM pedidos p JOIN clientes c ON p.clienteId = c._id WHERE p.fecha >= '2026-03-01' GROUP BY c.nombre ORDER BY suma DESC"));
    expect(grouped.rows).toEqual([
      { c_nombre: 'Ana', suma: 50 },
      { c_nombre: 'Luis', suma: 5 },
    ]);
    const filtered = run(p, prepareSql(p, "SELECT nombre FROM clientes WHERE email LIKE '%luis%'"));
    expect(filtered.rows).toEqual([{ _id: OID(2), nombre: 'Luis' }]);
    expect(run(p, prepareSql(p, "SELECT COUNT(*) FROM pedidos WHERE estado = 'pagado'")).rows).toEqual([{ count: 2 }]);
  });

  it('runs the native query as written, only reads', () => {
    const p = project();
    const native = run(p, prepareNative(p, 'db.pedidos.find({ total: { $gt: 10 } }, { total: 1, _id: 0 }).sort({ total: 1 }).limit(5)'));
    expect(native.rows).toEqual([{ total: 20 }, { total: 30 }]);
    const lookup = run(p, prepareNative(p, 'db.pedidos.aggregate([{ $match: { clienteId: ObjectId("000000000000000000000002") } }, { $lookup: { from: "clientes", localField: "clienteId", foreignField: "_id", as: "c" } }])'));
    expect((lookup.rows[0].c as { nombre: string }[])[0].nombre).toBe('Luis');
    expect(prepareNative(p, 'db.pedidos.aggregate([{ $out: "copia" }])').error).toMatch(/lecturas/);
    expect(prepareNative(p, 'db.pedidos.deleteMany({})').error).toMatch(/lecturas/);
  });

  it('runs Mango and Firestore queries, and the generated one', () => {
    const couch = project('couchdb');
    const mango = run(couch, prepareNative(couch, '{ "selector": { "type": "pedidos", "estado": "pagado" }, "fields": ["total"], "sort": [{ "total": "desc" }] }'));
    expect(mango.rows.map((r) => r.total)).toEqual([30, 20]);
    const fs = project('firestore');
    const prepared = prepareNative(fs, 'query(collection(db, "pedidos"), where("total", ">=", 20), orderBy("total"))');
    expect(prepared.warnings[0]).toMatch(/Firestore/);
    expect(run(fs, prepared).rows.map((r) => r.total)).toEqual([20, 30]);
    const p = project();
    const generated = run(p, prepareGenerated(p, { rootId: p.collections.find((c) => c.name === 'pedidos')!.id, joins: [], filter: '{ "estado": "enviado" }', limit: 0 }));
    expect(generated.rows.map((r) => r.total)).toEqual([5]);
  });

  it('says which collections have no documents', () => {
    const p = project();
    expect(run(p, prepareSql(p, 'SELECT * FROM productos')).emptyCollections).toEqual(['productos']);
    expect(readMongoCall('db.getCollection("pedidos").find({}).skip(1)')).toMatchObject({ collection: 'pedidos', method: 'find', skip: 1 });
  });
});
