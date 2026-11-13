import { t } from '../i18n';
import { ENGINES, ID_KEY } from './engines';
import { indexName } from './indexes';
import { collectionPath } from './model';
import { toMongoPath } from './paths';
import type { Collection, EngineId, Field, Project, SampleDocument } from './types';

export type DocError = { path: string; message: string };
export type DocResult = { index: number; id: string; errors: DocError[]; bytes: number };

export type JsonObject = Record<string, unknown>;

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const DECIMAL = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

const kind = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

const isPlainObject = (v: unknown): v is JsonObject => kind(v) === 'object';

/** Extended JSON wrappers such as {"$oid": "..."} and {"$date": "..."}; returns the wrapper name and inner value. */
export const ejsonWrapper = (v: unknown): { key: string; value: unknown } | undefined => {
  if (!isPlainObject(v)) return undefined;
  const keys = Object.keys(v);
  if (keys.length !== 1 || !keys[0].startsWith('$')) return undefined;
  return { key: keys[0], value: v[keys[0]] };
};

/** Plain value behind an Extended JSON wrapper, so ids and dates compare as text. */
export const unwrap = (v: unknown): unknown => {
  const w = ejsonWrapper(v);
  if (!w) return v;
  if (w.key === '$date' && isPlainObject(w.value) && '$numberLong' in w.value) return new Date(Number(w.value.$numberLong)).toISOString();
  return w.value;
};

/** Reference written as an id, an ObjectId wrapper or a Firestore path "clientes/abc"; returns the id. */
export const referenceId = (v: unknown): string | undefined => {
  const plain = unwrap(v);
  if (typeof plain !== 'string') return undefined;
  return plain.includes('/') ? plain.split('/').pop() : plain;
};

const isDateValue = (v: unknown) => {
  const w = ejsonWrapper(v);
  if (w?.key === '$date' || w?.key === '$timestamp') return true;
  if (isPlainObject(v) && typeof v._seconds === 'number') return true;
  return typeof v === 'string' && ISO_DATE.test(v) && !Number.isNaN(Date.parse(v));
};

const isGeoPoint = (v: unknown) => {
  if (!isPlainObject(v)) return false;
  if (v.type === 'Point' && Array.isArray(v.coordinates) && v.coordinates.length === 2 && v.coordinates.every((c) => typeof c === 'number')) return true;
  if (typeof v.latitude === 'number' && typeof v.longitude === 'number') return true;
  return typeof v.lat === 'number' && typeof v.lng === 'number';
};

/** Whether a value fits a field type, accepting the JSON and Extended JSON spellings of each one. */
export const fitsType = (field: Field, value: unknown, engine: EngineId): boolean => {
  const w = ejsonWrapper(value);
  switch (field.type) {
    case 'any':
      return true;
    case 'null':
      return value === null;
    case 'string':
    case 'enum':
      return typeof value === 'string';
    case 'int':
      return (typeof value === 'number' && Number.isInteger(value)) || w?.key === '$numberInt';
    case 'long':
      return (typeof value === 'number' && Number.isInteger(value)) || w?.key === '$numberLong';
    case 'double':
    case 'number':
      return typeof value === 'number' || w?.key === '$numberDouble';
    case 'decimal':
      return typeof value === 'number' || (typeof value === 'string' && DECIMAL.test(value)) || w?.key === '$numberDecimal';
    case 'bool':
      return typeof value === 'boolean';
    case 'date':
    case 'timestamp':
      return isDateValue(value);
    case 'objectId':
      return (typeof value === 'string' && OBJECT_ID.test(value)) || (w?.key === '$oid' && typeof w.value === 'string' && OBJECT_ID.test(w.value));
    case 'reference':
      if (engine === 'mongodb') return (typeof value === 'string' && OBJECT_ID.test(value)) || w?.key === '$oid';
      return typeof referenceId(value) === 'string';
    case 'uuid':
      return (typeof value === 'string' && UUID.test(value)) || w?.key === '$uuid';
    case 'binary':
      return typeof value === 'string' || w?.key === '$binary';
    case 'geoPoint':
      return isGeoPoint(value);
    case 'object':
      return isPlainObject(value) && !w;
    case 'array':
      return Array.isArray(value);
    default:
      return true;
  }
};

const typeLabel = (field: Field) => (field.type === 'array' ? `${field.items?.type ?? 'any'}[]` : field.type);

const numeric = (v: unknown) => {
  const plain = unwrap(v);
  if (typeof plain === 'number') return plain;
  if (typeof plain === 'string' && DECIMAL.test(plain)) return Number(plain);
  if (typeof plain === 'string' && !Number.isNaN(Date.parse(plain))) return Date.parse(plain);
  return undefined;
};

const checkValue = (field: Field, value: unknown, path: string, engine: EngineId, errors: DocError[], strict: boolean) => {
  if (value === null) {
    if (!field.nullable && field.type !== 'null' && field.type !== 'any') errors.push({ path, message: t('docs.err.null') });
    return;
  }
  if (!fitsType(field, value, engine)) {
    errors.push({ path, message: t('docs.err.type', { type: typeLabel(field), actual: kind(value) }) });
    return;
  }
  if (field.type === 'enum' && field.enumValues?.length && !field.enumValues.includes(value as string)) {
    errors.push({ path, message: t('docs.err.enum', { values: field.enumValues.join(', ') }) });
  }
  if (typeof value === 'string' && (field.type === 'string' || field.type === 'enum')) {
    if (field.minLength !== undefined && value.length < field.minLength) errors.push({ path, message: t('docs.err.minLength', { n: field.minLength }) });
    if (field.maxLength !== undefined && value.length > field.maxLength) errors.push({ path, message: t('docs.err.maxLength', { n: field.maxLength }) });
    if (field.pattern) {
      try {
        if (!new RegExp(field.pattern).test(value)) errors.push({ path, message: t('docs.err.pattern', { pattern: field.pattern }) });
      } catch {
        /* an invalid pattern is reported by the advisor */
      }
    }
  }
  const n = ['int', 'long', 'double', 'decimal', 'number', 'date', 'timestamp'].includes(field.type) ? numeric(value) : undefined;
  if (n !== undefined) {
    const min = field.minimum;
    if (min !== undefined && (field.exclusiveMin ? n <= min : n < min)) errors.push({ path, message: t('docs.err.minimum', { n: min }) });
    if (field.maximum !== undefined && n > field.maximum) errors.push({ path, message: t('docs.err.maximum', { n: field.maximum }) });
  }
  if (Array.isArray(value)) {
    if (field.minItems !== undefined && value.length < field.minItems) errors.push({ path, message: t('docs.err.minItems', { n: field.minItems }) });
    if (field.maxItems !== undefined && value.length > field.maxItems) errors.push({ path, message: t('docs.err.maxItems', { n: field.maxItems }) });
    if (field.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) errors.push({ path, message: t('docs.err.uniqueItems') });
    if (field.items) value.forEach((item, i) => checkValue(field.items!, item, `${path}[${i}]`, engine, errors, strict));
  }
  if (field.type === 'object' && isPlainObject(value)) checkObject(field.children ?? [], value, path, engine, errors, strict);
};

const checkObject = (fields: Field[], value: JsonObject, prefix: string, engine: EngineId, errors: DocError[], strict: boolean, root = false, extraAllowed: string[] = []) => {
  const byName = new Map(fields.filter((f) => f.name).map((f) => [f.name, f]));
  for (const field of byName.values()) {
    const path = prefix ? `${prefix}.${field.name}` : field.name;
    if (!(field.name in value)) {
      if (field.required && !(root && field.name === '_rev')) errors.push({ path, message: t('docs.err.required') });
      continue;
    }
    checkValue(field, value[field.name], path, engine, errors, strict);
  }
  if (strict) {
    for (const key of Object.keys(value)) {
      if (byName.has(key) || (root && (key === ID_KEY || extraAllowed.includes(key)))) continue;
      errors.push({ path: prefix ? `${prefix}.${key}` : key, message: t('docs.err.extra') });
    }
  }
};

export type ParsedDocument = { value?: JsonObject; error?: string };

export const parseDocument = (doc: SampleDocument): ParsedDocument => {
  try {
    const value = JSON.parse(doc.json) as unknown;
    if (!isPlainObject(value)) return { error: t('docs.err.notObject') };
    return { value };
  } catch (error) {
    return { error: t('docs.err.json', { detail: error instanceof Error ? error.message : String(error) }) };
  }
};

const valueAt = (value: unknown, path: string): unknown[] => {
  // Paths with [] fan out over array elements.
  const parts = path.split('.');
  let current: unknown[] = [value];
  for (const raw of parts) {
    const isArray = raw.endsWith('[]');
    const key = isArray ? raw.slice(0, -2) : raw;
    current = current.flatMap((v) => (isPlainObject(v) && key in v ? [v[key]] : []));
    if (isArray) current = current.flatMap((v) => (Array.isArray(v) ? v : []));
  }
  return current;
};

/** Ids of a collection's sample documents, as text. */
export const documentIds = (project: Project, collectionId: string) =>
  new Set(
    (project.documents?.[collectionId] ?? [])
      .map((d) => parseDocument(d).value?.[ID_KEY])
      .map((v) => referenceId(v))
      .filter((v): v is string => typeof v === 'string'),
  );

export const documentBytes = (json: string) => new TextEncoder().encode(json).length;

/**
 * Checks every sample document of a collection against its fields, the references to other collections,
 * unique indexes and the engine's size limit.
 */
export const validateDocuments = (project: Project, collection: Collection): DocResult[] => {
  const docs = project.documents?.[collection.id] ?? [];
  const strict = collection.options.additionalProperties === false;
  const extra = project.engine === 'couchdb' ? [collection.options.typeDiscriminator?.field || 'type', '_rev'] : [];
  const limit = ENGINES[project.engine].maxDocumentBytes;
  const idCache = new Map<string, Set<string>>();
  const idsOf = (id: string) => {
    if (!idCache.has(id)) idCache.set(id, documentIds(project, id));
    return idCache.get(id)!;
  };

  const parsed = docs.map(parseDocument);
  const results: DocResult[] = parsed.map((p, index) => {
    const errors: DocError[] = [];
    const bytes = documentBytes(docs[index].json);
    if (p.error || !p.value) return { index, id: docs[index].id, errors: [{ path: '', message: p.error ?? '' }], bytes };
    checkObject(collection.fields, p.value, '', project.engine, errors, strict, true, extra);
    if (bytes > limit) errors.push({ path: '', message: t('docs.err.size', { size: bytes, limit }) });
    return { index, id: docs[index].id, errors, bytes };
  });

  // References must point at documents that exist in the target collection.
  for (const rel of project.relationships.filter((r) => r.kind === 'reference')) {
    const checks: { path: string; target: string }[] = [];
    if (rel.from.collectionId === collection.id) checks.push({ path: rel.from.fieldPath, target: rel.to.collectionId });
    if (rel.reverseFieldPath && rel.to.collectionId === collection.id) checks.push({ path: rel.reverseFieldPath, target: rel.from.collectionId });
    for (const { path, target } of checks) {
      const ids = idsOf(target);
      const targetName = project.collections.find((c) => c.id === target)?.name ?? '?';
      parsed.forEach((p, i) => {
        if (!p.value) return;
        for (const v of valueAt(p.value, path).flatMap((x) => (Array.isArray(x) ? x : [x]))) {
          if (v === null || v === undefined) continue;
          const id = referenceId(v);
          if (id && !ids.has(id)) results[i].errors.push({ path, message: t('docs.err.missingRef', { id, collection: targetName }) });
        }
      });
    }
  }

  // Unique indexes, and the id itself.
  const uniques = [
    { name: ID_KEY, paths: [ID_KEY] },
    ...collection.indexes.filter((i) => i.unique && !i.wildcard).map((i) => ({ name: indexName(i), paths: i.keys.map((k) => k.path).filter(Boolean) })),
  ];
  for (const unique of uniques) {
    if (unique.paths.length === 0) continue;
    const seen = new Map<string, number>();
    parsed.forEach((p, i) => {
      if (!p.value) return;
      const values = unique.paths.map((path) => valueAt(p.value, path).map(unwrap));
      if (values.some((v) => v.length === 0)) return;
      const key = JSON.stringify(values);
      const first = seen.get(key);
      if (first === undefined) seen.set(key, i);
      else results[i].errors.push({ path: unique.paths.map(toMongoPath).join(', '), message: t('docs.err.duplicate', { index: unique.name, n: first + 1 }) });
    });
  }
  return results;
};

export const errorCount = (results: DocResult[]) => results.reduce((n, r) => n + r.errors.length, 0);

/* Exports */

const parsedValues = (project: Project, collection: Collection) =>
  (project.documents?.[collection.id] ?? []).map((d) => parseDocument(d).value).filter((v): v is JsonObject => Boolean(v));

/** Values converted to Extended JSON v2 (canonical where it matters for types MongoDB distinguishes). */
export const toEjson = (fields: Field[], value: JsonObject): JsonObject => {
  const convert = (field: Field | undefined, v: unknown): unknown => {
    if (v === null || v === undefined || ejsonWrapper(v)) return v;
    if (!field) return v;
    switch (field.type) {
      case 'objectId':
      case 'reference':
        return typeof v === 'string' && OBJECT_ID.test(v) ? { $oid: v } : v;
      case 'date':
      case 'timestamp':
        return typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? { $date: new Date(v).toISOString() } : v;
      case 'long':
        return typeof v === 'number' ? { $numberLong: String(v) } : v;
      case 'decimal':
        return typeof v === 'number' || typeof v === 'string' ? { $numberDecimal: String(v) } : v;
      case 'uuid':
        return typeof v === 'string' ? { $uuid: v } : v;
      case 'binary':
        return typeof v === 'string' ? { $binary: { base64: v, subType: '00' } } : v;
      case 'object':
        return isPlainObject(v) ? toEjson(field.children ?? [], v) : v;
      case 'array':
        return Array.isArray(v) ? v.map((item) => convert(field.items, item)) : v;
      default:
        return v;
    }
  };
  const byName = new Map(fields.map((f) => [f.name, f]));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, convert(byName.get(k), v)]));
};

/** mongosh constructors for values in an insertMany script. */
const toShell = (fields: Field[], value: JsonObject, indent = '  '): string => {
  const render = (field: Field | undefined, v: unknown, pad: string): string => {
    const plain = unwrap(v);
    if (field && plain !== null && plain !== undefined) {
      if ((field.type === 'objectId' || field.type === 'reference') && typeof plain === 'string' && OBJECT_ID.test(plain)) return `ObjectId(${JSON.stringify(plain)})`;
      if ((field.type === 'date' || field.type === 'timestamp') && typeof plain === 'string') return `ISODate(${JSON.stringify(plain)})`;
      if (field.type === 'decimal') return `NumberDecimal(${JSON.stringify(String(plain))})`;
      if (field.type === 'long' && typeof plain !== 'object') return `NumberLong(${JSON.stringify(String(plain))})`;
      if (field.type === 'uuid' && typeof plain === 'string') return `UUID(${JSON.stringify(plain)})`;
      if (field.type === 'object' && isPlainObject(v)) return toShell(field.children ?? [], v, `${pad}  `);
      if (field.type === 'array' && Array.isArray(v)) return `[${v.map((item) => render(field.items, item, pad)).join(', ')}]`;
    }
    return JSON.stringify(v);
  };
  const byName = new Map(fields.map((f) => [f.name, f]));
  const entries = Object.entries(value).map(([k, v]) => `${indent}  ${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${render(byName.get(k), v, `${indent}  `)}`);
  return `{\n${entries.join(',\n')}\n${indent}}`;
};

export type DocExportFormat = 'json' | 'ndjson' | 'ejson' | 'mongosh' | 'bulkDocs' | 'firestore';

export const documentsJson = (project: Project, collection: Collection) => `${JSON.stringify(parsedValues(project, collection), null, 2)}\n`;

/** One document per line; `mongoimport` reads it as is, or the JSON array with --jsonArray. */
export const documentsNdjson = (project: Project, collection: Collection, ejson = false) =>
  parsedValues(project, collection)
    .map((v) => JSON.stringify(ejson ? toEjson(collection.fields, v) : v))
    .join('\n') + '\n';

export const documentsEjson = (project: Project, collection: Collection) =>
  `${JSON.stringify(parsedValues(project, collection).map((v) => toEjson(collection.fields, v)), null, 2)}\n`;

export const mongoshInsertMany = (project: Project) => {
  const lines = [`use(${JSON.stringify(project.databaseName?.trim() || 'app')});`, ''];
  for (const collection of project.collections) {
    const values = parsedValues(project, collection);
    if (values.length === 0) continue;
    const target = /^[A-Za-z_$][\w$]*$/.test(collection.name) ? `db.${collection.name}` : `db.getCollection(${JSON.stringify(collection.name)})`;
    lines.push(`${target}.insertMany([`, values.map((v) => `  ${toShell(collection.fields, v)}`).join(',\n'), ']);', '');
  }
  return lines.join('\n');
};

/** CouchDB _bulk_docs body: every collection in one database, told apart by the type field. */
export const couchBulkDocs = (project: Project) => {
  const docs = project.collections.flatMap((collection) => {
    const field = collection.options.typeDiscriminator?.field?.trim() || 'type';
    const value = collection.options.typeDiscriminator?.value?.trim() || collection.name;
    return parsedValues(project, collection).map((v) => {
      const { _rev, ...rest } = v;
      void _rev;
      const geo = (fields: Field[], obj: JsonObject): JsonObject =>
        Object.fromEntries(
          Object.entries(obj).map(([k, val]) => {
            const f = fields.find((x) => x.name === k);
            if (f?.type === 'geoPoint' && isPlainObject(val) && Array.isArray(val.coordinates)) return [k, { lat: val.coordinates[1], lng: val.coordinates[0] }];
            if (f?.type === 'object' && isPlainObject(val)) return [k, geo(f.children ?? [], val)];
            return [k, unwrap(val)];
          }),
        );
      return { ...geo(collection.fields, rest), [field]: value };
    });
  });
  return `${JSON.stringify({ docs }, null, 2)}\n`;
};

/** Firestore: one JSON per collection path, keyed by document id, plus an Admin SDK script that imports them. */
export const firestoreImport = (project: Project) => {
  const files: Record<string, string> = {};
  for (const collection of project.collections) {
    const data: Record<string, JsonObject> = {};
    parsedValues(project, collection).forEach((v, i) => {
      const { [ID_KEY]: id, ...rest } = v;
      data[String(referenceId(id) ?? `doc${i + 1}`)] = rest;
    });
    files[`${collectionPath(project, collection).replace(/[/{}]+/g, '_')}.json`] = `${JSON.stringify({ path: collectionPath(project, collection), fields: fieldKinds(collection.fields), documents: data }, null, 2)}\n`;
  }
  files['import-firestore.mjs'] = FIRESTORE_SCRIPT;
  return files;
};

/** Field paths that need converting on import: timestamps, geopoints and references. */
const fieldKinds = (fields: Field[], prefix = ''): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const path = prefix ? `${prefix}.${f.name}` : f.name;
    if (['date', 'timestamp'].includes(f.type)) out[path] = 'timestamp';
    if (f.type === 'geoPoint') out[path] = 'geopoint';
    if (f.type === 'reference') out[path] = 'reference';
    if (f.type === 'array' && f.items?.type === 'reference') out[path] = 'reference[]';
    if (f.type === 'object') Object.assign(out, fieldKinds(f.children ?? [], path));
  }
  return out;
};

const FIRESTORE_SCRIPT = `// node import-firestore.mjs ./*.json
// Needs: npm install firebase-admin, and GOOGLE_APPLICATION_CREDENTIALS pointing at a service account key.
import { readFileSync } from 'node:fs';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Timestamp, GeoPoint } from 'firebase-admin/firestore';

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

const convert = (kind, value) => {
  if (value === null || value === undefined) return value;
  if (kind === 'timestamp') return Timestamp.fromDate(new Date(value.$date ?? value));
  if (kind === 'geopoint') {
    if (Array.isArray(value.coordinates)) return new GeoPoint(value.coordinates[1], value.coordinates[0]);
    return new GeoPoint(value.latitude ?? value.lat, value.longitude ?? value.lng);
  }
  if (kind === 'reference') return db.doc(String(value));
  if (kind === 'reference[]') return value.map((v) => db.doc(String(v)));
  return value;
};

const apply = (data, kinds) => {
  for (const [path, kind] of Object.entries(kinds)) {
    const parts = path.split('.');
    let target = data;
    for (const part of parts.slice(0, -1)) target = target?.[part];
    const last = parts.at(-1);
    if (target && last in target) target[last] = convert(kind, target[last]);
  }
  return data;
};

for (const file of process.argv.slice(2)) {
  const { path, fields, documents } = JSON.parse(readFileSync(file, 'utf8'));
  if (path.includes('{')) {
    console.warn(\`\${file}: subcollection \${path}; set the parent ids in the path before importing.\`);
    continue;
  }
  const batch = db.batch();
  for (const [id, data] of Object.entries(documents)) batch.set(db.collection(path).doc(id), apply(data, fields));
  await batch.commit();
  console.log(\`\${path}: \${Object.keys(documents).length}\`);
}
`;
