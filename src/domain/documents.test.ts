import { describe, expect, it } from 'vitest';
import { couchBulkDocs, documentsEjson, documentsNdjson, firestoreImport, mongoshInsertMany, toEjson, validateDocuments } from './documents';
import { uid } from './model';
import { storeFixture } from './outputs/fixtures';
import type { Project } from './types';

const doc = (value: unknown) => ({ id: uid(), json: JSON.stringify(value) });

const withDocs = (project: Project) => {
  const [customers, orders] = project.collections;
  project.documents = {
    [customers.id]: [
      doc({ _id: '65a1b2c3d4e5f60718293a4b', nombre: 'Ana', email: 'ana@x.com', tipo: 'persona', creadoEn: '2025-01-02T10:00:00Z' }),
      doc({ _id: { $oid: '65a1b2c3d4e5f60718293a4c' }, nombre: 'Luis', email: 'luis@x.com', tipo: 'empresa', creadoEn: { $date: '2025-02-02T10:00:00Z' }, direccion: { ciudad: 'Lima' } }),
    ],
    [orders.id]: [doc({ _id: '75a1b2c3d4e5f60718293a4b', clienteId: '65a1b2c3d4e5f60718293a4b', items: [{ sku: 'A', cantidad: 2 }], total: 10.5, creadoEn: '2025-03-01T00:00:00Z' })],
  };
  return project;
};

describe('validateDocuments', () => {
  it('accepts valid documents, plain and Extended JSON', () => {
    const project = withDocs(storeFixture('mongodb'));
    for (const c of project.collections) expect(validateDocuments(project, c).flatMap((r) => r.errors)).toEqual([]);
  });

  it('marks each problem by path', () => {
    const project = withDocs(storeFixture('mongodb'));
    const [customers, orders] = project.collections;
    project.documents![customers.id].push(doc({ _id: '65a1b2c3d4e5f60718293a4d', nombre: 7, email: 'bad', tipo: 'otro', creadoEn: 'ayer', puntos: -2, direccion: {} }));
    project.documents![orders.id].push(doc({ _id: 'x', clienteId: '0000000000000000000000ff', items: [], total: 1, creadoEn: '2025-01-01' }));
    const customerErrors = validateDocuments(project, customers)[2].errors.map((e) => e.path);
    expect(customerErrors).toEqual(expect.arrayContaining(['nombre', 'email', 'tipo', 'creadoEn', 'puntos', 'direccion.ciudad']));
    const orderErrors = validateDocuments(project, orders)[1].errors;
    expect(orderErrors.map((e) => e.path)).toEqual(expect.arrayContaining(['_id', 'items', 'clienteId']));
  });

  it('finds duplicates of unique indexes and ids', () => {
    const project = withDocs(storeFixture('mongodb'));
    const [customers] = project.collections;
    project.documents![customers.id].push(doc({ _id: '65a1b2c3d4e5f60718293a4b', nombre: 'Otra', email: 'ana@x.com', tipo: 'persona', creadoEn: '2025-01-02T10:00:00Z' }));
    const errors = validateDocuments(project, customers)[2].errors;
    expect(errors).toHaveLength(2);
  });

  it('rejects extra fields only when the collection is strict', () => {
    const project = withDocs(storeFixture('mongodb'));
    const [customers] = project.collections;
    project.documents![customers.id].push(doc({ _id: '65a1b2c3d4e5f60718293a4e', nombre: 'A', email: 'a@b.c', tipo: 'persona', creadoEn: '2025-01-02T10:00:00Z', extra: 1 }));
    expect(validateDocuments(project, customers)[2].errors).toEqual([]);
    customers.options.additionalProperties = false;
    expect(validateDocuments(project, customers)[2].errors.map((e) => e.path)).toEqual(['extra']);
  });

  it('reports invalid JSON', () => {
    const project = storeFixture('mongodb');
    project.documents = { [project.collections[0].id]: [{ id: 'x', json: '{ nope' }] };
    expect(validateDocuments(project, project.collections[0])[0].errors[0].message).toMatch(/JSON/);
  });
});

describe('exports', () => {
  it('writes Extended JSON with $oid, $date and $numberDecimal', () => {
    const project = withDocs(storeFixture('mongodb'));
    const [customers, orders] = project.collections;
    const ejson = JSON.parse(documentsEjson(project, customers));
    expect(ejson[0]._id).toEqual({ $oid: '65a1b2c3d4e5f60718293a4b' });
    expect(ejson[0].creadoEn).toEqual({ $date: '2025-01-02T10:00:00.000Z' });
    expect(ejson[1]._id).toEqual({ $oid: '65a1b2c3d4e5f60718293a4c' });
    expect(toEjson(orders.fields, { total: 10.5 }).total).toEqual({ $numberDecimal: '10.5' });
  });

  it('writes one document per line for NDJSON', () => {
    const project = withDocs(storeFixture('mongodb'));
    expect(documentsNdjson(project, project.collections[0]).trim().split('\n')).toHaveLength(2);
  });

  it('writes an insertMany script with shell constructors', () => {
    const code = mongoshInsertMany(withDocs(storeFixture('mongodb')));
    expect(code).toContain('db.clientes.insertMany([');
    expect(code).toContain('ObjectId("65a1b2c3d4e5f60718293a4b")');
    expect(code).toContain('ISODate("2025-01-02T10:00:00Z")');
    expect(code).toContain('NumberDecimal("10.5")');
  });

  it('writes CouchDB _bulk_docs with the type field', () => {
    const body = JSON.parse(couchBulkDocs(withDocs(storeFixture('couchdb'))));
    expect(body.docs).toHaveLength(3);
    expect(body.docs[0].type).toBe('clientes');
    expect(body.docs[1]._id).toBe('65a1b2c3d4e5f60718293a4c');
  });

  it('writes Firestore import files keyed by document id, plus the script', () => {
    const files = firestoreImport(withDocs(storeFixture('firestore')));
    const clientes = JSON.parse(files['clientes.json']);
    expect(clientes.path).toBe('clientes');
    expect(Object.keys(clientes.documents)).toEqual(['65a1b2c3d4e5f60718293a4b', '65a1b2c3d4e5f60718293a4c']);
    expect(clientes.documents['65a1b2c3d4e5f60718293a4b']._id).toBeUndefined();
    expect(clientes.fields.creadoEn).toBe('timestamp');
    expect(files['import-firestore.mjs']).toContain('firebase-admin/firestore');
  });
});
