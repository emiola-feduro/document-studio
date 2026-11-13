import { t, type MessageKey } from '../i18n';
import { collectionNameProblem, ENGINES, fieldNameProblem } from './engines';
import { indexName } from './indexes';
import { fieldAtPath, maxDepth, toMongoPath, walkFields } from './paths';
import { referencePaths } from './relationships';
import type { Collection, Field, Project, Relationship } from './types';

export type IssueLevel = 'error' | 'warning' | 'info';

export type Issue = {
  level: IssueLevel;
  code: string;
  message: string;
  collectionId?: string;
  relationshipId?: string;
  path?: string;
};

const NAME_PROBLEMS: Record<string, MessageKey> = {
  empty: 'advisor.name.empty',
  dollar: 'advisor.name.dollar',
  dot: 'advisor.name.dot',
  reserved: 'advisor.name.reserved',
  underscore: 'advisor.name.underscore',
  tooLong: 'advisor.name.tooLong',
  system: 'advisor.name.system',
  slash: 'advisor.name.slash',
};

/** Rough size in bytes of a value of each type, with names counted once. */
const SCALAR_BYTES: Partial<Record<Field['type'], number>> = {
  int: 4,
  long: 8,
  double: 8,
  number: 8,
  decimal: 16,
  bool: 1,
  date: 8,
  timestamp: 8,
  objectId: 12,
  reference: 24,
  uuid: 16,
  null: 0,
  geoPoint: 40,
  any: 64,
  enum: 16,
};

/** Unbounded arrays count as this many elements, so the estimate stays finite. */
const UNBOUNDED_ITEMS = 50;
const DEFAULT_STRING = 128;

export type SizeEstimate = { bytes: number; unbounded: boolean };

/** Largest document the model allows, from types, maxLength and maxItems. */
export const estimateSize = (fields: Field[]): SizeEstimate => {
  let unbounded = false;
  const sizeOf = (field: Field): number => {
    const name = new TextEncoder().encode(field.name).length + 2;
    if (field.type === 'string' || field.type === 'binary') return name + (field.maxLength ?? DEFAULT_STRING) + 5;
    if (field.type === 'object') return name + 5 + (field.children ?? []).reduce((n, c) => n + sizeOf(c), 0);
    if (field.type === 'array') {
      if (field.maxItems === undefined) unbounded = true;
      const items = field.maxItems ?? UNBOUNDED_ITEMS;
      return name + 5 + items * (field.items ? sizeOf({ ...field.items, name: '0' }) : 64);
    }
    return name + (SCALAR_BYTES[field.type] ?? 16);
  };
  return { bytes: 5 + fields.reduce((n, f) => n + sizeOf(f), 0), unbounded };
};

export const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;

const structureIssues = (project: Project, collection: Collection): Issue[] => {
  const issues: Issue[] = [];
  const engine = ENGINES[project.engine];
  const base = { collectionId: collection.id };
  const nameProblem = collectionNameProblem(project.engine, collection.name);
  if (nameProblem) issues.push({ ...base, level: 'error', code: 'collection-name', message: t(NAME_PROBLEMS[nameProblem], { name: collection.name || '?' }) });
  if (project.collections.some((c) => c.id !== collection.id && c.name === collection.name && c.parentId === collection.parentId)) {
    issues.push({ ...base, level: 'error', code: 'duplicate-collection', message: t('advisor.duplicateCollection', { name: collection.name }) });
  }
  const own = collection.fields.filter((f) => !engine.systemFields.some((s) => s.name === f.name));
  if (own.length === 0) issues.push({ ...base, level: 'warning', code: 'no-fields', message: t('advisor.noFields', { name: collection.name }) });

  const checkLevel = (fields: Field[], prefix: string) => {
    const seen = new Set<string>();
    for (const field of fields) {
      if (field.name && seen.has(field.name)) {
        issues.push({ ...base, level: 'error', code: 'duplicate-field', path: prefix + field.name, message: t('advisor.duplicateField', { name: field.name, collection: collection.name }) });
      }
      seen.add(field.name);
    }
  };
  checkLevel(collection.fields, '');
  for (const { field, path, depth } of walkFields(collection.fields)) {
    const isSystem = depth === 0 && engine.systemFields.some((s) => s.name === field.name);
    const problem = fieldNameProblem(project.engine, field.name, isSystem);
    if (problem) issues.push({ ...base, level: 'error', code: 'field-name', path, message: t(NAME_PROBLEMS[problem], { name: field.name || path || '?' }) });
    if (field.type === 'object') {
      if (!field.children?.length) issues.push({ ...base, level: 'warning', code: 'empty-object', path, message: t('advisor.emptyObject', { path }) });
      else checkLevel(field.children, `${path}.`);
    }
    if (field.type === 'array') {
      if (!field.items) issues.push({ ...base, level: 'warning', code: 'array-items', path, message: t('advisor.arrayItems', { path }) });
      else if (field.items.type === 'object') {
        if (!field.items.children?.length) issues.push({ ...base, level: 'warning', code: 'empty-object', path, message: t('advisor.emptyObject', { path: `${path}[]` }) });
        else checkLevel(field.items.children, `${path}[].`);
      }
      if (field.items?.type === 'array' && !engine.nestedArrays) issues.push({ ...base, level: 'error', code: 'nested-array', path, message: t('advisor.nestedArray', { path }) });
      if (field.maxItems === undefined && (field.items?.type === 'object' || field.items?.reference)) {
        issues.push({ ...base, level: 'warning', code: 'unbounded-array', path, message: t('advisor.unboundedArray', { path }) });
      }
      if (field.minItems !== undefined && field.maxItems !== undefined && field.minItems > field.maxItems) {
        issues.push({ ...base, level: 'error', code: 'items-range', path, message: t('advisor.range', { path }) });
      }
    }
    if (field.type === 'enum' && !field.enumValues?.length) issues.push({ ...base, level: 'warning', code: 'empty-enum', path, message: t('advisor.emptyEnum', { path }) });
    if (field.pattern) {
      try {
        new RegExp(field.pattern);
      } catch {
        issues.push({ ...base, level: 'error', code: 'bad-pattern', path, message: t('advisor.badPattern', { path }) });
      }
    }
    if (field.minimum !== undefined && field.maximum !== undefined && field.minimum > field.maximum) {
      issues.push({ ...base, level: 'error', code: 'range', path, message: t('advisor.range', { path }) });
    }
    if (field.minLength !== undefined && field.maxLength !== undefined && field.minLength > field.maxLength) {
      issues.push({ ...base, level: 'error', code: 'length-range', path, message: t('advisor.range', { path }) });
    }
    if (field.type === 'any') issues.push({ ...base, level: 'info', code: 'any', path, message: t('advisor.anyType', { path }) });
  }
  const depth = maxDepth(collection.fields);
  if (depth > engine.maxDepth) issues.push({ ...base, level: 'error', code: 'depth', message: t('advisor.depth', { depth, max: engine.maxDepth }) });
  if (collection.kind === 'subcollection' && !engine.subcollections) {
    issues.push({ ...base, level: 'error', code: 'subcollection', message: t('advisor.subcollectionEngine', { name: collection.name }) });
  }
  return issues;
};

const indexIssues = (project: Project, collection: Collection): Issue[] => {
  const issues: Issue[] = [];
  const base = { collectionId: collection.id };
  const keysOf = (i: Collection['indexes'][number]) => i.keys.filter((k) => k.path).map((k) => `${toMongoPath(k.path)}:${k.order}`);
  const max = ENGINES[project.engine].maxIndexes;
  if (max && collection.indexes.length + 1 > max) issues.push({ ...base, level: 'error', code: 'too-many-indexes', message: t('advisor.tooManyIndexes', { max }) });

  collection.indexes.forEach((index, i) => {
    const keys = keysOf(index);
    const name = indexName(index);
    if (keys.length === 0 && !index.wildcard) {
      issues.push({ ...base, level: 'warning', code: 'empty-index', message: t('advisor.emptyIndex', { name }) });
      return;
    }
    for (const key of index.keys) {
      if (key.path && !fieldAtPath(collection.fields, key.path)) issues.push({ ...base, level: 'error', code: 'index-path', path: key.path, message: t('advisor.indexPath', { name, path: key.path }) });
    }
    collection.indexes.forEach((other, j) => {
      if (i === j || index.wildcard || other.wildcard) return;
      const otherKeys = keysOf(other);
      const same = keys.length === otherKeys.length && keys.every((k, n) => k === otherKeys[n]);
      if (same && j < i) issues.push({ ...base, level: 'warning', code: 'duplicate-index', message: t('advisor.duplicateIndex', { name, other: indexName(other) }) });
      // An index that is a prefix of a longer one is redundant unless it is unique, sparse or partial.
      const prefix = !same && keys.length < otherKeys.length && keys.every((k, n) => k === otherKeys[n]);
      if (prefix && !index.unique && !index.sparse && !index.partialFilter) {
        issues.push({ ...base, level: 'info', code: 'prefix-index', message: t('advisor.prefixIndex', { name, other: indexName(other) }) });
      }
    });
    if (index.unique && index.keys.some((k) => k.path.includes('[]') || fieldAtPath(collection.fields, k.path)?.type === 'array')) {
      issues.push({ ...base, level: 'warning', code: 'unique-multikey', message: t('advisor.uniqueMultikey', { name }) });
    }
    if (index.partialFilter?.trim()) {
      try {
        JSON.parse(index.partialFilter);
      } catch {
        issues.push({ ...base, level: 'error', code: 'bad-filter', message: t('advisor.badFilter', { name }) });
      }
    }
    if (project.engine !== 'mongodb' && index.keys.some((k) => typeof k.order === 'string')) {
      issues.push({ ...base, level: 'warning', code: 'index-kind', message: t('advisor.indexKind', { name }) });
    }
    if (project.engine === 'firestore' && keys.length > 1 && index.keys.filter((k) => fieldAtPath(collection.fields, k.path)?.type === 'array').length > 1) {
      issues.push({ ...base, level: 'error', code: 'firestore-two-arrays', message: t('advisor.firestoreArrays', { name }) });
    }
  });

  const { ttl } = collection.options;
  if (ttl?.field) {
    const field = fieldAtPath(collection.fields, ttl.field);
    if (!field || !['date', 'timestamp'].includes(field.type)) issues.push({ ...base, level: 'error', code: 'ttl-type', path: ttl.field, message: t('advisor.ttlType', { path: ttl.field }) });
  }
  const { timeseries } = collection.options;
  if (timeseries?.timeField) {
    const field = fieldAtPath(collection.fields, timeseries.timeField);
    if (!field || field.type !== 'date') issues.push({ ...base, level: 'error', code: 'timeseries-type', path: timeseries.timeField, message: t('advisor.timeseriesType', { path: timeseries.timeField }) });
  }

  // Reference fields are what queries filter by; they deserve an index (Firestore indexes single fields itself).
  if (project.engine !== 'firestore') {
    for (const ref of referencePaths(collection)) {
      const indexed = collection.indexes.some((i) => i.keys[0] && toMongoPath(i.keys[0].path) === toMongoPath(ref.path));
      if (!indexed) issues.push({ ...base, level: 'warning', code: 'ref-index', path: ref.path, message: t('advisor.refIndex', { path: ref.path }) });
    }
  }
  return issues;
};

const sizeIssues = (project: Project, collection: Collection): Issue[] => {
  const limit = ENGINES[project.engine].maxDocumentBytes;
  const { bytes } = estimateSize(collection.fields);
  const base = { collectionId: collection.id };
  const values = { size: formatBytes(bytes), limit: formatBytes(limit) };
  if (bytes >= limit) return [{ ...base, level: 'error', code: 'size', message: t('advisor.sizeOver', values) }];
  if (bytes >= limit / 2) return [{ ...base, level: 'warning', code: 'size', message: t('advisor.sizeHalf', values) }];
  return [];
};

/** What the advisor suggests for a relationship: embed or reference, with the reason. */
export const recommendRelationship = (project: Project, rel: Relationship): { kind: Relationship['kind']; reason: MessageKey; pattern?: MessageKey } => {
  const from = project.collections.find((c) => c.id === rel.from.collectionId);
  const field = from ? fieldAtPath(from.fields, rel.from.fieldPath) : undefined;
  const bounded = field?.type === 'array' ? field.maxItems !== undefined && field.maxItems <= 100 : true;
  const targetReferencedElsewhere = project.relationships.some((r) => r.id !== rel.id && r.to.collectionId === rel.to.collectionId);
  if (rel.cardinality === 'N:M') return { kind: 'reference', reason: 'advisor.rec.nm', pattern: rel.twoWay ? undefined : 'advisor.pattern.extendedReference' };
  if (rel.cardinality === '1:N' && !bounded) return { kind: 'reference', reason: 'advisor.rec.unbounded', pattern: 'advisor.pattern.bucket' };
  if (targetReferencedElsewhere && rel.kind === 'embed') return { kind: 'reference', reason: 'advisor.rec.shared', pattern: 'advisor.pattern.extendedReference' };
  if (rel.cardinality === '1:1') return { kind: 'embed', reason: 'advisor.rec.oneToOne', pattern: 'advisor.pattern.subset' };
  return { kind: 'embed', reason: 'advisor.rec.fewTogether', pattern: rel.kind === 'reference' ? 'advisor.pattern.subset' : undefined };
};

const relationshipIssues = (project: Project): Issue[] => {
  const issues: Issue[] = [];
  for (const rel of project.relationships) {
    const base = { relationshipId: rel.id };
    const from = project.collections.find((c) => c.id === rel.from.collectionId);
    const to = project.collections.find((c) => c.id === rel.to.collectionId);
    if (!from || !to) {
      issues.push({ ...base, level: 'error', code: 'rel-missing', message: t('advisor.relMissing') });
      continue;
    }
    const field = fieldAtPath(from.fields, rel.from.fieldPath);
    if (!field) {
      issues.push({ ...base, collectionId: from.id, level: 'error', code: 'rel-field', message: t('advisor.relField', { path: rel.from.fieldPath, collection: from.name }) });
      continue;
    }
    if (rel.kind === 'reference') {
      const holder = field.type === 'array' ? field.items : field;
      const idField = to.fields.find((f) => f.name === '_id');
      const expected = project.engine === 'mongodb' ? (idField?.type ?? 'objectId') : ENGINES[project.engine].referenceType;
      const ok = holder && (holder.type === expected || (holder.type === 'reference' && project.engine === 'mongodb') || (project.engine === 'couchdb' && holder.type === 'string'));
      if (!ok) issues.push({ ...base, collectionId: from.id, level: 'error', code: 'rel-type', path: rel.from.fieldPath, message: t('advisor.relType', { path: rel.from.fieldPath, type: expected }) });
      if (rel.storage === 'array' && field.type !== 'array') issues.push({ ...base, level: 'error', code: 'rel-storage', message: t('advisor.relStorage', { path: rel.from.fieldPath }) });
      if (rel.twoWay) issues.push({ ...base, level: 'info', code: 'two-way', message: t('advisor.twoWay', { from: from.name, to: to.name }) });
    }
    const rec = recommendRelationship(project, rel);
    if (rec.kind !== rel.kind) {
      issues.push({ ...base, level: 'info', code: 'rec-kind', message: t(rec.kind === 'embed' ? 'advisor.suggestEmbed' : 'advisor.suggestReference', { path: `${from.name}.${rel.from.fieldPath}`, reason: t(rec.reason) }) });
    }
  }
  return issues;
};

/** Every warning about the model, in the order the inspector lists them. */
export const adviseProject = (project: Project): Issue[] => [
  ...project.collections.flatMap((c) => [...structureIssues(project, c), ...indexIssues(project, c), ...sizeIssues(project, c)]),
  ...relationshipIssues(project),
];

/** MongoDB patterns with a one line explanation, offered in the relationship and collection inspectors. */
export const PATTERNS: { id: string; name: MessageKey; text: MessageKey }[] = [
  { id: 'subset', name: 'advisor.pattern.subset.name', text: 'advisor.pattern.subset' },
  { id: 'extendedReference', name: 'advisor.pattern.extendedReference.name', text: 'advisor.pattern.extendedReference' },
  { id: 'bucket', name: 'advisor.pattern.bucket.name', text: 'advisor.pattern.bucket' },
  { id: 'computed', name: 'advisor.pattern.computed.name', text: 'advisor.pattern.computed' },
  { id: 'outlier', name: 'advisor.pattern.outlier.name', text: 'advisor.pattern.outlier' },
  { id: 'polymorphic', name: 'advisor.pattern.polymorphic.name', text: 'advisor.pattern.polymorphic' },
  { id: 'attribute', name: 'advisor.pattern.attribute.name', text: 'advisor.pattern.attribute' },
  { id: 'schemaVersioning', name: 'advisor.pattern.schemaVersioning.name', text: 'advisor.pattern.schemaVersioning' },
  { id: 'tree', name: 'advisor.pattern.tree.name', text: 'advisor.pattern.tree' },
];
