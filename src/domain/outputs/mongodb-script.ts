import { t } from '../../i18n';
import { indexName, mongoKeys } from '../indexes';
import { isIdentifier } from '../naming';
import { toMongoPath } from '../paths';
import type { Collection, DocIndex, Project } from '../types';
import { validatorOf } from './json-schema';
import { databaseName, jsLiteral, parseLiteral, type OutputResult } from './shared';

export type MongoScriptOptions = {
  /** Updates the validator of collections that already exist instead of creating them. */
  collMod?: boolean;
};

export const ref = (name: string) => (isIdentifier(name) ? `db.${name}` : `db.getCollection(${JSON.stringify(name)})`);

export const indexOptions = (collection: Collection, index: DocIndex, warnings: string[]) => {
  const options: Record<string, unknown> = { name: indexName(index) };
  if (index.unique) options.unique = true;
  if (index.sparse) options.sparse = true;
  if (index.partialFilter?.trim()) {
    const filter = parseLiteral(index.partialFilter);
    if (filter && typeof filter === 'object') options.partialFilterExpression = filter;
    else warnings.push(t('output.badFilter', { name: indexName(index), collection: collection.name }));
  }
  if (index.collation?.trim()) options.collation = { locale: index.collation.trim() };
  return options;
};

export const createIndexes = (collection: Collection, warnings: string[]) => {
  const lines: string[] = [];
  const { ttl, timeseries } = collection.options;
  for (const index of collection.indexes) {
    if (!index.keys.some((k) => k.path) && !index.wildcard) continue;
    const options = indexOptions(collection, index, warnings);
    // A TTL on an indexed date field becomes expireAfterSeconds on that index.
    if (ttl && !timeseries && index.keys.length === 1 && toMongoPath(index.keys[0].path) === toMongoPath(ttl.field)) options.expireAfterSeconds = ttl.seconds;
    lines.push(`${ref(collection.name)}.createIndex(${jsLiteral(mongoKeys(index))}, ${jsLiteral(options)});`);
  }
  if (ttl?.field && !timeseries && !collection.indexes.some((i) => i.keys.length === 1 && toMongoPath(i.keys[0].path) === toMongoPath(ttl.field))) {
    lines.push(`${ref(collection.name)}.createIndex(${jsLiteral({ [toMongoPath(ttl.field)]: 1 })}, ${jsLiteral({ name: `${toMongoPath(ttl.field)}_ttl`, expireAfterSeconds: ttl.seconds })});`);
  }
  return lines;
};

export const createOptions = (collection: Collection, warnings: string[]) => {
  const { validationLevel, validationAction, capped, timeseries, ttl } = collection.options;
  const options: Record<string, unknown> = {};
  if (timeseries?.timeField) {
    options.timeseries = { timeField: timeseries.timeField, metaField: timeseries.metaField || undefined, granularity: timeseries.granularity || undefined };
    if (ttl) options.expireAfterSeconds = ttl.seconds;
  }
  // Time series collections take no validator.
  if (timeseries?.timeField) warnings.push(t('output.timeseriesValidator', { name: collection.name }));
  else {
    options.validator = validatorOf(collection);
    if (validationLevel) options.validationLevel = validationLevel;
    if (validationAction) options.validationAction = validationAction;
  }
  if (capped && !timeseries) {
    options.capped = true;
    options.size = capped.size;
    if (capped.max) options.max = capped.max;
  }
  return options;
};

/** mongosh script that creates every collection with its validator, then its indexes. */
export const mongoScript = (project: Project, options: MongoScriptOptions = {}): OutputResult => {
  const warnings: string[] = [];
  const out = [`// ${project.name}`, `use(${JSON.stringify(databaseName(project))});`, ''];
  for (const collection of project.collections) {
    out.push(`// ${collection.name}`);
    if (options.collMod) {
      const { validationLevel, validationAction } = collection.options;
      out.push(
        `db.runCommand(${jsLiteral({ collMod: collection.name, validator: validatorOf(collection), validationLevel, validationAction })});`,
      );
    } else {
      out.push(`db.createCollection(${JSON.stringify(collection.name)}, ${jsLiteral(createOptions(collection, warnings))});`);
    }
    out.push(...createIndexes(collection, warnings), '');
  }
  return { code: `${out.join('\n').trimEnd()}\n`, warnings };
};
