import { describe, expect, it } from 'vitest';
import { createCollection, createField } from '../model';
import { storeFixture } from './fixtures';
import { firestoreIndexes } from './firestore-indexes';
import { firestoreRules } from './firestore-rules';
import { firestoreTypes } from './firestore-types';

describe('firestore.rules', () => {
  const project = storeFixture('firestore');
  const { code } = firestoreRules(project);

  it('declares version 2 and a validation function per collection', () => {
    expect(code.startsWith("rules_version = '2';")).toBe(true);
    expect(code).toContain('function isValidClientes(data) {');
    expect(code).toContain('match /clientes/{clienteId} {');
    expect(code).toContain('allow create, update: if request.auth != null && isValidClientes(request.resource.data);');
  });

  it('checks required keys, types, sizes, patterns and enums', () => {
    expect(code).toContain("data.keys().hasAll(['nombre', 'email', 'tipo', 'creadoEn'])");
    expect(code).toContain('(data.nombre is string && data.nombre.size() <= 120)');
    expect(code).toContain("data.email.matches('[^@]+@[^@]+')");
    expect(code).toContain("data.tipo in ['persona', 'empresa']");
    expect(code).toContain('data.creadoEn is timestamp');
    expect(code).toContain("(!('direccion' in data) || (data.direccion is map && data.direccion.keys().hasAll(['ciudad']) && data.direccion.ciudad is string))");
    expect(code).toContain("(!('puntos' in data) || (data.puntos == null || (data.puntos is int && data.puntos >= 0)))");
    expect(code).toContain('data.clienteId is path');
    expect(code).toContain('(data.items is list && data.items.size() >= 1 && data.items.size() <= 20)');
  });

  it('nests subcollections and uses hasOnly when extra fields are rejected', () => {
    const p = storeFixture('firestore');
    p.collections[1].kind = 'subcollection';
    p.collections[1].parentId = p.collections[0].id;
    p.collections[0].options.additionalProperties = false;
    const rules = firestoreRules(p).code;
    expect(rules).toMatch(/match \/clientes\/\{clienteId\} \{[\s\S]*match \/pedidos\/\{pedidoId\} \{/);
    expect(rules).toContain("data.keys().hasOnly(['nombre', 'email', 'tipo', 'direccion', 'creadoEn', 'puntos'])");
  });
});

describe('firestore.indexes.json', () => {
  it('writes composite indexes, array CONTAINS and TTL overrides', () => {
    const project = storeFixture('firestore');
    project.collections[1].indexes.push({ id: 'x', name: '', nameIsCustom: false, keys: [{ path: 'items', order: 1 }, { path: 'total', order: -1 }], scope: 'collectionGroup' });
    const data = JSON.parse(firestoreIndexes(project).code);
    expect(data.indexes).toContainEqual({ collectionGroup: 'clientes', queryScope: 'COLLECTION', fields: [{ fieldPath: 'direccion.ciudad', order: 'ASCENDING' }, { fieldPath: 'creadoEn', order: 'DESCENDING' }] });
    expect(data.indexes).toContainEqual({ collectionGroup: 'pedidos', queryScope: 'COLLECTION_GROUP', fields: [{ fieldPath: 'items', arrayConfig: 'CONTAINS' }, { fieldPath: 'total', order: 'DESCENDING' }] });
    expect(data.fieldOverrides).toContainEqual({ collectionGroup: 'pedidos', fieldPath: 'creadoEn', ttl: true, indexes: [] });
  });
});

describe('TypeScript types', () => {
  it('writes types, converters and typed references for subcollections', () => {
    const project = storeFixture('firestore');
    const sub = createCollection('firestore', 'notas');
    sub.kind = 'subcollection';
    sub.parentId = project.collections[0].id;
    sub.fields.push(createField({ name: 'texto', required: true }));
    project.collections.push(sub);
    const { code } = firestoreTypes(project);
    expect(code).toContain('export type Cliente = {');
    expect(code).toContain('tipo: "persona" | "empresa";');
    expect(code).toContain('creadoEn: Timestamp;');
    expect(code).toContain('clienteId: DocumentReference;');
    expect(code).toContain('export const notasCollection = (db: Firestore, clienteId: string) =>\n  collection(db, "clientes", clienteId, "notas")');
  });
});
