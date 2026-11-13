import { t } from '../../i18n';
import { indexName } from '../indexes';
import { toMongoPath, walkFields } from '../paths';
import { referencePaths } from '../relationships';
import type { Collection, Field, Project } from '../types';
import { databaseName, json, parseLiteral, type OutputResult } from './shared';

/** Field that tells document kinds apart in one CouchDB database, and the value for this collection. */
export const discriminator = (collection: Collection) => ({
  field: collection.options.typeDiscriminator?.field?.trim() || 'type',
  value: collection.options.typeDiscriminator?.value?.trim() || collection.name,
});

/** Compact rule read by the validation function: t type, n nullable, r required, p properties, i items. */
type Rule = {
  t?: string;
  n?: 1;
  r?: string[];
  p?: Record<string, Rule>;
  i?: Rule;
  e?: string[];
  minL?: number;
  maxL?: number;
  re?: string;
  min?: number;
  xmin?: 1;
  max?: number;
  minI?: number;
  maxI?: number;
  u?: 1;
  x?: 1;
};

const KIND: Partial<Record<Field['type'], string>> = {
  string: 'string',
  enum: 'string',
  uuid: 'string',
  reference: 'string',
  objectId: 'string',
  date: 'date',
  timestamp: 'date',
  decimal: 'decimal',
  int: 'int',
  long: 'int',
  double: 'number',
  number: 'number',
  bool: 'boolean',
  object: 'object',
  array: 'array',
  geoPoint: 'geo',
  null: 'null',
  binary: 'string',
};

const ruleFor = (field: Field, strict: boolean): Rule => {
  const rule: Rule = {};
  if (field.type !== 'any') rule.t = KIND[field.type] ?? 'string';
  if (field.nullable) rule.n = 1;
  if (field.type === 'enum' && field.enumValues?.length) rule.e = field.enumValues;
  if (field.minLength !== undefined) rule.minL = field.minLength;
  if (field.maxLength !== undefined) rule.maxL = field.maxLength;
  if (field.pattern) rule.re = field.pattern;
  if (field.minimum !== undefined) rule.min = field.minimum;
  if (field.exclusiveMin) rule.xmin = 1;
  if (field.maximum !== undefined) rule.max = field.maximum;
  if (field.minItems !== undefined) rule.minI = field.minItems;
  if (field.maxItems !== undefined) rule.maxI = field.maxItems;
  if (field.uniqueItems) rule.u = 1;
  if (field.type === 'object') Object.assign(rule, objectRule(field.children ?? [], strict));
  if (field.type === 'array' && field.items) rule.i = ruleFor(field.items, strict);
  return rule;
};

const objectRule = (fields: Field[], strict: boolean): Rule => {
  const named = fields.filter((f) => f.name && f.name !== '_rev');
  const rule: Rule = { p: Object.fromEntries(named.map((f) => [f.name, ruleFor(f, strict)])) };
  const required = named.filter((f) => f.required && f.name !== '_id').map((f) => f.name);
  if (required.length) rule.r = required;
  if (strict) rule.x = 1;
  return rule;
};

/** ES5 so it runs in every CouchDB query server. Throws { forbidden } with every problem found. */
const VALIDATOR = `function (newDoc, oldDoc, userCtx, secObj) {
  var FIELD = __FIELD__, VALUE = __VALUE__, schema = __SCHEMA__;
  if (newDoc._deleted || newDoc[FIELD] !== VALUE) return;
  var errors = [];
  function kind(v) {
    if (v === null) return 'null';
    if (Object.prototype.toString.call(v) === '[object Array]') return 'array';
    return typeof v;
  }
  function check(v, r, path) {
    if (v === null) { if (!r.n && r.t !== 'null' && r.t) errors.push(path + ': null'); return; }
    var k = kind(v), ok = true;
    if (r.t === 'int') ok = k === 'number' && Math.floor(v) === v;
    else if (r.t === 'date') ok = k === 'string' && !isNaN(Date.parse(v));
    else if (r.t === 'decimal') ok = (k === 'string' && /^-?[0-9]+(\\.[0-9]+)?$/.test(v)) || k === 'number';
    else if (r.t === 'geo') ok = k === 'object' && typeof v.lat === 'number' && typeof v.lng === 'number';
    else if (r.t) ok = k === r.t;
    if (!ok) { errors.push(path + ': ' + r.t); return; }
    if (r.e && r.e.indexOf(v) < 0) errors.push(path + ': enum');
    if (k === 'string') {
      if (r.minL !== undefined && v.length < r.minL) errors.push(path + ': minLength');
      if (r.maxL !== undefined && v.length > r.maxL) errors.push(path + ': maxLength');
      if (r.re && !new RegExp(r.re).test(v)) errors.push(path + ': pattern');
    }
    if (k === 'number') {
      if (r.min !== undefined && (r.xmin ? v <= r.min : v < r.min)) errors.push(path + ': minimum');
      if (r.max !== undefined && v > r.max) errors.push(path + ': maximum');
    }
    if (k === 'array') {
      if (r.minI !== undefined && v.length < r.minI) errors.push(path + ': minItems');
      if (r.maxI !== undefined && v.length > r.maxI) errors.push(path + ': maxItems');
      if (r.u) { var seen = {}; for (var j = 0; j < v.length; j++) { var s = JSON.stringify(v[j]); if (seen[s]) errors.push(path + ': uniqueItems'); seen[s] = 1; } }
      if (r.i) for (var i = 0; i < v.length; i++) check(v[i], r.i, path + '[' + i + ']');
    }
    if (k === 'object' && r.p) obj(v, r, path);
  }
  function obj(v, r, path) {
    var prefix = path ? path + '.' : '';
    if (r.r) for (var a = 0; a < r.r.length; a++) if (!(r.r[a] in v)) errors.push(prefix + r.r[a] + ': required');
    for (var key in v) {
      if (!v.hasOwnProperty(key)) continue;
      if (r.p[key]) check(v[key], r.p[key], prefix + key);
      else if (r.x && !(path === '' && (key === FIELD || key.charAt(0) === '_'))) errors.push(prefix + key + ': not allowed');
    }
  }
  obj(newDoc, schema, '');
  if (errors.length) throw ({ forbidden: errors.join('; ') });
}`;

export const validateDocUpdate = (collection: Collection) => {
  const { field, value } = discriminator(collection);
  const schema = objectRule(collection.fields, collection.options.additionalProperties === false);
  return VALIDATOR.replace('__FIELD__', JSON.stringify(field)).replace('__VALUE__', JSON.stringify(value)).replace('__SCHEMA__', JSON.stringify(schema));
};

const jsAccess = (path: string) => toMongoPath(path).split('.').map((p) => (/^[A-Za-z_$][\w$]*$/.test(p) ? `.${p}` : `[${JSON.stringify(p)}]`)).join('');

/** One design document per collection: validate_doc_update plus a view per reference to find children by parent. */
export const designDocuments = (project: Project) =>
  project.collections.map((collection) => {
    const { field, value } = discriminator(collection);
    const views: Record<string, { map: string }> = {};
    for (const ref of referencePaths(collection)) {
      if (ref.path.includes('[]')) continue;
      const access = `doc${jsAccess(ref.path)}`;
      const emit = ref.array
        ? `for (var i = 0; i < ${access}.length; i++) emit(${access}[i], null);`
        : `emit(${access}, null);`;
      views[`by_${toMongoPath(ref.path).replace(/\./g, '_')}`] = {
        map: `function (doc) { if (doc[${JSON.stringify(field)}] === ${JSON.stringify(value)} && ${access}) { ${emit} } }`,
      };
    }
    views.all = { map: `function (doc) { if (doc[${JSON.stringify(field)}] === ${JSON.stringify(value)}) emit(doc._id, null); }` };
    return { _id: `_design/${collection.name}`, language: 'javascript', validate_doc_update: validateDocUpdate(collection), views };
  });

export const couchDesignOutput = (project: Project): OutputResult => ({
  code: json({ docs: designDocuments(project) }),
  warnings: project.collections.some((c) => walkFields(c.fields).some((e) => e.field.type === 'binary')) ? [t('output.couchAttachments')] : [],
});

/** Mango indexes as curl calls to POST /{db}/_index, scoped to each collection by its type field. */
export const mangoIndexes = (project: Project): OutputResult => {
  const warnings: string[] = [];
  const db = databaseName(project);
  const lines = ['#!/bin/sh', '# COUCH_URL=http://admin:password@127.0.0.1:5984', `DB=${db}`, ''];
  for (const collection of project.collections) {
    const { field, value } = discriminator(collection);
    for (const index of collection.indexes) {
      const keys = index.keys.filter((k) => k.path);
      if (keys.some((k) => typeof k.order === 'string')) {
        warnings.push(t('output.mangoIndexKind', { name: indexName(index), collection: collection.name }));
        continue;
      }
      if (index.unique) warnings.push(t('output.couchUnique', { collection: collection.name }));
      const filter = parseLiteral(index.partialFilter);
      const body = {
        index: {
          fields: keys.map((k) => ({ [toMongoPath(k.path)]: k.order === -1 ? 'desc' : 'asc' })),
          partial_filter_selector: { [field]: value, ...(filter && typeof filter === 'object' ? filter : {}) },
        },
        ddoc: `${collection.name}-indexes`,
        name: indexName(index),
        type: 'json',
      };
      lines.push(`# ${collection.name}`, `curl -X POST "$COUCH_URL/$DB/_index" -H 'Content-Type: application/json' -d '${JSON.stringify(body).replace(/'/g, "'\\''")}'`, '');
    }
  }
  lines.push(`# ${t('output.designUpload')}`, `curl -X POST "$COUCH_URL/$DB/_bulk_docs" -H 'Content-Type: application/json' -d @design-docs.json`, '');
  return { code: lines.join('\n'), warnings: [...new Set(warnings)] };
};

const n1qlPath = (path: string) => toMongoPath(path).split('.').map((p) => `\`${p}\``).join('.');

/** Couchbase SQL++ index statements over bucket.scope.collection. */
export const couchbaseIndexes = (project: Project): OutputResult => {
  const warnings: string[] = [];
  const bucket = databaseName(project);
  const lines: string[] = [];
  for (const collection of project.collections) {
    const keyspace = `\`${bucket}\`.\`_default\`.\`${collection.name}\``;
    lines.push(`-- ${collection.name}`, `CREATE PRIMARY INDEX IF NOT EXISTS ON ${keyspace};`);
    for (const index of collection.indexes) {
      const keys = index.keys.filter((k) => k.path);
      if (keys.length === 0) continue;
      if (index.unique) warnings.push(t('output.couchUnique', { collection: collection.name }));
      const parts = keys.map((k) => {
        if (k.path.includes('[]')) {
          const [arr, rest] = k.path.split('[].');
          return `DISTINCT ARRAY v.${n1qlPath(rest ?? '')} FOR v IN ${n1qlPath(arr)} END`;
        }
        return `${n1qlPath(k.path)}${k.order === -1 ? ' DESC' : ''}`;
      });
      lines.push(`CREATE INDEX \`${indexName(index)}\` IF NOT EXISTS ON ${keyspace}(${parts.join(', ')});`);
    }
    lines.push('');
  }
  return { code: lines.join('\n'), warnings: [...new Set(warnings)] };
};
