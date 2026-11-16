import { t } from '../i18n';
import { ENGINES } from './engines';
import { indexName, mongoKeys } from './indexes';
import { couchDesignOutput, discriminator } from './outputs/couchdb';
import { firestoreIndexes } from './outputs/firestore-indexes';
import { firestoreRules } from './outputs/firestore-rules';
import type { Language } from './outputs';
import { bsonSchema } from './outputs/json-schema';
import { createIndexes, createOptions, indexOptions, ref } from './outputs/mongodb-script';
import { databaseName, jsLiteral, parseLiteral, RawJs } from './outputs/shared';
import { toMongoPath, walkFields } from './paths';
import type { Collection, DocIndex, Field, FieldType, Project } from './types';

/**
 * Migration between two versions of a model. Collections, fields and indexes are matched by their
 * stable ids, so a renamed field becomes $rename (and a field moved to another level a move) instead
 * of a removal plus a new field. Each engine gets what it needs: MongoDB a mongosh script (collMod,
 * updateMany, indexes), Firestore the new rules and indexes plus an Admin SDK script that rewrites
 * the documents in batches of 500, CouchDB the new design documents plus a _bulk_docs script.
 */

export type Snapshot = Omit<Project, 'documents'>;

export type ChangeKind =
  | 'createCollection'
  | 'dropCollection'
  | 'renameCollection'
  | 'addField'
  | 'dropField'
  | 'renameField'
  | 'moveField'
  | 'changeType'
  | 'makeRequired'
  | 'makeOptional'
  | 'shrinkLength'
  | 'shrinkItems'
  | 'removeEnumValues'
  | 'changeValidation'
  | 'addIndex'
  | 'dropIndex';

export type Change = { kind: ChangeKind; collection: string; detail?: string; destructive?: boolean };
export type MigrationFile = { name: string; language: Language; code: string };
export type Migration = { files: MigrationFile[]; changes: Change[]; warnings: string[] };

export type MigrationOptions = {
  /** Adds 1 to schemaVersion in every migrated document. */
  bumpSchemaVersion?: boolean;
  /** Only documents with this schemaVersion are migrated. */
  previousSchemaVersion?: number;
};

type FieldOp =
  | { op: 'rename'; from: string; to: string }
  | { op: 'default'; path: string; field: Field }
  | { op: 'unset'; path: string }
  | { op: 'convert'; path: string; from: FieldType; field: Field };

type CollectionDiff = {
  before: Collection;
  after: Collection;
  ops: FieldOp[];
  dropIndexes: DocIndex[];
  addIndexes: DocIndex[];
  validator: boolean;
};

type Entry = { path: string; field: Field; parentId: string | null; parentArray: boolean };

const entries = (collection: Collection) => {
  const map = new Map<string, Entry>();
  const visit = (fields: Field[], prefix: string, parent: Field | null) => {
    for (const field of fields) {
      const path = prefix ? `${prefix}${parent?.type === 'array' ? '[]' : ''}.${field.name}` : field.name;
      map.set(field.id, { path, field, parentId: parent?.id ?? null, parentArray: parent?.type === 'array' });
      const nested = field.type === 'object' ? field.children : field.type === 'array' && field.items?.type === 'object' ? field.items.children : undefined;
      if (nested) visit(nested, path, field);
    }
  };
  visit(collection.fields, '', null);
  return map;
};

/** Conversions that keep every value. */
const WIDEN: Partial<Record<FieldType, FieldType[]>> = {
  int: ['long', 'double', 'decimal', 'number', 'string'],
  long: ['decimal', 'double', 'number', 'string'],
  double: ['decimal', 'number', 'string'],
  number: ['double', 'decimal', 'string'],
  decimal: ['string'],
  bool: ['string'],
  date: ['timestamp', 'string'],
  timestamp: ['date', 'string'],
  objectId: ['string', 'reference'],
  reference: ['objectId', 'string'],
  uuid: ['string'],
  enum: ['string'],
};

const MONGO_CONVERT: Partial<Record<FieldType, string>> = {
  int: '$toInt',
  long: '$toLong',
  double: '$toDouble',
  number: '$toDouble',
  decimal: '$toDecimal',
  string: '$toString',
  enum: '$toString',
  bool: '$toBool',
  date: '$toDate',
  timestamp: '$toDate',
  objectId: '$toObjectId',
  reference: '$toObjectId',
};

const sameIndex = (a: DocIndex, b: DocIndex) => JSON.stringify({ ...a, id: '' }) === JSON.stringify({ ...b, id: '' }) && indexName(a) === indexName(b);

const validationOf = (c: Collection) => JSON.stringify([c.options.validationLevel, c.options.validationAction, c.options.additionalProperties]);

const diffCollection = (before: Collection, after: Collection, changes: Change[]): CollectionDiff => {
  const name = after.name;
  const old = entries(before);
  const now = entries(after);
  const ops: FieldOp[] = [];
  const change = (kind: ChangeKind, detail: string, destructive = false) => changes.push({ kind, collection: name, detail, ...(destructive ? { destructive } : {}) });

  // Renames and moves, shallow first, each from where the earlier ones left its parent.
  const current = new Map([...old].map(([id, e]) => [id, e.path]));
  const depth = (p: string) => p.split('.').length;
  const moved = [...now.entries()].filter(([id, e]) => old.has(id) && old.get(id)!.path !== e.path).sort((a, b) => depth(old.get(a[0])!.path) - depth(old.get(b[0])!.path));
  for (const [id, e] of moved) {
    const o = old.get(id)!;
    const sameParent = o.parentId === e.parentId;
    if (sameParent && o.field.name === e.field.name) continue; // Only its parent was renamed.
    const parentPath = o.parentId ? current.get(o.parentId)! : '';
    const from = parentPath ? `${parentPath}${o.parentArray ? '[]' : ''}.${o.field.name}` : o.field.name;
    ops.push({ op: 'rename', from, to: e.path });
    change(sameParent ? 'renameField' : 'moveField', `${toMongoPath(o.path)} → ${toMongoPath(e.path)}`);
    // Descendants now live under the new path.
    for (const [cid, ce] of old) if (ce.path.startsWith(`${o.path}.`) || ce.path.startsWith(`${o.path}[].`)) current.set(cid, e.path + current.get(cid)!.slice(from.length));
    current.set(id, e.path);
  }

  for (const [id, e] of now) {
    const o = old.get(id);
    const path = toMongoPath(e.path);
    if (!o) {
      // A new field inside a new parent arrives with the parent.
      if (e.parentId && !old.has(e.parentId)) continue;
      const hasDefault = Boolean(e.field.defaultValue?.trim());
      change('addField', path, e.field.required && !hasDefault);
      if (hasDefault) ops.push({ op: 'default', path: e.path, field: e.field });
      continue;
    }
    const a = o.field;
    const b = e.field;
    if (a.type !== b.type) {
      const lossless = WIDEN[a.type]?.includes(b.type) ?? false;
      change('changeType', `${path}: ${a.type} → ${b.type}`, !lossless);
      ops.push({ op: 'convert', path: e.path, from: a.type, field: b });
    }
    if (!a.required && b.required) {
      const hasDefault = Boolean(b.defaultValue?.trim());
      change('makeRequired', path, !hasDefault);
      if (hasDefault) ops.push({ op: 'default', path: e.path, field: b });
    }
    if (a.required && !b.required) change('makeOptional', path);
    if (b.maxLength !== undefined && (a.maxLength === undefined || b.maxLength < a.maxLength)) change('shrinkLength', `${path}: ${b.maxLength}`, true);
    if (b.maxItems !== undefined && (a.maxItems === undefined || b.maxItems < a.maxItems)) change('shrinkItems', `${path}: ${b.maxItems}`, true);
    const lost = (a.enumValues ?? []).filter((v) => !(b.enumValues ?? []).includes(v));
    if (b.type === 'enum' && a.type === 'enum' && lost.length) change('removeEnumValues', `${path}: ${lost.join(', ')}`, true);
  }

  for (const [id, o] of old) {
    if (now.has(id)) continue;
    // Removing an object removes what is inside it.
    if (o.parentId && !now.has(o.parentId)) continue;
    change('dropField', toMongoPath(current.get(id) ?? o.path), true);
    ops.push({ op: 'unset', path: current.get(id) ?? o.path });
  }

  const beforeIndexes = new Map(before.indexes.map((i) => [i.id, i]));
  const afterIds = new Set(after.indexes.map((i) => i.id));
  const dropIndexes: DocIndex[] = [];
  const addIndexes: DocIndex[] = [];
  for (const index of after.indexes) {
    const prev = beforeIndexes.get(index.id);
    if (prev && sameIndex(prev, index)) continue;
    if (prev) dropIndexes.push(prev);
    addIndexes.push(index);
    change('addIndex', indexName(index));
  }
  for (const index of before.indexes) {
    if (afterIds.has(index.id)) continue;
    dropIndexes.push(index);
    change('dropIndex', indexName(index));
  }
  if (validationOf(before) !== validationOf(after)) change('changeValidation', after.options.validationLevel ?? 'strict');
  const validator = JSON.stringify(bsonSchema(before)) !== JSON.stringify(bsonSchema(after)) || validationOf(before) !== validationOf(after);
  return { before, after, ops, dropIndexes, addIndexes, validator };
};

type Plan = {
  changed: CollectionDiff[];
  created: Collection[];
  dropped: Collection[];
  renamed: { from: string; to: string; collection: Collection }[];
  changes: Change[];
};

const plan = (from: Snapshot, to: Snapshot): Plan => {
  const changes: Change[] = [];
  const before = new Map(from.collections.map((c) => [c.id, c]));
  const changed: CollectionDiff[] = [];
  const created: Collection[] = [];
  const renamed: Plan['renamed'] = [];
  for (const collection of to.collections) {
    const prev = before.get(collection.id);
    if (!prev) {
      created.push(collection);
      changes.push({ kind: 'createCollection', collection: collection.name });
      continue;
    }
    if (prev.name !== collection.name) {
      renamed.push({ from: prev.name, to: collection.name, collection });
      changes.push({ kind: 'renameCollection', collection: collection.name, detail: `${prev.name} → ${collection.name}` });
    }
    const diff = diffCollection(prev, collection, changes);
    if (diff.ops.length || diff.validator || diff.addIndexes.length || diff.dropIndexes.length) changed.push(diff);
  }
  const ids = new Set(to.collections.map((c) => c.id));
  const dropped = from.collections.filter((c) => !ids.has(c.id));
  for (const c of dropped) changes.push({ kind: 'dropCollection', collection: c.name, destructive: true });
  return { changed, created, dropped, renamed, changes };
};

/* MongoDB */

const singleArray = (path: string) => {
  const parts = path.split('[].');
  return parts.length === 2 ? { array: toMongoPath(parts[0]), rest: toMongoPath(parts[1]) } : undefined;
};

const mongoDefault = (field: Field): { value: unknown; perDocument?: string } => {
  const text = field.defaultValue?.trim() ?? '';
  if (text === 'now()') return { value: new RawJs('"$$NOW"') };
  if (text === 'uuid()') return { value: undefined, perDocument: 'UUID()' };
  if (text === 'ObjectId()') return { value: undefined, perDocument: 'ObjectId()' };
  return { value: parseLiteral(text) };
};

const mongoOps = (diff: CollectionDiff, filter: Record<string, unknown>, warnings: string[]): string[] => {
  const name = diff.after.name;
  const coll = ref(name);
  const lines: string[] = [];
  const f = (extra: Record<string, unknown> = {}) => jsLiteral({ ...filter, ...extra });
  for (const op of diff.ops) {
    if (op.op === 'rename') {
      const fromArr = singleArray(op.from);
      const toArr = singleArray(op.to);
      if (!fromArr && !toArr) {
        lines.push(`${coll}.updateMany(${f({ [toMongoPath(op.from)]: { $exists: true } })}, { $rename: ${jsLiteral({ [toMongoPath(op.from)]: toMongoPath(op.to) })} });`);
      } else if (fromArr && toArr && fromArr.array === toArr.array && !fromArr.rest.includes('.') && !toArr.rest.includes('.')) {
        // $rename does not reach into arrays: rebuild each element without the old key.
        const element = { $mergeObjects: [{ $arrayToObject: { $filter: { input: { $objectToArray: '$$item' }, cond: { $ne: ['$$this.k', fromArr.rest] } } } }, { [toArr.rest]: `$$item.${fromArr.rest}` }] };
        lines.push(`${coll}.updateMany(${f({ [fromArr.array]: { $type: 'array' } })}, [${jsLiteral({ $set: { [fromArr.array]: { $map: { input: `$${fromArr.array}`, as: 'item', in: element } } } })}]);`);
      } else warnings.push(t('migration.manualRename', { from: toMongoPath(op.from), to: toMongoPath(op.to), collection: name }));
    } else if (op.op === 'default') {
      const { value, perDocument } = mongoDefault(op.field);
      const arr = singleArray(op.path);
      if (perDocument) {
        if (arr) warnings.push(t('migration.manualDefault', { path: toMongoPath(op.path), collection: name }));
        else lines.push(`${coll}.find(${f({ [toMongoPath(op.path)]: { $exists: false } })}).forEach((doc) => ${coll}.updateOne({ _id: doc._id }, { $set: { ${JSON.stringify(toMongoPath(op.path))}: ${perDocument} } }));`);
      } else if (arr) {
        lines.push(`${coll}.updateMany(${f()}, { $set: { ${JSON.stringify(`${arr.array}.$[item].${arr.rest}`)}: ${jsLiteral(value)} } }, { arrayFilters: [${jsLiteral({ [`item.${arr.rest}`]: { $exists: false } })}] });`);
      } else if (value instanceof RawJs) {
        lines.push(`${coll}.updateMany(${f({ [toMongoPath(op.path)]: { $exists: false } })}, [{ $set: { ${JSON.stringify(toMongoPath(op.path))}: ${value.code} } }]);`);
      } else {
        lines.push(`${coll}.updateMany(${f({ [toMongoPath(op.path)]: { $exists: false } })}, { $set: ${jsLiteral({ [toMongoPath(op.path)]: value })} });`);
      }
    } else if (op.op === 'unset') {
      const arr = singleArray(op.path);
      const target = arr ? `${arr.array}.$[].${arr.rest}` : toMongoPath(op.path);
      lines.push(`${coll}.updateMany(${f()}, { $unset: ${jsLiteral({ [target]: '' })} });`);
    } else {
      const converter = MONGO_CONVERT[op.field.type];
      const arr = singleArray(op.path);
      if (!converter) warnings.push(t('migration.manualConvert', { path: toMongoPath(op.path), type: op.field.type, collection: name }));
      else if (arr) {
        const element = { $mergeObjects: ['$$item', { [arr.rest]: { [converter]: `$$item.${arr.rest}` } }] };
        lines.push(`${coll}.updateMany(${f({ [arr.array]: { $type: 'array' } })}, [${jsLiteral({ $set: { [arr.array]: { $map: { input: `$${arr.array}`, as: 'item', in: element } } } })}]);`);
      } else {
        const p = toMongoPath(op.path);
        lines.push(`${coll}.updateMany(${f({ [p]: { $exists: true } })}, [${jsLiteral({ $set: { [p]: { [converter]: `$${p}` } } })}]);`);
      }
    }
  }
  return lines;
};

const mongoMigration = (from: Snapshot, to: Snapshot, p: Plan, options: MigrationOptions, labels: { from: string; to: string }) => {
  const warnings: string[] = [];
  const filter = options.previousSchemaVersion !== undefined ? { schemaVersion: options.previousSchemaVersion } : {};
  const out = [`// ${t('migration.header', { from: labels.from, to: labels.to })}`, `use(${JSON.stringify(databaseName(to as Project))});`, ''];
  for (const r of p.renamed) out.push(`${ref(r.from)}.renameCollection(${JSON.stringify(r.to)});`);
  if (p.renamed.length) out.push('');
  for (const diff of p.changed) {
    const name = diff.after.name;
    const data = mongoOps(diff, filter, warnings);
    const bump = options.bumpSchemaVersion && (data.length > 0 || diff.validator);
    out.push(`// ${name}`);
    if (data.length || bump) {
      // Writes check the validator, so it is relaxed while the documents change.
      out.push(`db.runCommand(${jsLiteral({ collMod: name, validationLevel: 'off' })});`, ...data);
      if (bump) out.push(`${ref(name)}.updateMany(${jsLiteral(filter)}, { $inc: { schemaVersion: 1 } });`);
    }
    if (diff.validator || data.length || bump) {
      if (diff.after.options.timeseries?.timeField) warnings.push(t('output.timeseriesValidator', { name }));
      else {
        const { validationLevel = 'strict', validationAction = 'error' } = diff.after.options;
        out.push(`db.runCommand(${jsLiteral({ collMod: name, validator: { $jsonSchema: bsonSchema(diff.after) }, validationLevel, validationAction })});`);
      }
    }
    for (const index of diff.dropIndexes) out.push(`${ref(name)}.dropIndex(${JSON.stringify(indexName(index))});`);
    for (const index of diff.addIndexes) {
      if (!index.keys.some((k) => k.path) && !index.wildcard) continue;
      out.push(`${ref(name)}.createIndex(${jsLiteral(mongoKeys(index))}, ${jsLiteral(indexOptions(diff.after, index, warnings))});`);
    }
    out.push('');
  }
  for (const c of p.created) {
    out.push(`// ${c.name}`, `db.createCollection(${JSON.stringify(c.name)}, ${jsLiteral(createOptions(c, warnings))});`, ...createIndexes(c, warnings), '');
  }
  for (const c of p.dropped) out.push(`// ${t('migration.dropComment', { name: c.name })}`, `${ref(c.name)}.drop();`, '');
  void from;
  return { files: [{ name: 'migration.mongodb.js', language: 'js' as const, code: `${out.join('\n').trimEnd()}\n` }], warnings };
};

/* Firestore and CouchDB: the same steps in JavaScript, applied to each document. */

const HELPERS = [
  "const get = (o, p) => p.split('.').reduce((v, k) => (v == null ? undefined : v[k]), o);",
  "const set = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); let t = o; for (const k of ks) t = t[k] ??= {}; t[last] = v; };",
  "const unset = (o, p) => { const ks = p.split('.'); const last = ks.pop(); const t = ks.reduce((v, k) => v?.[k], o); if (t && typeof t === 'object') delete t[last]; };",
  'const each = (o, p, fn) => { const list = get(o, p); if (Array.isArray(list)) list.forEach((item) => item && typeof item === \'object\' && fn(item)); };',
];

const jsDefault = (field: Field, engine: 'firestore' | 'couchdb') => {
  const text = field.defaultValue?.trim() ?? '';
  if (text === 'now()') return engine === 'firestore' ? 'Timestamp.now()' : 'new Date().toISOString()';
  if (text === 'uuid()' || text === 'ObjectId()') return 'crypto.randomUUID()';
  return JSON.stringify(parseLiteral(text));
};

const jsConvert = (type: FieldType, engine: 'firestore' | 'couchdb') => {
  if (['int', 'long'].includes(type)) return (v: string) => `Math.trunc(Number(${v}))`;
  if (['double', 'decimal', 'number'].includes(type)) return (v: string) => (engine === 'couchdb' && type === 'decimal' ? `String(${v})` : `Number(${v})`);
  if (['string', 'enum', 'uuid', 'objectId'].includes(type)) return (v: string) => `String(${v})`;
  if (type === 'bool') return (v: string) => `Boolean(${v})`;
  if (type === 'date' || type === 'timestamp') return (v: string) => (engine === 'firestore' ? `Timestamp.fromDate(new Date(${v}?.toDate?.() ?? ${v}))` : `new Date(${v}).toISOString()`);
  return undefined;
};

/** Statements that change one document held in `doc`. */
const jsOps = (diff: CollectionDiff, engine: 'firestore' | 'couchdb', warnings: string[]) => {
  const lines: string[] = [];
  const name = diff.after.name;
  // Runs `body` on the document or on each element of the array the path goes through.
  const at = (path: string, body: (target: string, p: string) => string) => {
    const parts = path.split('[].');
    if (parts.length === 1) return body('doc', toMongoPath(path));
    if (parts.length === 2) return `each(doc, ${JSON.stringify(toMongoPath(parts[0]))}, (item) => { ${body('item', toMongoPath(parts[1]))} });`;
    warnings.push(t('migration.manualNested', { path: toMongoPath(path), collection: name }));
    return '';
  };
  for (const op of diff.ops) {
    let line = '';
    if (op.op === 'rename') {
      const a = op.from.split('[].');
      const b = op.to.split('[].');
      if (a.length === 1 && b.length === 1) line = `if (get(doc, ${JSON.stringify(toMongoPath(op.from))}) !== undefined) { set(doc, ${JSON.stringify(toMongoPath(op.to))}, get(doc, ${JSON.stringify(toMongoPath(op.from))})); unset(doc, ${JSON.stringify(toMongoPath(op.from))}); }`;
      else if (a.length === 2 && b.length === 2 && a[0] === b[0]) line = at(op.from, (x) => `if (get(${x}, ${JSON.stringify(toMongoPath(a[1]))}) !== undefined) { set(${x}, ${JSON.stringify(toMongoPath(b[1]))}, get(${x}, ${JSON.stringify(toMongoPath(a[1]))})); unset(${x}, ${JSON.stringify(toMongoPath(a[1]))}); }`);
      else warnings.push(t('migration.manualRename', { from: toMongoPath(op.from), to: toMongoPath(op.to), collection: name }));
    } else if (op.op === 'default') {
      line = at(op.path, (x, p) => `if (get(${x}, ${JSON.stringify(p)}) === undefined) set(${x}, ${JSON.stringify(p)}, ${jsDefault(op.field, engine)});`);
    } else if (op.op === 'unset') {
      line = at(op.path, (x, p) => `unset(${x}, ${JSON.stringify(p)});`);
    } else {
      const convert = jsConvert(op.field.type, engine);
      if (!convert) warnings.push(t('migration.manualConvert', { path: toMongoPath(op.path), type: op.field.type, collection: name }));
      else line = at(op.path, (x, p) => `if (get(${x}, ${JSON.stringify(p)}) != null) set(${x}, ${JSON.stringify(p)}, ${convert(`get(${x}, ${JSON.stringify(p)})`)});`);
    }
    if (line) lines.push(line);
  }
  return lines;
};

const versionLines = (options: MigrationOptions) => {
  const lines: string[] = [];
  if (options.previousSchemaVersion !== undefined) lines.push(`if ((doc.schemaVersion ?? 0) !== ${options.previousSchemaVersion}) return false;`);
  return lines;
};

const firestoreMigration = (to: Snapshot, p: Plan, options: MigrationOptions, labels: { from: string; to: string }) => {
  const warnings: string[] = [];
  const out = [
    `// ${t('migration.header', { from: labels.from, to: labels.to })}`,
    `// ${t('migration.firestoreRun')}`,
    "import { initializeApp } from 'firebase-admin/app';",
    "import { getFirestore, Timestamp } from 'firebase-admin/firestore';",
    '',
    'initializeApp();',
    'const db = getFirestore();',
    ...HELPERS,
    '',
    `// ${t('migration.firestoreBatches')}`,
    'const migrate = async (source, change) => {',
    '  let last;',
    '  for (;;) {',
    "    let page = source.orderBy('__name__').limit(500);",
    '    if (last) page = page.startAfter(last);',
    '    const snapshot = await page.get();',
    '    if (snapshot.empty) break;',
    '    const batch = db.batch();',
    '    for (const d of snapshot.docs) {',
    '      const doc = d.data();',
    '      if (change(doc)) batch.set(d.ref, doc);',
    '    }',
    '    await batch.commit();',
    '    last = snapshot.docs[snapshot.docs.length - 1];',
    '  }',
    '};',
    '',
  ];
  for (const r of p.renamed) warnings.push(t('migration.firestoreRename', { from: r.from, to: r.to }));
  for (const diff of p.changed) {
    const ops = jsOps(diff, 'firestore', warnings);
    if (!ops.length && !options.bumpSchemaVersion) continue;
    const source = diff.after.kind === 'subcollection' ? `db.collectionGroup(${JSON.stringify(diff.after.name)})` : `db.collection(${JSON.stringify(diff.after.name)})`;
    const body = [...versionLines(options), ...ops, ...(options.bumpSchemaVersion ? ['doc.schemaVersion = (doc.schemaVersion ?? 0) + 1;'] : []), 'return true;'];
    out.push(`// ${diff.after.name}`, `await migrate(${source}, (doc) => {`, ...body.map((l) => `  ${l}`), '});', '');
  }
  for (const c of p.dropped) out.push(`// ${t('migration.dropComment', { name: c.name })}`, `// await db.recursiveDelete(db.collection(${JSON.stringify(c.name)}));`, '');
  const project = to as Project;
  return {
    files: [
      { name: 'migrate-firestore.mjs', language: 'js' as const, code: `${out.join('\n').trimEnd()}\n` },
      { name: 'firestore.rules', language: 'rules' as const, code: firestoreRules(project).code },
      { name: 'firestore.indexes.json', language: 'json' as const, code: firestoreIndexes(project).code },
    ],
    warnings,
  };
};

const couchMigration = (from: Snapshot, to: Snapshot, p: Plan, options: MigrationOptions, labels: { from: string; to: string }) => {
  const warnings: string[] = [];
  const db = databaseName(to as Project);
  const out = [
    `// ${t('migration.header', { from: labels.from, to: labels.to })}`,
    `// ${t('migration.couchRun')}`,
    "const COUCH_URL = process.env.COUCH_URL ?? 'http://localhost:5984';",
    `const DB = process.env.DB ?? ${JSON.stringify(db)};`,
    ...HELPERS,
    '',
    'const changes = {',
  ];
  const typeOf = (c: Collection) => discriminator(c);
  for (const r of p.renamed) {
    const before = from.collections.find((c) => c.id === r.collection.id)!;
    if (typeOf(before).value !== typeOf(r.collection).value) {
      out.push(`  ${JSON.stringify(typeOf(before).value)}: (doc) => {`, `    doc.${typeOf(r.collection).field} = ${JSON.stringify(typeOf(r.collection).value)};`, '    return true;', '  },');
    }
  }
  for (const diff of p.changed) {
    const ops = jsOps(diff, 'couchdb', warnings);
    if (!ops.length && !options.bumpSchemaVersion) continue;
    const body = [...versionLines(options), ...ops, ...(options.bumpSchemaVersion ? ['doc.schemaVersion = (doc.schemaVersion ?? 0) + 1;'] : []), 'return true;'];
    out.push(`  ${JSON.stringify(typeOf(diff.after).value)}: (doc) => {`, ...body.map((l) => `    ${l}`), '  },');
  }
  for (const c of p.dropped) {
    out.push(`  // ${t('migration.dropComment', { name: c.name })}`, `  ${JSON.stringify(typeOf(c).value)}: (doc) => {`, '    doc._deleted = true;', '    return true;', '  },');
  }
  out.push(
    '};',
    '',
    'const all = await (await fetch(`${COUCH_URL}/${DB}/_all_docs?include_docs=true`)).json();',
    'const docs = all.rows',
    "  .map((row) => row.doc)",
    "  .filter((doc) => !doc._id.startsWith('_design/'))",
    // Each document goes through the change of its type; unchanged documents stay out of the request.
    '  .filter((doc) => {',
    '    const before = JSON.stringify(doc);',
    '    const change = changes[doc.type];',
    '    return change ? change(doc) !== false && JSON.stringify(doc) !== before : false;',
    '  });',
    "const response = await fetch(`${COUCH_URL}/${DB}/_bulk_docs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docs }) });",
    'console.log(response.status, await response.json());',
  );
  const project = to as Project;
  return {
    files: [
      { name: 'migrate-couchdb.mjs', language: 'js' as const, code: `${out.join('\n')}\n` },
      { name: 'design-docs.json', language: 'json' as const, code: couchDesignOutput(project).code },
    ],
    warnings,
  };
};

export const diffModels = (from: Snapshot, to: Snapshot, options: MigrationOptions = {}, labels = { from: 'A', to: 'B' }): Migration => {
  const p = plan(from, to);
  const result =
    to.engine === 'mongodb' ? mongoMigration(from, to, p, options, labels) : to.engine === 'firestore' ? firestoreMigration(to, p, options, labels) : couchMigration(from, to, p, options, labels);
  const warnings = [...result.warnings];
  if (from.engine !== to.engine) warnings.unshift(t('migration.engineMismatch', { from: ENGINES[from.engine].name, to: ENGINES[to.engine].name }));
  return { files: result.files, changes: p.changes, warnings: [...new Set(warnings)] };
};

/** Every path of a collection, for tests and for the change list. */
export const fieldPaths = (collection: Collection) => walkFields(collection.fields).map((e) => toMongoPath(e.path));
