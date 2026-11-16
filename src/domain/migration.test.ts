import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../lib/sample-project';
import { changeEngine } from './engine-change';
import { diffModels, type Snapshot } from './migration';
import { createField } from './model';
import type { Collection } from './types';

const snapshot = (): Snapshot => {
  const { documents: _documents, ...rest } = createSampleProject();
  void _documents;
  return rest;
};

const coll = (s: Snapshot, name: string) => s.collections.find((c) => c.name === name)!;
const field = (c: Collection, name: string) => c.fields.find((f) => f.name === name)!;

/** Runs a mongosh migration against a fake db and returns every call it makes. */
const runShell = (code: string) => {
  const calls: { target: string; method: string; args: unknown[] }[] = [];
  const collection = (target: string) =>
    new Proxy({}, { get: (_t, method) => (...args: unknown[]) => (calls.push({ target, method: String(method), args }), { forEach: () => {} }) });
  const db = new Proxy(
    {},
    {
      get: (_t, name) => {
        if (name === 'runCommand') return (cmd: unknown) => calls.push({ target: 'db', method: 'runCommand', args: [cmd] });
        if (name === 'createCollection') return (...args: unknown[]) => calls.push({ target: 'db', method: 'createCollection', args });
        if (name === 'getCollection') return (n: string) => collection(n);
        return collection(String(name));
      },
    },
  );
  new Function('db', 'use', 'ObjectId', 'UUID', code)(db, () => {}, () => 'oid', () => 'uuid');
  return calls;
};

describe('migration', () => {
  it('finds no changes between equal models', () => {
    const a = snapshot();
    const result = diffModels(a, structuredClone(a));
    expect(result.changes).toEqual([]);
    expect(runShell(result.files[0].code)).toEqual([]);
  });

  it('renames by id, fills new required fields, unsets removed ones and converts types in MongoDB', () => {
    const before = snapshot();
    const after = structuredClone(before);
    const clientes = coll(after, 'clientes');
    field(clientes, 'nombre').name = 'nombreCompleto';
    clientes.fields.push(createField({ name: 'activo', type: 'bool', required: true, defaultValue: 'true' }));
    clientes.fields = clientes.fields.filter((f) => f.name !== 'creadoEn');
    const productos = coll(after, 'productos');
    field(productos, 'stock').type = 'double';
    field(productos, 'precio').type = 'int';

    const { changes, files } = diffModels(before, after, {}, { from: 'v1', to: 'v2' });
    expect(changes.map((c) => [c.kind, c.collection, c.detail, Boolean(c.destructive)])).toEqual([
      ['renameField', 'clientes', 'nombre → nombreCompleto', false],
      ['addField', 'clientes', 'activo', false],
      ['dropField', 'clientes', 'creadoEn', true],
      ['changeType', 'productos', 'precio: decimal → int', true],
      ['changeType', 'productos', 'stock: int → double', false],
    ]);
    const calls = runShell(files[0].code);
    const updates = calls.filter((c) => c.method === 'updateMany');
    expect(updates.map((c) => [c.target, c.args])).toEqual([
      ['clientes', [{ nombre: { $exists: true } }, { $rename: { nombre: 'nombreCompleto' } }]],
      ['clientes', [{ activo: { $exists: false } }, { $set: { activo: true } }]],
      ['clientes', [{}, { $unset: { creadoEn: '' } }]],
      ['productos', [{ precio: { $exists: true } }, [{ $set: { precio: { $toInt: '$precio' } } }]]],
      ['productos', [{ stock: { $exists: true } }, [{ $set: { stock: { $toDouble: '$stock' } } }]]],
    ]);
    // Validation is off while the data changes, then the new validator applies.
    const commands = calls.filter((c) => c.method === 'runCommand').map((c) => c.args[0] as Record<string, unknown>);
    expect(commands[0]).toEqual({ collMod: 'clientes', validationLevel: 'off' });
    expect(commands[1]).toMatchObject({ collMod: 'clientes', validationLevel: 'strict' });
    expect(JSON.stringify(commands[1])).toContain('nombreCompleto');
  });

  it('moves a field to another level and renames a field inside an array of subdocuments', () => {
    const before = snapshot();
    const after = structuredClone(before);
    const clientes = coll(after, 'clientes');
    const direccion = field(clientes, 'direccion');
    const ciudad = direccion.children!.find((f) => f.name === 'ciudad')!;
    direccion.children = direccion.children!.filter((f) => f !== ciudad);
    clientes.fields.push(ciudad);
    const pedidos = coll(after, 'pedidos');
    field(pedidos, 'items').items!.children!.find((f) => f.name === 'cantidad')!.name = 'unidades';

    const { changes, files } = diffModels(before, after);
    expect(changes.filter((c) => c.kind === 'moveField' || c.kind === 'renameField').map((c) => c.detail)).toEqual(['direccion.ciudad → ciudad', 'items.cantidad → items.unidades']);
    const updates = runShell(files[0].code).filter((c) => c.method === 'updateMany');
    expect(updates[0].args).toEqual([{ 'direccion.ciudad': { $exists: true } }, { $rename: { 'direccion.ciudad': 'ciudad' } }]);
    expect(JSON.stringify(updates[1].args)).toContain('"$map"');
    expect(JSON.stringify(updates[1].args)).toContain('"unidades":"$$item.cantidad"');
  });

  it('renames a field whose parent was renamed too, from the parent new path', () => {
    const before = snapshot();
    const after = structuredClone(before);
    const direccion = field(coll(after, 'clientes'), 'direccion');
    direccion.name = 'domicilio';
    direccion.children!.find((f) => f.name === 'calle')!.name = 'via';
    const updates = runShell(diffModels(before, after).files[0].code).filter((c) => c.method === 'updateMany');
    expect(updates.map((u) => (u.args[1] as { $rename: unknown }).$rename)).toEqual([{ direccion: 'domicilio' }, { 'domicilio.calle': 'domicilio.via' }]);
  });

  it('marks destructive changes and writes index, collection and schemaVersion steps', () => {
    const before = snapshot();
    const after = structuredClone(before);
    const clientes = coll(after, 'clientes');
    field(clientes, 'nombre').maxLength = 60;
    clientes.fields.push(createField({ name: 'pais', type: 'string', required: true }));
    clientes.indexes.push({ id: 'i2', name: '', nameIsCustom: false, keys: [{ path: 'pais', order: 1 }] });
    const pedidos = coll(after, 'pedidos');
    pedidos.indexes = pedidos.indexes.filter((i) => i.name !== 'clienteId_1');
    after.collections = after.collections.filter((c) => c.name !== 'productos');
    coll(after, 'pedidos').name = 'ordenes';

    const { changes, files } = diffModels(before, after, { bumpSchemaVersion: true, previousSchemaVersion: 1 });
    const destructive = changes.filter((c) => c.destructive).map((c) => c.kind);
    expect(destructive).toEqual(expect.arrayContaining(['shrinkLength', 'addField', 'dropCollection']));
    const calls = runShell(files[0].code);
    expect(calls[0]).toEqual({ target: 'pedidos', method: 'renameCollection', args: ['ordenes'] });
    expect(calls).toContainEqual({ target: 'clientes', method: 'createIndex', args: [{ pais: 1 }, { name: 'pais_1' }] });
    expect(calls).toContainEqual({ target: 'ordenes', method: 'dropIndex', args: ['clienteId_1'] });
    expect(calls).toContainEqual({ target: 'clientes', method: 'updateMany', args: [{ schemaVersion: 1 }, { $inc: { schemaVersion: 1 } }] });
    expect(calls.at(-1)).toEqual({ target: 'productos', method: 'drop', args: [] });
  });

  it('writes a Firestore Admin script in batches of 500 plus the new rules and indexes', () => {
    const before = snapshot();
    changeEngine(before as never, 'firestore');
    const after = structuredClone(before);
    const clientes = coll(after, 'clientes');
    field(clientes, 'nombre').name = 'nombreCompleto';
    clientes.fields.push(createField({ name: 'alta', type: 'timestamp', required: true, defaultValue: 'now()' }));
    const { files } = diffModels(before, after);
    expect(files.map((f) => f.name)).toEqual(['migrate-firestore.mjs', 'firestore.rules', 'firestore.indexes.json']);
    expect(files[0].code).toContain("limit(500)");
    expect(files[0].code).toContain('batch.commit()');
    expect(files[0].code).toContain('set(doc, "nombreCompleto", get(doc, "nombre"))');
    expect(files[0].code).toContain('set(doc, "alta", Timestamp.now())');
    expect(files[1].code).toContain('nombreCompleto');
  });

  it('writes a CouchDB script that changes each document of the type and skips the rest', () => {
    const before = snapshot();
    changeEngine(before as never, 'couchdb');
    const after = structuredClone(before);
    const clientes = coll(after, 'clientes');
    field(clientes, 'nombre').name = 'nombreCompleto';
    field(coll(after, 'pedidos'), 'items').items!.children!.find((f) => f.name === 'cantidad')!.type = 'string';
    const { files } = diffModels(before, after, { bumpSchemaVersion: true });
    const code = files[0].code;
    expect(files[1].name).toBe('design-docs.json');
    // Run the change functions on real documents.
    const start = code.indexOf('const get');
    const changesEnd = code.indexOf('const all');
    const changes = new Function(`${code.slice(start, changesEnd)}; return changes;`)() as Record<string, (doc: Record<string, unknown>) => boolean>;
    const cliente: Record<string, unknown> = { _id: 'c1', type: 'clientes', nombre: 'Ana' };
    changes.clientes(cliente);
    expect(cliente).toEqual({ _id: 'c1', type: 'clientes', nombreCompleto: 'Ana', schemaVersion: 1 });
    const pedido: Record<string, unknown> = { _id: 'p1', type: 'pedidos', items: [{ cantidad: 2 }, { cantidad: 3 }] };
    changes.pedidos(pedido);
    expect(pedido.items).toEqual([{ cantidad: '2' }, { cantidad: '3' }]);
  });
});
