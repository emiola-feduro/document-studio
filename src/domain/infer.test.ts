import { describe, expect, it } from 'vitest';
import { importFirestoreIndexes, importJsonSchema, inferFields, parseDocumentsText, planImport } from './infer';
import { createCollection, createProject } from './model';
import { walkFields } from './paths';
import { bsonSchema } from './outputs/json-schema';
import { storeFixture } from './outputs/fixtures';

describe('parseDocumentsText', () => {
  it('reads arrays, NDJSON, single objects and wrappers', () => {
    expect(parseDocumentsText('[{"a":1},{"a":2}]')).toHaveLength(2);
    expect(parseDocumentsText('{"a":1}\n{"a":2}\n')).toHaveLength(2);
    expect(parseDocumentsText('{"a":1}')).toHaveLength(1);
    expect(parseDocumentsText('{"docs":[{"a":1}]}')).toHaveLength(1);
    expect(() => parseDocumentsText('{"a":1}\nnope')).toThrow();
  });
});

describe('inferFields', () => {
  const docs = [
    { _id: { $oid: '65a1b2c3d4e5f60718293a4b' }, nombre: 'Ana', edad: 30, estado: 'activo', creado: { $date: '2025-01-01T00:00:00Z' }, direccion: { ciudad: 'Lima', zip: '15001' }, tags: ['a', 'b'], items: [{ sku: 'A', qty: 1 }] },
    { _id: { $oid: '65a1b2c3d4e5f60718293a4c' }, nombre: 'Luis', edad: 31.5, estado: 'inactivo', creado: '2025-02-01T00:00:00Z', direccion: { ciudad: 'Quito' }, tags: [], items: [{ sku: 'B', qty: 2, note: 'x' }] },
    { _id: { $oid: '65a1b2c3d4e5f60718293a4d' }, nombre: 'Eva', edad: null, estado: 'activo', creado: '2025-03-01T00:00:00Z', mixto: 1 },
    { _id: { $oid: '65a1b2c3d4e5f60718293a4e' }, nombre: 'Leo', edad: 40, estado: 'activo', creado: '2025-04-01T00:00:00Z', mixto: 'a' },
    { _id: { $oid: '65a1b2c3d4e5f60718293a4f' }, nombre: 'Mia', edad: 22, estado: 'inactivo', creado: '2025-05-01T00:00:00Z' },
  ];
  const result = inferFields(docs, 'mongodb');
  const at = (path: string) => walkFields(result.fields).find((e) => e.path === path)?.field;

  it('infers types, presence, nesting and arrays', () => {
    expect(at('_id')).toMatchObject({ type: 'objectId', required: true });
    expect(at('nombre')).toMatchObject({ type: 'string', required: true });
    expect(at('edad')).toMatchObject({ type: 'double', nullable: true });
    expect(at('creado')).toMatchObject({ type: 'date', required: true });
    expect(at('direccion')).toMatchObject({ type: 'object', required: false });
    expect(at('direccion.ciudad')?.required).toBe(true);
    expect(at('direccion.zip')?.required).toBe(false);
    expect(at('tags')?.items?.type).toBe('string');
    expect(at('items[].note')?.required).toBe(false);
  });

  it('finds enum candidates and warns about mixed types', () => {
    expect(at('estado')).toMatchObject({ type: 'enum', enumValues: ['activo', 'inactivo'] });
    expect(at('mixto')?.type).toBe('any');
    expect(result.warnings.some((w) => w.includes('mixto'))).toBe(true);
  });
});

describe('planImport', () => {
  it('detects references between imported collections', () => {
    const project = createProject('p', 'mongodb');
    const plan = planImport(project, [
      { name: 'users', docs: [{ _id: 'u1', name: 'A' }, { _id: 'u2', name: 'B' }] },
      { name: 'posts', docs: [{ _id: 'p1', userId: 'u1' }, { _id: 'p2', userId: 'u2' }] },
    ]);
    expect(plan.relationships).toHaveLength(1);
    const posts = plan.collections[1].collection;
    expect(posts.fields.find((f) => f.name === 'userId')?.reference?.collectionId).toBe(plan.collections[0].collection.id);
    expect(plan.collections[1].documents).toHaveLength(2);
  });
});

describe('importJsonSchema', () => {
  it('round trips a generated $jsonSchema', () => {
    const source = storeFixture('mongodb').collections[0];
    const text = JSON.stringify({ validator: { $jsonSchema: bsonSchema(source) } });
    const [c] = importJsonSchema(text, 'mongodb', 'clientes');
    expect(walkFields(c.fields).map((e) => `${e.path}:${e.field.type}:${e.field.required}`)).toEqual(walkFields(source.fields).map((e) => `${e.path}:${e.field.type}:${e.field.required}`));
    expect(c.fields.find((f) => f.name === 'puntos')).toMatchObject({ nullable: true, minimum: 0 });
  });

  it('reads db.getCollectionInfos() output', () => {
    const text = JSON.stringify([{ name: 'a', options: { validator: { $jsonSchema: { bsonType: 'object', properties: { x: { bsonType: 'int' } } } } } }, { name: 'b', options: {} }]);
    const cs = importJsonSchema(text, 'mongodb', 'z');
    expect(cs.map((c) => c.name)).toEqual(['a']);
  });
});

describe('importFirestoreIndexes', () => {
  it('adds composite indexes to collections by name', () => {
    const project = createProject('p', 'firestore');
    project.collections.push(createCollection('firestore', 'posts'));
    const added = importFirestoreIndexes(project, JSON.stringify({ indexes: [{ collectionGroup: 'posts', queryScope: 'COLLECTION_GROUP', fields: [{ fieldPath: 'a', order: 'ASCENDING' }, { fieldPath: 'b', order: 'DESCENDING' }] }] }));
    expect(added).toBe(1);
    expect(project.collections[0].indexes[0]).toMatchObject({ keys: [{ path: 'a', order: 1 }, { path: 'b', order: -1 }], scope: 'collectionGroup' });
  });
});
