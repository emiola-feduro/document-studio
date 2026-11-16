import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../../lib/sample-project';
import { createProject } from '../model';
import { fieldAtPath } from '../paths';
import { detectFormat, detectNamesLocale, readSource } from './index';
import { mongoosePlural, readMongoose } from './mongoose';
import { readPrisma } from './prisma';

const MONGOOSE = `
const mongoose = require('mongoose');
const { Schema, model } = mongoose;

// Address subdocument
const addressSchema = new Schema({
  street: String,
  city: { type: String, required: true },
  zip: { type: String, match: /^[0-9]{5}$/ },
}, { _id: false });

const customerSchema = new Schema({
  name: { type: String, required: [true, 'Name is required'], maxlength: 120, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, match: /^\\S+@\\S+\\.\\S+$/ },
  address: addressSchema,
  tags: [String],
  status: { type: String, enum: ['active', 'blocked'], default: 'active' },
  createdAt: { type: Date, default: Date.now },
}, { timestamps: { createdAt: false, updatedAt: true } });

customerSchema.virtual('displayName').get(function () { return this.name; });
customerSchema.pre('save', function (next) { next(); });

const orderSchema = new Schema({
  customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
  items: [{
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    quantity: { type: Number, min: 1, validate: { validator: Number.isInteger } },
    price: mongoose.Types.Decimal128,
  }],
  total: Number,
  shippedAt: Date,
  meta: {},
});
orderSchema.index({ customer: 1, shippedAt: -1 }, { name: 'by_customer' });

const productSchema = new Schema({ name: String, price: Number, stock: { type: Number, default: 0 } });

module.exports = {
  Customer: mongoose.model('Customer', customerSchema),
  Order: mongoose.model('Order', orderSchema),
  Product: model('Product', productSchema, 'catalog'),
};
`;

const PRISMA = `
datasource db {
  provider = "mongodb"
  url      = env("DATABASE_URL")
}

enum Role {
  USER
  ADMIN
}

type Address {
  street String
  city   String
  zip    String?
}

model User {
  id        String   @id @default(auto()) @map("_id") @db.ObjectId
  email     String   @unique
  name      String?
  role      Role     @default(USER)
  address   Address?
  posts     Post[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("users")
}

model Post {
  id        String   @id @default(auto()) @map("_id") @db.ObjectId
  title     String
  published Boolean  @default(false)
  author    User     @relation(fields: [authorId], references: [id])
  authorId  String   @db.ObjectId
  tagIds    String[] @db.ObjectId
  tags      Tag[]    @relation(fields: [tagIds], references: [id])
  views     Int      @default(0)

  @@index([authorId, title(sort: Desc)])
}

model Tag {
  id      String   @id @default(auto()) @map("_id") @db.ObjectId
  name    String   @unique
  postIds String[] @db.ObjectId
  posts   Post[]   @relation(fields: [postIds], references: [id])
}
`;

describe('Mongoose import', () => {
  const result = readMongoose(MONGOOSE, 'mongodb');
  const coll = (name: string) => result.collections.find((c) => c.name === name)!;

  it('names collections like Mongoose and reads types, options and subschemas', () => {
    expect(result.collections.map((c) => c.name)).toEqual(['customers', 'orders', 'catalog']);
    const customers = coll('customers');
    expect(customers.fields.map((f) => f.name)).toEqual(['_id', 'name', 'email', 'address', 'tags', 'status', 'createdAt', 'updatedAt']);
    expect(fieldAtPath(customers.fields, 'name')).toMatchObject({ type: 'string', required: true, maxLength: 120 });
    expect(fieldAtPath(customers.fields, 'email')).toMatchObject({ required: true, pattern: '^\\S+@\\S+\\.\\S+$' });
    expect(fieldAtPath(customers.fields, 'address.city')).toMatchObject({ type: 'string', required: true });
    expect(fieldAtPath(customers.fields, 'address.zip')?.pattern).toBe('^[0-9]{5}$');
    expect(fieldAtPath(customers.fields, 'tags')).toMatchObject({ type: 'array', items: { type: 'string' } });
    expect(fieldAtPath(customers.fields, 'status')).toMatchObject({ type: 'enum', enumValues: ['active', 'blocked'], defaultValue: '"active"' });
    expect(fieldAtPath(customers.fields, 'createdAt')).toMatchObject({ type: 'date', defaultValue: 'now()' });
    expect(customers.indexes).toMatchObject([{ keys: [{ path: 'email', order: 1 }], unique: true }]);
  });

  it('turns ref into references, reads schema.index and arrays of subdocuments', () => {
    const orders = coll('orders');
    expect(fieldAtPath(orders.fields, 'customer')).toMatchObject({ type: 'objectId', required: true, reference: { collectionId: coll('customers').id } });
    expect(fieldAtPath(orders.fields, 'items.product')?.reference?.collectionId).toBe(coll('catalog').id);
    expect(fieldAtPath(orders.fields, 'items.quantity')).toMatchObject({ type: 'double', minimum: 1 });
    expect(fieldAtPath(orders.fields, 'items.price')?.type).toBe('decimal');
    expect(fieldAtPath(orders.fields, 'meta')?.type).toBe('any');
    expect(orders.indexes.map((i) => [i.name, i.keys.map((k) => `${k.path}:${k.order}`).join(',')])).toEqual([
      ['', 'customer:1'],
      ['by_customer', 'customer:1,shippedAt:-1'],
    ]);
    expect(result.relationships.map((r) => [r.from.fieldPath, r.cardinality, r.storage])).toEqual([
      ['customer', '1:N', 'single'],
      ['items[].product', 'N:M', 'single'],
    ]);
  });

  it('lists what has no place in the model', () => {
    expect(result.skipped.join('\n')).toMatch(/virtual/);
    expect(result.skipped.join('\n')).toMatch(/pre/);
    expect(result.skipped.join('\n')).toMatch(/validate/);
    expect(mongoosePlural('Category')).toBe('categories');
    expect(mongoosePlural('Box')).toBe('boxes');
  });
});

describe('Prisma import', () => {
  const result = readPrisma(PRISMA, 'mongodb');
  const coll = (name: string) => result.collections.find((c) => c.name === name)!;

  it('reads models, @@map, enums, composite types and defaults', () => {
    expect(result.collections.map((c) => c.name)).toEqual(['users', 'Post', 'Tag']);
    const users = coll('users');
    expect(users.fields.map((f) => f.name)).toEqual(['_id', 'email', 'name', 'role', 'address', 'createdAt', 'updatedAt']);
    expect(users.fields[0].type).toBe('objectId');
    expect(fieldAtPath(users.fields, 'name')).toMatchObject({ required: false, nullable: true });
    expect(fieldAtPath(users.fields, 'role')).toMatchObject({ type: 'enum', enumValues: ['USER', 'ADMIN'], defaultValue: '"USER"' });
    expect(fieldAtPath(users.fields, 'address.zip')).toMatchObject({ required: false });
    expect(fieldAtPath(users.fields, 'createdAt')?.defaultValue).toBe('now()');
    expect(users.indexes).toMatchObject([{ keys: [{ path: 'email' }], unique: true }]);
    expect(result.skipped.join('\n')).toMatch(/updatedAt/);
  });

  it('turns @relation fields into references and reads @@index with sort', () => {
    const post = coll('Post');
    expect(fieldAtPath(post.fields, 'authorId')).toMatchObject({ type: 'objectId', reference: { collectionId: coll('users').id } });
    expect(fieldAtPath(post.fields, 'tagIds')).toMatchObject({ type: 'array', items: { type: 'objectId', reference: { collectionId: coll('Tag').id } } });
    expect(post.fields.some((f) => f.name === 'author' || f.name === 'tags')).toBe(false);
    expect(post.indexes[0].keys).toEqual([
      { path: 'authorId', order: 1 },
      { path: 'title', order: -1 },
    ]);
    expect(result.relationships.map((r) => r.from.fieldPath)).toEqual(['authorId', 'tagIds', 'postIds']);
  });
});

describe('format and names language', () => {
  it('detects each format', () => {
    expect(detectFormat(MONGOOSE)).toBe('mongoose');
    expect(detectFormat(PRISMA)).toBe('prisma');
    expect(detectFormat('[{ "a": 1 }]')).toBe('documents');
    expect(detectFormat('{ "a": 1 }\n{ "a": 2 }')).toBe('documents');
    expect(detectFormat('{ "$jsonSchema": { "bsonType": "object" } }')).toBe('jsonSchema');
    expect(detectFormat('{ "indexes": [{ "collectionGroup": "a", "fields": [] }], "fieldOverrides": [] }')).toBe('firestoreIndexes');
    expect(detectFormat('hola')).toBeUndefined();
  });

  it('picks the language whose singulars explain the reference fields', () => {
    const sample = createSampleProject();
    expect(detectNamesLocale(sample.collections, sample.relationships.filter((r) => r.kind === 'reference'))).toBe('es');
    const docs = readSource(createProject('p', 'mongodb'), 'documents', [
      { name: 'categories', text: '[{ "_id": "c1", "name": "A" }]' },
      { name: 'products', text: '[{ "_id": "p1", "categoryId": "c1" }]' },
    ]);
    expect(detectNamesLocale(docs.collections, docs.relationships)).toBe('en');
    const prisma = readPrisma(PRISMA, 'mongodb');
    expect(detectNamesLocale(prisma.collections, prisma.relationships)).toBe('en');
    expect(detectNamesLocale([], [])).toBeUndefined();
  });
});
