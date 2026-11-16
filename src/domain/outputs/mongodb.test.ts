import { describe, expect, it } from 'vitest';
import { storeFixture } from './fixtures';
import { bsonSchema, standardSchema } from './json-schema';
import { mongoScript } from './mongodb-script';
import { mongooseOutput } from './mongoose';
import { prismaOutput } from './prisma';

const project = storeFixture('mongodb');
const [customers, orders] = project.collections;

/** Keywords MongoDB's validator rejects inside $jsonSchema (title and description are allowed annotations). */
const FORBIDDEN = ['$ref', 'format', 'default', '$schema', 'definitions', 'id'];
const keysDeep = (value: unknown): string[] =>
  value && typeof value === 'object' ? Object.entries(value).flatMap(([k, v]) => [k, ...keysDeep(v)]) : [];

describe('$jsonSchema', () => {
  it('uses bsonType, required, nested properties, items and constraints', () => {
    const schema = bsonSchema(customers) as Record<string, any>;
    expect(schema.bsonType).toBe('object');
    expect(schema.required).toEqual(['_id', 'nombre', 'email', 'tipo', 'creadoEn']);
    expect(schema.properties.nombre).toEqual({ bsonType: 'string', maxLength: 120 });
    expect(schema.properties.tipo).toEqual({ bsonType: 'string', enum: ['persona', 'empresa'] });
    expect(schema.properties.direccion.properties.ciudad.bsonType).toBe('string');
    expect(schema.properties.puntos.bsonType).toEqual(['int', 'null']);
    const items = (bsonSchema(orders) as Record<string, any>).properties.items;
    expect(items).toMatchObject({ bsonType: 'array', minItems: 1, maxItems: 20, items: { bsonType: 'object', required: ['sku', 'cantidad'] } });
  });

  it('never writes keywords the MongoDB validator rejects', () => {
    const keys = project.collections.flatMap((c) => keysDeep(bsonSchema(c)));
    for (const bad of FORBIDDEN) expect(keys).not.toContain(bad);
  });

  it('adds _id when extra fields are rejected', () => {
    const c = { ...customers, fields: customers.fields.filter((f) => f.name !== '_id'), options: { additionalProperties: false } };
    const schema = bsonSchema(c) as Record<string, any>;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties._id).toEqual({ bsonType: 'objectId' });
  });
});

describe('mongosh script', () => {
  it('creates collections with validators, then indexes with TTL and unique', () => {
    const { code } = mongoScript(project);
    expect(code).toContain('use("tienda");');
    expect(code).toContain('db.createCollection("clientes", {');
    expect(code).toContain('$jsonSchema');
    expect(code).toContain('db.clientes.createIndex({\n  email: 1\n}, {\n  name: "email_1",\n  unique: true\n});');
    expect(code).toContain('"direccion.ciudad": 1');
    expect(code).toContain('expireAfterSeconds: 3600');
    expect(code).toContain('db.pedidos.createIndex({\n  creadoEn: 1\n}, {\n  name: "creadoEn_ttl"');
  });

  it('can update existing collections with collMod', () => {
    expect(mongoScript(project, { collMod: true }).code).toContain('collMod: "clientes"');
  });

  it('puts the time series options in createCollection and leaves the validator out', () => {
    const p = storeFixture('mongodb');
    p.collections[1].options = { timeseries: { timeField: 'creadoEn', granularity: 'minutes' }, ttl: { field: 'creadoEn', seconds: 60 } };
    const { code, warnings } = mongoScript(p);
    expect(code).toContain('timeseries: {\n    timeField: "creadoEn",\n    granularity: "minutes"\n  },\n  expireAfterSeconds: 60');
    expect(warnings).toHaveLength(1);
  });

  it('runs as JavaScript', () => {
    const calls: string[] = [];
    const collection = { createIndex: () => calls.push('index') };
    const db = new Proxy({ createCollection: () => calls.push('create'), runCommand: () => calls.push('run'), getCollection: () => collection }, { get: (target, key) => (key in target ? target[key as keyof typeof target] : collection) });
    new Function('db', 'use', mongoScript(project).code)(db, () => undefined);
    expect(calls.filter((c) => c === 'create')).toHaveLength(2);
    expect(calls.filter((c) => c === 'index').length).toBeGreaterThanOrEqual(3);
  });
});

describe('Mongoose and Prisma', () => {
  it('writes schemas with refs, sub schemas and indexes', () => {
    const { code } = mongooseOutput(project);
    expect(code).toContain("import { Schema, model } from 'mongoose';");
    expect(code).toContain('ref: "Cliente"');
    expect(code).toContain('new Schema({');
    expect(code).toContain('clienteSchema.index({\n  email: 1\n}, {\n  name: "email_1",\n  unique: true\n});');
    expect(code).toContain('export const Pedido = model("Pedido", pedidoSchema);');
  });

  it('writes Prisma models, composite types, relations and indexes', () => {
    const { code } = prismaOutput(project);
    expect(code).toContain('provider = "mongodb"');
    expect(code).toContain('model Cliente {');
    expect(code).toContain('id String @id @default(auto()) @map("_id") @db.ObjectId');
    expect(code).toContain('clienteId String @db.ObjectId');
    expect(code).toContain('cliente Cliente @relation("Pedido_clienteId", fields: [clienteId], references: [id])');
    expect(code).toContain('pedidos Pedido[] @relation("Pedido_clienteId")');
    expect(code).toContain('type ClienteDireccion {');
    expect(code).toContain('enum ClienteTipo {');
    expect(code).toContain('@@unique([email], map: "email_1")');
    expect(code).toContain('@@map("clientes")');
  });
});

describe('JSON Schema 2020-12', () => {
  it('uses standard types and formats', () => {
    const schema = standardSchema(project, customers) as Record<string, any>;
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.properties._id).toEqual({ type: 'string', pattern: '^[a-f0-9]{24}$' });
    expect(schema.properties.creadoEn).toEqual({ type: 'string', format: 'date-time' });
    expect(schema.properties.puntos).toEqual({ type: ['integer', 'null'], minimum: 0 });
  });
});
