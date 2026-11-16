import { t } from '../../i18n';
import type { Project } from '../types';
import { validatorOf } from './json-schema';
import { createIndexes } from './mongodb-script';
import { jsLiteral, type OutputResult } from './shared';

export type CreateScriptOptions = {
  /** Adds db.dropDatabase() first, to build the database from scratch. */
  dropFirst?: boolean;
};

/**
 * mongosh script that creates the database and its collections with their validators. It can run
 * again: a collection that already exists gets the validator through collMod. Indexes come after.
 */
export const mongoCreateScript = (project: Project, options: CreateScriptOptions = {}): OutputResult => {
  const warnings: string[] = [];
  const database = project.databaseName?.trim();
  if (!database) warnings.push(t('create.noDatabase'));
  const collections: Record<string, unknown> = {};
  const creation: Record<string, unknown> = {};
  for (const c of project.collections) {
    const { validationLevel = 'strict', validationAction = 'error', timeseries, capped, ttl } = c.options;
    if (timeseries?.timeField) {
      // Time series collections take no validator.
      warnings.push(t('output.timeseriesValidator', { name: c.name }));
      collections[c.name] = {};
      creation[c.name] = { timeseries: { timeField: timeseries.timeField, metaField: timeseries.metaField || undefined, granularity: timeseries.granularity || undefined }, ...(ttl ? { expireAfterSeconds: ttl.seconds } : {}) };
      continue;
    }
    collections[c.name] = { validator: validatorOf(c), validationLevel, validationAction };
    if (capped) creation[c.name] = { capped: true, size: capped.size, ...(capped.max ? { max: capped.max } : {}) };
  }
  const lines = [`// ${t('create.header')}`, `use(${JSON.stringify(database || 'app')});`, ''];
  if (options.dropFirst) lines.push(`// ${t('create.dropWarning')}`, 'db.dropDatabase();', '');
  lines.push(
    'const existing = db.getCollectionNames();',
    `const collections = ${jsLiteral(collections)};`,
  );
  if (Object.keys(creation).length) lines.push(`// ${t('create.creationOnly')}`, `const creation = ${jsLiteral(creation)};`);
  lines.push(
    '',
    'for (const [name, rules] of Object.entries(collections)) {',
    '  if (existing.includes(name)) db.runCommand({ collMod: name, ...rules });',
    `  else db.createCollection(name, { ...rules${Object.keys(creation).length ? ', ...creation[name]' : ''} });`,
    '}',
  );
  const indexes = project.collections.flatMap((c) => createIndexes(c, warnings));
  if (indexes.length) lines.push('', `// ${t('create.indexes')}`, ...indexes);
  return { code: `${lines.join('\n')}\n`, warnings };
};

/** Command that runs the script file with mongosh. */
export const mongoshCommand = (file: string, uri = 'mongodb://localhost:27017') => `mongosh "${uri}" --file ${file}`;
