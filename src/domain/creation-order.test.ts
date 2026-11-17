import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../lib/sample-project';
import { createCollection, createField, createProject, creationOrder } from './model';
import { createRelationship } from './relationships';
import { generateAllDocuments } from './random-values';

const names = (cs: { name: string }[]) => cs.map((c) => c.name);

describe('creation order', () => {
  it('puts referenced collections first, by levels, keeping the model order inside a level', () => {
    const p = createProject('p', 'mongodb');
    const [courses, sessions, users, periods, logs] = ['courses', 'sessions', 'users', 'academicPeriods', 'logs'].map((n) => createCollection('mongodb', n));
    p.collections.push(courses, sessions, users, periods, logs);
    for (const from of [courses, sessions, periods]) createRelationship(p, { kind: 'reference', fromId: from.id, toId: users.id, cardinality: '1:N' });
    // A second level: logs point at sessions.
    createRelationship(p, { kind: 'reference', fromId: logs.id, toId: sessions.id, cardinality: '1:N' });
    expect(names(creationOrder(p))).toEqual(['users', 'courses', 'sessions', 'academicPeriods', 'logs']);
  });

  it('counts reference fields inside arrays and ignores embeds', () => {
    // pedidos references clientes and, through items[].productoId, productos; items is an embed.
    expect(names(creationOrder(createSampleProject()))).toEqual(['clientes', 'productos', 'pedidos']);
    const p = createProject('p', 'mongodb');
    const [a, b] = ['a', 'b'].map((n) => createCollection('mongodb', n));
    b.fields.push(createField({ name: 'x' }));
    p.collections.push(a, b);
    createRelationship(p, { kind: 'embed', fromId: a.id, toId: b.id, cardinality: '1:1' });
    expect(names(creationOrder(p))).toEqual(['a', 'b']);
  });

  it('is not blocked by a reference to itself or by a cycle, and puts subcollections after their parent', () => {
    const p = createProject('p', 'firestore');
    const [chats, categories, a, b] = ['mensajes', 'categorias', 'a', 'b'].map((n) => createCollection('firestore', n));
    const rooms = createCollection('firestore', 'salas');
    chats.kind = 'subcollection';
    chats.parentId = rooms.id;
    p.collections.push(chats, categories, a, b, rooms);
    createRelationship(p, { kind: 'reference', fromId: categories.id, toId: categories.id, cardinality: '1:N' });
    createRelationship(p, { kind: 'reference', fromId: a.id, toId: b.id, cardinality: '1:N' });
    createRelationship(p, { kind: 'reference', fromId: b.id, toId: a.id, cardinality: '1:N' });
    expect(names(creationOrder(p))).toEqual(['categorias', 'salas', 'mensajes', 'a', 'b']);
  });

  it('generates documents for every collection in that order, so references find existing ids', () => {
    const p = createSampleProject();
    const docs = generateAllDocuments(p, { count: 5, locale: 'es' });
    const clientes = new Set(docs[p.collections[0].id].map((d) => JSON.parse(d.json)._id.$oid ?? JSON.parse(d.json)._id));
    const pedidos = docs[p.collections.find((c) => c.name === 'pedidos')!.id].map((d) => JSON.parse(d.json));
    expect(pedidos.every((d) => clientes.has(d.clienteId.$oid ?? d.clienteId))).toBe(true);
  });
});
