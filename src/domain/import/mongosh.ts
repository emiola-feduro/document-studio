import { t } from '../../i18n';
import { collectionFromValidator, validatorParts } from '../infer';
import { uid } from '../model';
import type { Collection, DocIndex, EngineId, IndexOrder } from '../types';
import { balancedArgs, JsParser, literal, parseArgs, type JsValue } from './js-literal';
import { relationshipsFromFields } from './references';
import type { SchemaImport } from './types';

/**
 * Collections from a mongosh script, read without running it: db.createCollection(name, options)
 * and db.runCommand({ collMod }) with their validator ($jsonSchema, and $expr kept next to it),
 * validationLevel, validationAction, capped and timeseries; createIndex calls; use() or
 * getSiblingDB() for the database name; and the `const collections = {...}` loop that the app's own
 * creation script writes. Anything else is listed as not imported.
 */

export type MongoshImport = SchemaImport & { databaseName?: string };

type Spec = { name: string; options: Record<string, unknown> };

const plain = (v: JsValue | undefined) => literal(v) as Record<string, unknown> | undefined;

const ORDERS = new Set(['text', '2dsphere', 'hashed']);

export const readMongosh = (text: string, engine: EngineId): MongoshImport => {
  const skipped: string[] = [];
  const warnings: string[] = [];
  const specs: Spec[] = [];
  const indexCalls: { collection: string; keys: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  const databaseName = /\buse\(\s*["']([^"']+)["']\s*\)/.exec(text)?.[1] ?? /getSiblingDB\(\s*["']([^"']+)["']\s*\)/.exec(text)?.[1];

  const calls = (pattern: RegExp, handle: (m: RegExpMatchArray, args: JsValue[]) => void) => {
    for (const m of text.matchAll(pattern)) {
      const open = (m.index ?? 0) + m[0].length - 1;
      const inside = balancedArgs(text, open);
      if (inside === undefined) continue;
      try {
        handle(m, parseArgs(inside));
      } catch {
        skipped.push(m[0].replace(/\($/, '(...)'));
      }
    }
  };

  calls(/\bdb\.createCollection\s*\(/g, (_m, [name, options]) => {
    if (name?.kind === 'string') specs.push({ name: name.value, options: plain(options) ?? {} });
  });
  calls(/\bdb\.runCommand\s*\(/g, (_m, [command]) => {
    // Only a written name: the loop of the creation script passes a variable.
    const target = command?.kind === 'object' ? command.entries.find(([k]) => k === 'collMod')?.[1] : undefined;
    if (target?.kind === 'string') specs.push({ name: target.value, options: plain(command) ?? {} });
    else if (target?.kind !== 'ident') skipped.push('db.runCommand(...)');
  });
  calls(/\bdb\.(?:([A-Za-z_$][\w$]*)|getCollection\(\s*["']([^"']+)["']\s*\))\.createIndex\s*\(/g, (m, [keys, options]) => {
    const k = plain(keys);
    if (k) indexCalls.push({ collection: m[1] ?? m[2], keys: k, options: plain(options) ?? {} });
  });

  // The app's own creation script: const collections = { name: { validator, ... } } and a loop.
  const loop = /\bconst\s+collections\s*=\s*\{/.exec(text);
  if (loop) {
    const parser = new JsParser(text.slice(loop.index + loop[0].length - 1));
    const all = plain(parser.value());
    const creation = /\bconst\s+creation\s*=\s*\{/.exec(text);
    const extra = creation ? plain(new JsParser(text.slice(creation.index + creation[0].length - 1)).value()) : undefined;
    for (const [name, rules] of Object.entries(all ?? {})) specs.push({ name, options: { ...(rules as object), ...((extra?.[name] as object) ?? {}) } });
  }
  if (!specs.length) throw new Error(t('import.noMongosh'));

  const byName = new Map<string, Collection>();
  specs.forEach(({ name, options }, i) => {
    const parts = validatorParts(options.validator ?? {});
    const collection = byName.get(name) ?? (parts ? collectionFromValidator(name, parts, engine, i) : collectionFromValidator(name, { schema: {}, extra: [] }, engine, i));
    if (!parts && !byName.has(name)) warnings.push(t('import.noValidator', { name }));
    const o = collection.options;
    if (options.validationLevel === 'strict' || options.validationLevel === 'moderate' || options.validationLevel === 'off') o.validationLevel = options.validationLevel;
    if (options.validationAction === 'error' || options.validationAction === 'warn') o.validationAction = options.validationAction;
    if (options.capped === true && typeof options.size === 'number') o.capped = { size: options.size, ...(typeof options.max === 'number' ? { max: options.max } : {}) };
    const ts = options.timeseries as Record<string, unknown> | undefined;
    if (ts && typeof ts.timeField === 'string') o.timeseries = { timeField: ts.timeField, ...(typeof ts.metaField === 'string' ? { metaField: ts.metaField } : {}), ...(typeof ts.granularity === 'string' ? { granularity: ts.granularity } : {}) };
    byName.set(name, collection);
  });

  for (const call of indexCalls) {
    const collection = byName.get(call.collection);
    if (!collection) {
      skipped.push(t('import.indexWithoutCollection', { collection: call.collection }));
      continue;
    }
    const keys = Object.entries(call.keys).map(([path, order]) => ({ path, order: (order === -1 ? -1 : typeof order === 'string' && ORDERS.has(order) ? order : 1) as IndexOrder }));
    const opts = call.options;
    if (typeof opts.expireAfterSeconds === 'number' && keys.length === 1) collection.options.ttl = { field: keys[0].path, seconds: opts.expireAfterSeconds };
    const index: DocIndex = { id: uid(), name: typeof opts.name === 'string' ? opts.name : '', nameIsCustom: typeof opts.name === 'string', keys };
    if (opts.unique === true) index.unique = true;
    if (opts.sparse === true) index.sparse = true;
    if (opts.partialFilterExpression) index.partialFilter = JSON.stringify(opts.partialFilterExpression);
    const collation = opts.collation as { locale?: string } | undefined;
    if (collation?.locale) index.collation = collation.locale;
    collection.indexes.push(index);
  }

  // Statements that are neither collections nor indexes, for the list of what was left out.
  for (const m of text.matchAll(/\bdb\.(?:[A-Za-z_$][\w$]*\.)?(insertMany|insertOne|updateMany|updateOne|deleteMany|drop|dropDatabase|createUser|createView)\s*\(/g)) skipped.push(`${m[1]}(...)`);

  const collections = [...byName.values()];
  return { collections, relationships: relationshipsFromFields(collections), documents: {}, stats: {}, warnings, skipped: [...new Set(skipped)], ...(databaseName ? { databaseName } : {}) };
};
