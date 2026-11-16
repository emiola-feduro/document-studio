import { nativeType } from '../engines';
import type { Collection, EngineId, Field, Project } from '../types';
import { json, parseLiteral } from './shared';

type Schema = Record<string, unknown>;

const BSON: Partial<Record<Field['type'], string>> = {
  string: 'string',
  enum: 'string',
  int: 'int',
  long: 'long',
  double: 'double',
  decimal: 'decimal',
  number: 'number',
  bool: 'bool',
  date: 'date',
  timestamp: 'timestamp',
  objectId: 'objectId',
  reference: 'objectId',
  uuid: 'binData',
  binary: 'binData',
  object: 'object',
  array: 'array',
  null: 'null',
  geoPoint: 'object',
};

const constraints = (field: Field, out: Schema) => {
  if (field.type === 'enum' && field.enumValues?.length) out.enum = field.nullable ? [...field.enumValues, null] : [...field.enumValues];
  if (field.minLength !== undefined) out.minLength = field.minLength;
  if (field.maxLength !== undefined) out.maxLength = field.maxLength;
  if (field.pattern) out.pattern = field.pattern;
  if (field.minimum !== undefined) out.minimum = field.minimum;
  if (field.maximum !== undefined) out.maximum = field.maximum;
  if (field.minItems !== undefined) out.minItems = field.minItems;
  if (field.maxItems !== undefined) out.maxItems = field.maxItems;
  if (field.uniqueItems) out.uniqueItems = true;
};

export type BsonOptions = { additionalProperties?: boolean };

/**
 * MongoDB `$jsonSchema` for a field. The validator accepts `title` and `description` as annotations
 * at any level, and rejects `$ref`, `$schema`, `default`, `definitions`, `format` and `id`, which are
 * never written.
 */
export const bsonFieldSchema = (field: Field, options: BsonOptions = {}): Schema => {
  const out: Schema = {};
  if (field.type === 'geoPoint') {
    out.bsonType = field.nullable ? ['object', 'null'] : 'object';
    out.required = ['type', 'coordinates'];
    out.properties = {
      type: { enum: ['Point'] },
      coordinates: { bsonType: 'array', minItems: 2, maxItems: 2, items: { bsonType: ['double', 'int', 'long', 'decimal'] } },
    };
  } else if (field.type !== 'any') {
    const bson = BSON[field.type] ?? 'string';
    out.bsonType = field.nullable && bson !== 'null' ? (field.nullFirst ? ['null', bson] : [bson, 'null']) : bson;
  }
  if (field.title) out.title = field.title;
  if (field.description) out.description = field.description;
  constraints(field, out);
  if (field.minimum !== undefined && field.exclusiveMin) out.exclusiveMinimum = true;
  // An object with no fields declared says only that it is an object.
  if (field.type === 'object' && (field.children?.length || options.additionalProperties === false)) Object.assign(out, bsonObject(field.children ?? [], options));
  if (field.type === 'array' && field.items) out.items = bsonFieldSchema(field.items, options);
  return out;
};

const bsonObject = (fields: Field[], options: BsonOptions, root = false): Schema => {
  const out: Schema = {};
  const required = fields.filter((f) => f.required && f.name).map((f) => f.name);
  if (required.length) out.required = required;
  out.properties = Object.fromEntries(fields.filter((f) => f.name).map((f) => [f.name, bsonFieldSchema(f, options)]));
  // `additionalProperties: false` at the root needs `_id` in properties, which MongoDB always adds.
  if (options.additionalProperties === false) {
    out.additionalProperties = false;
    if (root && !fields.some((f) => f.name === '_id')) (out.properties as Schema)._id = { bsonType: 'objectId' };
  }
  return out;
};

export const bsonSchema = (collection: Collection): Schema => {
  const { validatorTitle, idInValidator, additionalProperties } = collection.options;
  // A validator written without _id keeps it out, as MongoDB adds it anyway.
  const fields = idInValidator === false ? collection.fields.filter((f) => f.name !== '_id') : collection.fields;
  return {
    bsonType: 'object',
    ...(validatorTitle ? { title: validatorTitle } : {}),
    ...bsonObject(fields, { additionalProperties }, true),
  };
};

/** The whole validator: $jsonSchema, joined with $and to the other conditions ($expr...) when there are any. */
export const validatorOf = (collection: Collection): Schema => {
  const schema = { $jsonSchema: bsonSchema(collection) };
  const extra = collection.options.extraValidator?.trim();
  if (!extra) return schema;
  try {
    const parsed = JSON.parse(extra) as unknown;
    const parts = Array.isArray(parsed) ? parsed : [parsed];
    return { $and: [schema, ...parts] };
  } catch {
    return schema;
  }
};

export const mongoJsonSchemaOutput = (project: Project) => ({
  code: json(Object.fromEntries(project.collections.map((c) => [c.name, validatorOf(c)]))),
  warnings: [] as string[],
});

/* Standard JSON Schema 2020-12, for validation in a backend or a frontend. */

const OBJECT_ID = { type: 'string', pattern: '^[a-f0-9]{24}$' };

const stdType = (field: Field, engine: EngineId): Schema => {
  switch (field.type) {
    case 'string':
    case 'decimal':
      return field.type === 'decimal' ? { type: 'string', pattern: '^-?[0-9]+(\\.[0-9]+)?$' } : { type: 'string' };
    case 'enum':
      return { type: 'string' };
    case 'int':
    case 'long':
      return { type: 'integer' };
    case 'double':
    case 'number':
      return { type: 'number' };
    case 'bool':
      return { type: 'boolean' };
    case 'date':
    case 'timestamp':
      return { type: 'string', format: 'date-time' };
    case 'objectId':
      return { ...OBJECT_ID };
    case 'reference':
      return engine === 'mongodb' ? { ...OBJECT_ID } : { type: 'string' };
    case 'uuid':
      return { type: 'string', format: 'uuid' };
    case 'binary':
      return { type: 'string', contentEncoding: 'base64' };
    case 'null':
      return { type: 'null' };
    case 'geoPoint':
      return engine === 'mongodb'
        ? {
            type: 'object',
            required: ['type', 'coordinates'],
            properties: { type: { const: 'Point' }, coordinates: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 } },
          }
        : { type: 'object', required: ['latitude', 'longitude'], properties: { latitude: { type: 'number' }, longitude: { type: 'number' } } };
    case 'object':
      return { type: 'object' };
    case 'array':
      return { type: 'array' };
    default:
      return {};
  }
};

export const standardFieldSchema = (field: Field, engine: EngineId, additionalProperties?: boolean): Schema => {
  const out = stdType(field, engine);
  if (field.nullable && typeof out.type === 'string' && out.type !== 'null') out.type = [out.type, 'null'];
  if (field.description) out.description = field.description;
  const def = parseLiteral(field.defaultValue);
  if (def !== undefined && !(typeof def === 'string' && def.endsWith('()'))) out.default = def;
  constraints(field, out);
  if (field.minimum !== undefined && field.exclusiveMin) {
    out.exclusiveMinimum = field.minimum;
    delete out.minimum;
  }
  if (field.type === 'object') Object.assign(out, standardObject(field.children ?? [], engine, additionalProperties));
  if (field.type === 'array' && field.items) out.items = standardFieldSchema(field.items, engine, additionalProperties);
  return out;
};

const standardObject = (fields: Field[], engine: EngineId, additionalProperties?: boolean): Schema => {
  const named = fields.filter((f) => f.name);
  const out: Schema = { properties: Object.fromEntries(named.map((f) => [f.name, standardFieldSchema(f, engine, additionalProperties)])) };
  const required = named.filter((f) => f.required).map((f) => f.name);
  if (required.length) out.required = required;
  if (additionalProperties === false) out.additionalProperties = false;
  return out;
};

export const standardSchema = (project: Project, collection: Collection): Schema => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${collection.name}.schema.json`,
  title: collection.name,
  ...(collection.notes ? { description: collection.notes } : {}),
  type: 'object',
  ...standardObject(collection.fields, project.engine, collection.options.additionalProperties),
});

export const standardSchemaOutput = (project: Project) => ({
  code: json({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $defs: Object.fromEntries(project.collections.map((c) => [c.name, standardSchema(project, c)])),
  }),
  warnings: [] as string[],
});

/** Native type name shown in the interface. */
export const displayType = (engine: EngineId, field: Field): string => {
  if (field.type === 'array') return `${field.items ? displayType(engine, field.items) : 'any'}[]`;
  return nativeType(engine, field.type);
};
