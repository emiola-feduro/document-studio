import { t } from '../i18n';
import { ejsonWrapper, type JsonObject } from './documents';
import { convertType, ENGINES, ID_KEY } from './engines';
import { createCollection, createField, uid } from './model';
import { camelCase, singular } from './naming';
import type { Collection, EngineId, Field, FieldType, Project, Relationship, SampleDocument } from './types';

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Reads a JSON array, a single object, NDJSON or a `{ docs: [...] }` / `{ documents: {...} }` wrapper. */
export const parseDocumentsText = (text: string): JsonObject[] => {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const data = JSON.parse(trimmed) as unknown;
    if (Array.isArray(data)) return data.filter((d): d is JsonObject => Boolean(d) && typeof d === 'object' && !Array.isArray(d));
    if (data && typeof data === 'object') {
      const obj = data as JsonObject;
      if (Array.isArray(obj.docs)) return parseDocumentsText(JSON.stringify(obj.docs));
      if (obj.documents && typeof obj.documents === 'object' && !Array.isArray(obj.documents)) {
        return Object.entries(obj.documents as Record<string, JsonObject>).map(([id, d]) => ({ [ID_KEY]: id, ...d }));
      }
      return [obj];
    }
  } catch {
    /* maybe NDJSON */
  }
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
  return lines.map((line, i) => {
    try {
      const value = JSON.parse(line) as unknown;
      if (value && typeof value === 'object' && !Array.isArray(value)) return value as JsonObject;
    } catch {
      /* reported below */
    }
    throw new Error(t('infer.badLine', { n: i + 1 }));
  });
};

/** Type of a single value, reading Extended JSON wrappers and common string shapes. */
export const valueType = (v: unknown): FieldType => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  const w = ejsonWrapper(v);
  if (w) {
    const map: Record<string, FieldType> = {
      $oid: 'objectId',
      $date: 'date',
      $numberLong: 'long',
      $numberDecimal: 'decimal',
      $numberInt: 'int',
      $numberDouble: 'double',
      $binary: 'binary',
      $uuid: 'uuid',
      $timestamp: 'timestamp',
    };
    if (map[w.key]) return map[w.key];
  }
  switch (typeof v) {
    case 'string':
      if (OBJECT_ID.test(v)) return 'objectId';
      if (UUID.test(v)) return 'uuid';
      if (ISO_DATE.test(v) && !Number.isNaN(Date.parse(v))) return 'date';
      return 'string';
    case 'number':
      return Number.isInteger(v) ? 'int' : 'double';
    case 'boolean':
      return 'bool';
    case 'object': {
      const o = v as JsonObject;
      if (o.type === 'Point' && Array.isArray(o.coordinates)) return 'geoPoint';
      if (typeof o.latitude === 'number' && typeof o.longitude === 'number' && Object.keys(o).length === 2) return 'geoPoint';
      if (typeof o._seconds === 'number' && typeof o._nanoseconds === 'number') return 'timestamp';
      return 'object';
    }
    default:
      return 'any';
  }
};

export type FieldStats = {
  path: string;
  types: Partial<Record<FieldType, number>>;
  present: number;
  total: number;
  nulls: number;
  minLength?: number;
  maxLength?: number;
  distinct: Set<string>;
};

export type InferResult = { fields: Field[]; stats: FieldStats[]; warnings: string[] };

const ENUM_MAX_VALUES = 6;

type Acc = { values: unknown[]; present: number; total: number };

/** Infers the fields of a set of objects: union of keys, presence, observed types, nesting, arrays and enums. */
const inferObject = (objects: JsonObject[], engine: EngineId, prefix: string, out: InferResult): Field[] => {
  const keys = new Map<string, Acc>();
  for (const obj of objects) {
    for (const [key, value] of Object.entries(obj)) {
      const acc = keys.get(key) ?? { values: [], present: 0, total: objects.length };
      acc.values.push(value);
      acc.present += 1;
      keys.set(key, acc);
    }
  }
  return [...keys.entries()].map(([name, acc]) => {
    const path = prefix ? `${prefix}.${name}` : name;
    const field = inferValues(name, acc.values, engine, path, out);
    field.required = acc.present === objects.length;
    return field;
  });
};

const inferValues = (name: string, values: unknown[], engine: EngineId, path: string, out: InferResult): Field => {
  const stats: FieldStats = { path, types: {}, present: values.length, total: values.length, nulls: 0, distinct: new Set() };
  for (const v of values) {
    const type = valueType(v);
    if (type === 'null') stats.nulls += 1;
    else stats.types[type] = (stats.types[type] ?? 0) + 1;
    if (typeof v === 'string') {
      stats.minLength = Math.min(stats.minLength ?? v.length, v.length);
      stats.maxLength = Math.max(stats.maxLength ?? 0, v.length);
      if (stats.distinct.size <= ENUM_MAX_VALUES) stats.distinct.add(v);
    }
  }
  out.stats.push(stats);
  const observed = Object.keys(stats.types) as FieldType[];
  let type: FieldType;
  if (observed.length === 0) type = 'null';
  else if (observed.length === 1) type = observed[0];
  else if (observed.every((x) => ['int', 'long', 'double', 'decimal'].includes(x))) type = observed.includes('decimal') ? 'decimal' : observed.includes('double') ? 'double' : 'long';
  else if (observed.every((x) => ['date', 'timestamp'].includes(x))) type = 'date';
  else if (observed.every((x) => ['string', 'objectId', 'uuid'].includes(x))) type = 'string';
  else {
    type = 'any';
    out.warnings.push(t('infer.mixedTypes', { path, types: observed.join(', ') }));
  }
  const converted = convertType(engine, type).type;
  const field = createField({ name, type: converted, nullable: stats.nulls > 0 && observed.length > 0 });
  if (converted === 'object') {
    field.children = inferObject(values.filter((v): v is JsonObject => valueType(v) === 'object'), engine, path, out);
  }
  if (converted === 'array') {
    const items = values.filter(Array.isArray).flat();
    field.items = items.length ? inferValues('', items, engine, `${path}[]`, out) : createField({ name: '', type: 'any' });
    field.items.name = '';
    field.items.required = true;
  }
  // Few distinct strings across enough documents look like an enum.
  if (converted === 'string' && values.length >= 5 && stats.distinct.size > 0 && stats.distinct.size <= ENUM_MAX_VALUES && stats.distinct.size <= values.length / 2) {
    field.type = 'enum';
    field.enumValues = [...stats.distinct].sort();
  }
  return field;
};

export const inferFields = (docs: JsonObject[], engine: EngineId): InferResult => {
  const out: InferResult = { fields: [], stats: [], warnings: [] };
  out.fields = inferObject(docs, engine, '', out);
  // Firestore keeps the id outside the data; CouchDB keeps _rev to itself.
  if (engine === 'firestore') out.fields = out.fields.filter((f) => f.name !== ID_KEY);
  if (engine === 'couchdb') out.fields = out.fields.filter((f) => f.name !== 'type');
  const system = ENGINES[engine].systemFields;
  for (const s of [...system].reverse()) {
    const existing = out.fields.find((f) => f.name === s.name);
    if (existing) {
      existing.required = true;
      out.fields = [existing, ...out.fields.filter((f) => f !== existing)];
    } else out.fields.unshift(createField({ name: s.name, type: s.type, required: true }));
  }
  return out;
};

export type ImportedCollection = { name: string; docs: JsonObject[] };

export type ImportPlan = {
  collections: { collection: Collection; documents: SampleDocument[]; stats: FieldStats[] }[];
  relationships: Relationship[];
  warnings: string[];
};

const idText = (v: unknown) => {
  const w = ejsonWrapper(v);
  const plain = w ? w.value : v;
  return typeof plain === 'string' ? (plain.includes('/') ? plain.split('/').pop() : plain) : typeof plain === 'number' ? String(plain) : undefined;
};

/**
 * Collections inferred from imported documents. Fields named like `clienteId` or holding ObjectIds that match
 * the ids of another imported (or existing) collection become references.
 */
export const planImport = (project: Project, inputs: ImportedCollection[]): ImportPlan => {
  const warnings: string[] = [];
  const plan: ImportPlan = { collections: [], relationships: [], warnings };
  const offset = project.collections.length;
  inputs.forEach((input, i) => {
    const result = inferFields(input.docs, project.engine);
    warnings.push(...result.warnings.map((w) => `${input.name}: ${w}`));
    const collection = createCollection(project.engine, input.name, { x: 80 + (offset + i) * 340, y: 80 });
    collection.fields = result.fields;
    if (project.engine === 'couchdb') collection.options.typeDiscriminator = { field: 'type', value: input.name };
    const documents = input.docs.map((d) => ({ id: uid(), json: JSON.stringify(d, null, 2) }));
    plan.collections.push({ collection, documents, stats: result.stats });
  });

  const idSets = new Map<string, { id: string; name: string; ids: Set<string> }>();
  for (const { collection } of plan.collections) {
    const docs = inputs.find((x) => x.name === collection.name)?.docs ?? [];
    idSets.set(collection.id, { id: collection.id, name: collection.name, ids: new Set(docs.map((d) => idText(d[ID_KEY])).filter((x): x is string => Boolean(x))) });
  }
  for (const { collection } of plan.collections) {
    const docs = inputs.find((x) => x.name === collection.name)?.docs ?? [];
    for (const field of collection.fields) {
      if (field.name === ID_KEY) continue;
      const holder = field.type === 'array' ? field.items : field;
      if (!holder || !['objectId', 'string', 'uuid', 'reference'].includes(holder.type)) continue;
      const values = docs.flatMap((d) => (Array.isArray(d[field.name]) ? (d[field.name] as unknown[]) : [d[field.name]])).map(idText).filter((x): x is string => Boolean(x));
      if (values.length === 0) continue;
      const byName = /(Id|_id|Ids|_ids)$/.test(field.name);
      const target = [...idSets.values()].find((s) => s.id !== collection.id && values.every((v) => s.ids.has(v)));
      const named = !target && byName ? [...idSets.values()].find((s) => camelCase(singular(s.name)) === field.name.replace(/(Ids?|_ids?)$/, '')) : undefined;
      const match = target ?? named;
      if (!match) continue;
      holder.reference = { collectionId: match.id, fieldPath: project.engine === 'firestore' ? '__name__' : ID_KEY };
      if (project.engine === 'firestore') holder.type = 'reference';
      if (project.engine === 'couchdb') holder.type = 'reference';
      plan.relationships.push({
        id: uid(),
        kind: 'reference',
        from: { collectionId: collection.id, fieldPath: field.name },
        to: { collectionId: match.id },
        cardinality: field.type === 'array' ? 'N:M' : '1:N',
        storage: field.type === 'array' ? 'array' : 'single',
      });
    }
  }
  return plan;
};

/* $jsonSchema import */

const BSON_TO_TYPE: Record<string, FieldType> = {
  string: 'string',
  int: 'int',
  long: 'long',
  double: 'double',
  decimal: 'decimal',
  number: 'number',
  bool: 'bool',
  date: 'date',
  timestamp: 'timestamp',
  objectId: 'objectId',
  binData: 'binary',
  object: 'object',
  array: 'array',
  null: 'null',
};

type JsonSchemaNode = Record<string, unknown>;

const fieldFromSchema = (name: string, node: JsonSchemaNode, required: boolean, engine: EngineId): Field => {
  const raw = node.bsonType ?? node.type;
  const list = Array.isArray(raw) ? (raw as string[]) : raw ? [raw as string] : [];
  const nonNull = list.filter((x) => x !== 'null');
  const jsonType = (x: string) => ({ integer: 'long', boolean: 'bool' } as Record<string, string>)[x] ?? x;
  let type: FieldType = nonNull.length === 1 ? (BSON_TO_TYPE[jsonType(nonNull[0])] ?? 'any') : nonNull.length === 0 && list.includes('null') ? 'null' : 'any';
  if (Array.isArray(node.enum)) type = 'enum';
  const props = node.properties as Record<string, JsonSchemaNode> | undefined;
  if (props && (props.coordinates || (props.type as JsonSchemaNode | undefined)?.enum)) {
    const enumValues = (props.type as JsonSchemaNode | undefined)?.enum;
    if (Array.isArray(enumValues) && enumValues.includes('Point')) type = 'geoPoint';
  }
  const field = createField({ name, type: convertType(engine, type).type, required, nullable: list.includes('null') || (Array.isArray(node.enum) && node.enum.includes(null)) });
  if (typeof node.description === 'string') field.description = node.description;
  if (Array.isArray(node.enum)) field.enumValues = (node.enum as unknown[]).filter((v) => v !== null).map(String);
  for (const key of ['minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems'] as const) if (typeof node[key] === 'number') field[key] = node[key] as number;
  if (typeof node.pattern === 'string') field.pattern = node.pattern;
  if (node.uniqueItems === true) field.uniqueItems = true;
  if (node.exclusiveMinimum === true) field.exclusiveMin = true;
  if (field.type === 'object') field.children = fieldsFromSchema(node, engine);
  if (field.type === 'array') {
    const items = node.items as JsonSchemaNode | undefined;
    field.items = items && typeof items === 'object' && !Array.isArray(items) ? fieldFromSchema('', items, true, engine) : createField({ name: '', type: 'any' });
  }
  return field;
};

const fieldsFromSchema = (node: JsonSchemaNode, engine: EngineId): Field[] => {
  const required = new Set(Array.isArray(node.required) ? (node.required as string[]) : []);
  const props = (node.properties ?? {}) as Record<string, JsonSchemaNode>;
  return Object.entries(props).map(([name, child]) => fieldFromSchema(name, child, required.has(name), engine));
};

/**
 * Collections from a `$jsonSchema`: a bare schema, `{ $jsonSchema }`, `{ validator: { $jsonSchema } }`, the array
 * returned by `db.getCollectionInfos()`, or a map of collection name to any of those.
 */
export const importJsonSchema = (text: string, engine: EngineId, fallbackName: string): Collection[] => {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(t('file.invalidJson'));
  }
  const schemaOf = (v: unknown): JsonSchemaNode | undefined => {
    if (!v || typeof v !== 'object') return undefined;
    const o = v as JsonSchemaNode;
    if (o.$jsonSchema) return o.$jsonSchema as JsonSchemaNode;
    if (o.validator) return schemaOf(o.validator);
    if (o.options) return schemaOf(o.options);
    if (o.properties || o.bsonType || o.type) return o;
    return undefined;
  };
  const entries: [string, JsonSchemaNode][] = [];
  if (Array.isArray(data)) {
    data.forEach((info, i) => {
      const schema = schemaOf(info);
      const name = (info as JsonSchemaNode)?.name;
      if (schema) entries.push([typeof name === 'string' ? name : `${fallbackName}_${i + 1}`, schema]);
    });
  } else {
    const direct = schemaOf(data);
    if (direct) entries.push([fallbackName, direct]);
    else if (data && typeof data === 'object') {
      for (const [name, value] of Object.entries(data as JsonSchemaNode)) {
        const schema = schemaOf(value);
        if (schema) entries.push([name, schema]);
      }
    }
  }
  if (entries.length === 0) throw new Error(t('infer.noSchema'));
  return entries.map(([name, schema], i) => {
    const collection = createCollection(engine, name, { x: 80 + i * 340, y: 80 });
    const fields = fieldsFromSchema(schema, engine);
    const system = collection.fields.filter((s) => !fields.some((f) => f.name === s.name));
    collection.fields = [...system, ...fields];
    if (schema.additionalProperties === false) collection.options.additionalProperties = false;
    return collection;
  });
};

/** Adds the indexes of a firestore.indexes.json to the collections with the same name. Returns how many were added. */
export const importFirestoreIndexes = (project: Project, text: string): number => {
  let data: { indexes?: { collectionGroup?: string; queryScope?: string; fields?: { fieldPath: string; order?: string; arrayConfig?: string }[] }[] };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(t('file.invalidJson'));
  }
  if (!Array.isArray(data.indexes)) throw new Error(t('infer.noIndexes'));
  let added = 0;
  for (const index of data.indexes) {
    const collection = project.collections.find((c) => c.name === index.collectionGroup);
    if (!collection || !index.fields?.length) continue;
    collection.indexes.push({
      id: uid(),
      name: '',
      nameIsCustom: false,
      keys: index.fields.map((f) => ({ path: f.fieldPath, order: f.order === 'DESCENDING' ? -1 : 1 })),
      scope: index.queryScope === 'COLLECTION_GROUP' ? 'collectionGroup' : 'collection',
    });
    added += 1;
  }
  return added;
};
