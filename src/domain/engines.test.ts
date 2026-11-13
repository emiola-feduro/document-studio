import { describe, expect, it } from 'vitest';
import { changeEngine } from './engine-change';
import { collectionNameProblem, convertType, fieldNameProblem } from './engines';
import { createCollection, createField, createProject } from './model';
import { createRelationship } from './relationships';

describe('engines', () => {
  it('converts types to the closest equivalent', () => {
    expect(convertType('firestore', 'date')).toEqual({ type: 'timestamp', lossy: false });
    expect(convertType('firestore', 'decimal')).toEqual({ type: 'double', lossy: true });
    expect(convertType('couchdb', 'timestamp')).toEqual({ type: 'date', lossy: false });
    expect(convertType('mongodb', 'number')).toEqual({ type: 'double', lossy: false });
    expect(convertType('mongodb', 'string')).toEqual({ type: 'string', lossy: false });
  });

  it('checks names per engine', () => {
    expect(fieldNameProblem('mongodb', '$set')).toBe('dollar');
    expect(fieldNameProblem('mongodb', 'a.b')).toBe('dot');
    expect(fieldNameProblem('firestore', '__x__')).toBe('reserved');
    expect(fieldNameProblem('couchdb', '_secret')).toBe('underscore');
    expect(fieldNameProblem('couchdb', '_id', true)).toBeUndefined();
    expect(collectionNameProblem('firestore', 'a/b')).toBe('slash');
    expect(collectionNameProblem('mongodb', 'system.users')).toBe('system');
  });

  it('switches engine: id fields, types, references and subcollections', () => {
    const project = createProject('p', 'firestore');
    const users = createCollection('firestore', 'users');
    users.fields.push(createField({ name: 'createdAt', type: 'timestamp' }));
    const orders = { ...createCollection('firestore', 'orders'), kind: 'subcollection' as const, parentId: users.id };
    project.collections.push(users, orders);
    createRelationship(project, { kind: 'reference', fromId: orders.id, toId: users.id, cardinality: '1:N' });
    expect(orders.fields.find((f) => f.name === 'userId')?.type).toBe('reference');

    const warnings = changeEngine(project, 'mongodb');
    expect(project.engine).toBe('mongodb');
    expect(users.fields[0]).toMatchObject({ name: '_id', type: 'objectId' });
    expect(users.fields.find((f) => f.name === 'createdAt')?.type).toBe('timestamp');
    expect(orders.fields.find((f) => f.name === 'userId')?.type).toBe('objectId');
    expect(orders.kind).toBe('collection');
    expect(warnings.some((w) => w.includes('orders'))).toBe(true);

    changeEngine(project, 'couchdb');
    expect(users.fields.slice(0, 2).map((f) => f.name)).toEqual(['_id', '_rev']);
    expect(users.fields.find((f) => f.name === 'createdAt')?.type).toBe('date');
    expect(orders.fields.find((f) => f.name === 'userId')?.type).toBe('reference');
  });
});
