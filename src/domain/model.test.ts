import { describe, expect, it } from 'vitest';
import { countFields, createCollection, createField, createProject, nextName, removeCollection } from './model';

describe('createCollection', () => {
  it('adds the id fields of each engine', () => {
    expect(createCollection('mongodb', 'a').fields.map((f) => [f.name, f.type])).toEqual([['_id', 'objectId']]);
    expect(createCollection('couchdb', 'a').fields.map((f) => f.name)).toEqual(['_id', '_rev']);
    expect(createCollection('firestore', 'a').fields).toEqual([]);
  });
});

describe('nextName', () => {
  it('adds a number when the name is taken', () => {
    expect(nextName('colecciones', [])).toBe('colecciones');
    expect(nextName('colecciones', ['Colecciones', 'colecciones_2'])).toBe('colecciones_3');
  });
});

describe('removeCollection', () => {
  it('removes subcollections, relationships and documents', () => {
    const project = createProject('p', 'firestore');
    const users = createCollection('firestore', 'users');
    const orders = { ...createCollection('firestore', 'orders'), kind: 'subcollection' as const, parentId: users.id };
    const items = { ...createCollection('firestore', 'items'), kind: 'subcollection' as const, parentId: orders.id };
    const other = createCollection('firestore', 'other');
    project.collections.push(users, orders, items, other);
    project.relationships.push({
      id: 'r',
      kind: 'reference',
      from: { collectionId: other.id, fieldPath: 'user' },
      to: { collectionId: users.id },
      cardinality: '1:N',
      storage: 'single',
    });
    project.documents = { [users.id]: [{ id: 'd', json: '{}' }], [other.id]: [] };
    removeCollection(project, users.id);
    expect(project.collections.map((c) => c.name)).toEqual(['other']);
    expect(project.relationships).toEqual([]);
    expect(Object.keys(project.documents)).toEqual([other.id]);
  });
});

describe('countFields', () => {
  it('counts nested fields', () => {
    const address = createField({ name: 'address', type: 'object', children: [createField({ name: 'city' })] });
    const items = createField({ name: 'items', type: 'array', items: createField({ type: 'object', children: [createField(), createField()] }) });
    expect(countFields([address, items])).toBe(5);
  });
});
