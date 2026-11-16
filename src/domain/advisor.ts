import { t, type MessageKey } from '../i18n';
import { collectionNameProblem, ENGINES, fieldNameProblem } from './engines';
import { indexName } from './indexes';
import { fieldAtPath, maxDepth, toMongoPath, walkFields } from './paths';
import { referencePaths } from './relationships';
import type { Collection, Field, FieldType, Project, Relationship } from './types';

export type IssueLevel = 'error' | 'warning' | 'info';

/** A change the advisor can apply in one click. */
export type IssueFix =
  | { kind: 'createIndex'; collectionId: string; path: string }
  | { kind: 'addMaxItems'; collectionId: string; path: string; value: number }
  | { kind: 'changeKind'; relationshipId: string; to: Relationship['kind'] }
  | { kind: 'declarePattern'; relationshipId: string; pattern: NonNullable<Relationship['pattern']> }
  | { kind: 'setType'; collectionId: string; path: string; type: FieldType }
  | { kind: 'addSchemaVersion'; collectionId: string };

export type Issue = {
  /** Stable across languages and edits elsewhere, so an ignored issue stays ignored. */
  id: string;
  level: IssueLevel;
  code: string;
  message: string;
  collectionId?: string;
  relationshipId?: string;
  path?: string;
  /** What the issue is about when the path is not enough, such as an index id. */
  subject?: string;
  fixes?: IssueFix[];
};

type Draft = Omit<Issue, 'id'>;

/** Max items the quick fix sets on an unbounded array. */
export const DEFAULT_MAX_ITEMS = 100;
/** Top-level fields from which the attribute pattern is suggested. */
export const MANY_FIELDS = 30;
/** Top-level fields from which a schemaVersion field is suggested. */
export const VERSIONED_FIELDS = 8;

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

const structureIssues = (project: Project, collection: Collection): Draft[] => {
  const issues: Draft[] = [];
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
        const fixes: IssueFix[] = [{ kind: 'addMaxItems', collectionId: collection.id, path, value: DEFAULT_MAX_ITEMS }];
        // An embedded array that grows without limit is better as references.
        const embed = project.relationships.find((r) => r.kind === 'embed' && r.from.collectionId === collection.id && r.from.fieldPath === path);
        if (embed) fixes.push({ kind: 'changeKind', relationshipId: embed.id, to: 'reference' });
        issues.push({ ...base, level: 'warning', code: 'unbounded-array', path, message: t('advisor.unboundedArray', { path }), fixes });
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

const indexIssues = (project: Project, collection: Collection): Draft[] => {
  const issues: Draft[] = [];
  const base = { collectionId: collection.id };
  const keysOf = (i: Collection['indexes'][number]) => i.keys.filter((k) => k.path).map((k) => `${toMongoPath(k.path)}:${k.order}`);
  const max = ENGINES[project.engine].maxIndexes;
  if (max && collection.indexes.length + 1 > max) issues.push({ ...base, level: 'error', code: 'too-many-indexes', message: t('advisor.tooManyIndexes', { max }) });

  collection.indexes.forEach((index, i) => {
    const keys = keysOf(index);
    const name = indexName(index);
    if (keys.length === 0 && !index.wildcard) {
      issues.push({ ...base, subject: index.id, level: 'warning', code: 'empty-index', message: t('advisor.emptyIndex', { name }) });
      return;
    }
    for (const key of index.keys) {
      if (key.path && !fieldAtPath(collection.fields, key.path)) issues.push({ ...base, subject: index.id, level: 'error', code: 'index-path', path: key.path, message: t('advisor.indexPath', { name, path: key.path }) });
    }
    collection.indexes.forEach((other, j) => {
      if (i === j || index.wildcard || other.wildcard) return;
      const otherKeys = keysOf(other);
      const same = keys.length === otherKeys.length && keys.every((k, n) => k === otherKeys[n]);
      if (same && j < i) issues.push({ ...base, subject: index.id, level: 'warning', code: 'duplicate-index', message: t('advisor.duplicateIndex', { name, other: indexName(other) }) });
      // An index that is a prefix of a longer one is redundant unless it is unique, sparse or partial.
      const prefix = !same && keys.length < otherKeys.length && keys.every((k, n) => k === otherKeys[n]);
      if (prefix && !index.unique && !index.sparse && !index.partialFilter) {
        issues.push({ ...base, subject: index.id, level: 'info', code: 'prefix-index', message: t('advisor.prefixIndex', { name, other: indexName(other) }) });
      }
    });
    if (index.unique && index.keys.some((k) => k.path.includes('[]') || fieldAtPath(collection.fields, k.path)?.type === 'array')) {
      issues.push({ ...base, subject: index.id, level: 'warning', code: 'unique-multikey', message: t('advisor.uniqueMultikey', { name }) });
    }
    if (index.partialFilter?.trim()) {
      try {
        JSON.parse(index.partialFilter);
      } catch {
        issues.push({ ...base, subject: index.id, level: 'error', code: 'bad-filter', message: t('advisor.badFilter', { name }) });
      }
    }
    if (project.engine !== 'mongodb' && index.keys.some((k) => typeof k.order === 'string')) {
      issues.push({ ...base, subject: index.id, level: 'warning', code: 'index-kind', message: t('advisor.indexKind', { name }) });
    }
    if (project.engine === 'firestore' && keys.length > 1 && index.keys.filter((k) => fieldAtPath(collection.fields, k.path)?.type === 'array').length > 1) {
      issues.push({ ...base, subject: index.id, level: 'error', code: 'firestore-two-arrays', message: t('advisor.firestoreArrays', { name }) });
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
      if (!indexed) {
        issues.push({ ...base, level: 'warning', code: 'ref-index', path: ref.path, message: t('advisor.refIndex', { path: ref.path }), fixes: [{ kind: 'createIndex', collectionId: collection.id, path: ref.path }] });
      }
    }
  }
  return issues;
};

const sizeIssues = (project: Project, collection: Collection): Draft[] => {
  const limit = ENGINES[project.engine].maxDocumentBytes;
  const { bytes } = estimateSize(collection.fields);
  const base = { collectionId: collection.id };
  const values = { size: formatBytes(bytes), limit: formatBytes(limit) };
  if (bytes >= limit) return [{ ...base, level: 'error' as const, code: 'size', message: t('advisor.sizeOver', values) }];
  if (bytes >= limit / 2) return [{ ...base, level: 'warning' as const, code: 'size', message: t('advisor.sizeHalf', values) }];
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

const relationshipIssues = (project: Project): Draft[] => {
  const issues: Draft[] = [];
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
      issues.push({
        ...base,
        level: 'info',
        code: 'rec-kind',
        message: t(rec.kind === 'embed' ? 'advisor.suggestEmbed' : 'advisor.suggestReference', { path: `${from.name}.${rel.from.fieldPath}`, reason: t(rec.reason) }),
        fixes: [{ kind: 'changeKind', relationshipId: rel.id, to: rec.kind }],
      });
    }
  }
  return issues;
};

/** Rules that look at several collections: copies of the same data, the same field with two types, wide documents. */
const designIssues = (project: Project): Draft[] => {
  const issues: Draft[] = [];
  const engine = ENGINES[project.engine];
  const byId = new Map(project.collections.map((c) => [c.id, c]));

  // The same collection embedded in several places is copied data that has to be kept in sync.
  const embedsByTarget = new Map<string, Relationship[]>();
  for (const rel of project.relationships) if (rel.kind === 'embed') embedsByTarget.set(rel.to.collectionId, [...(embedsByTarget.get(rel.to.collectionId) ?? []), rel]);
  for (const [targetId, rels] of embedsByTarget) {
    if (rels.length < 2) continue;
    const target = byId.get(targetId);
    for (const rel of rels.filter((r) => !r.pattern)) {
      const from = byId.get(rel.from.collectionId);
      issues.push({
        relationshipId: rel.id,
        collectionId: rel.from.collectionId,
        level: 'warning',
        code: 'embed-copies',
        message: t('advisor.embedCopies', { path: `${from?.name ?? '?'}.${rel.from.fieldPath}`, collection: target?.name ?? '?', count: rels.length }),
        fixes: [
          { kind: 'declarePattern', relationshipId: rel.id, pattern: 'extendedReference' },
          { kind: 'declarePattern', relationshipId: rel.id, pattern: 'subset' },
        ],
      });
    }
  }

  // A field with the same name means the same thing; two types for it break comparisons and lookups.
  const seen = new Set<string>();
  for (const rel of project.relationships) {
    const from = byId.get(rel.from.collectionId);
    const to = byId.get(rel.to.collectionId);
    if (!from || !to || from.id === to.id) continue;
    const embedded = rel.kind === 'embed' ? fieldAtPath(from.fields, rel.from.fieldPath) : undefined;
    const embeddedFields = embedded ? (embedded.type === 'array' ? embedded.items?.children : embedded.children) : undefined;
    const pairs: { list: Field[]; prefix: string; owner: Collection }[] = embeddedFields
      ? [{ list: embeddedFields, prefix: `${rel.from.fieldPath}${embedded?.type === 'array' ? '[]' : ''}.`, owner: from }]
      : [{ list: from.fields, prefix: '', owner: from }];
    for (const { list, prefix, owner } of pairs) {
      for (const field of list) {
        if (engine.systemFields.some((s) => s.name === field.name) || field.name === rel.from.fieldPath) continue;
        const other = to.fields.find((f) => f.name === field.name);
        if (!other || other.type === field.type || ['object', 'array'].includes(field.type) || ['object', 'array'].includes(other.type)) continue;
        const path = prefix + field.name;
        const key = `${owner.id}|${path}`;
        if (seen.has(key)) continue;
        seen.add(key);
        issues.push({
          collectionId: owner.id,
          path,
          subject: to.id,
          level: 'warning',
          code: 'type-mismatch',
          message: t('advisor.typeMismatch', { name: field.name, type: field.type, collection: owner.name, otherType: other.type, other: to.name }),
          fixes: [{ kind: 'setType', collectionId: owner.id, path, type: other.type }],
        });
      }
    }
  }

  for (const collection of project.collections) {
    const own = collection.fields.filter((f) => !engine.systemFields.some((s) => s.name === f.name));
    if (own.length > MANY_FIELDS) {
      issues.push({ collectionId: collection.id, level: 'info', code: 'many-fields', message: t('advisor.manyFields', { name: collection.name, count: own.length }) });
    }
    if (own.length >= VERSIONED_FIELDS && !collection.fields.some((f) => f.name === 'schemaVersion')) {
      issues.push({ collectionId: collection.id, level: 'info', code: 'schema-version', message: t('advisor.schemaVersion', { name: collection.name }), fixes: [{ kind: 'addSchemaVersion', collectionId: collection.id }] });
    }
  }
  return issues;
};

const issueId = (i: Draft) => [i.code, i.collectionId ?? '', i.relationshipId ?? '', i.path ?? '', i.subject ?? ''].join('|');

/** Every finding about the model, in the order the inspector lists them, ignored ones included. */
export const adviseProject = (project: Project): Issue[] => {
  const drafts = [
    ...project.collections.flatMap((c) => [...structureIssues(project, c), ...indexIssues(project, c), ...sizeIssues(project, c)]),
    ...relationshipIssues(project),
    ...designIssues(project),
  ];
  const used = new Map<string, number>();
  return drafts.map((d) => {
    const base = issueId(d);
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    return { ...d, id: n ? `${base}|${n}` : base };
  });
};

/** Findings minus the ones the person ignored, and how many were ignored. */
export const activeIssues = (project: Project) => {
  const all = adviseProject(project);
  const dismissed = new Set(project.dismissedIssues ?? []);
  const issues = all.filter((i) => !dismissed.has(i.id));
  return { issues, dismissedCount: all.length - issues.length };
};

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
