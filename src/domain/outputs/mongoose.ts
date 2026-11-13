import { indexName, mongoKeys } from '../indexes';
import { isIdentifier, pascalCase, singular } from '../naming';
import type { Collection, Field, Project } from '../types';
import { jsLiteral, parseLiteral, RawJs, type OutputResult } from './shared';

const key = (name: string) => (isIdentifier(name) ? name : JSON.stringify(name));

const modelName = (collection: Collection) => pascalCase(singular(collection.name));

type Ctx = { project: Project; subschemas: string[]; used: Set<string> };

const scalar: Partial<Record<Field['type'], string>> = {
  string: 'String',
  enum: 'String',
  int: 'Number',
  long: 'Number',
  double: 'Number',
  number: 'Number',
  decimal: 'Schema.Types.Decimal128',
  bool: 'Boolean',
  date: 'Date',
  timestamp: 'Date',
  objectId: 'Schema.Types.ObjectId',
  reference: 'Schema.Types.ObjectId',
  uuid: 'Schema.Types.UUID',
  binary: 'Buffer',
  any: 'Schema.Types.Mixed',
  null: 'Schema.Types.Mixed',
};

const subschema = (ctx: Ctx, name: string, fields: Field[]) => {
  let id = `${name}Schema`;
  let i = 2;
  while (ctx.used.has(id)) id = `${name}${i++}Schema`;
  ctx.used.add(id);
  ctx.subschemas.push(`const ${id} = new Schema(${jsLiteral(definition(ctx, fields))}, { _id: false });`);
  return id;
};

const typeOf = (ctx: Ctx, field: Field, hint: string): unknown => {
  if (field.type === 'object') return new RawJs(subschema(ctx, hint, field.children ?? []));
  if (field.type === 'array') return [field.items ? pathOptions(ctx, field.items, hint) : new RawJs('Schema.Types.Mixed')];
  if (field.type === 'geoPoint') {
    return new RawJs(
      subschema(ctx, 'point', [
        { id: 't', name: 'type', type: 'enum', enumValues: ['Point'], required: true, nullable: false, defaultValue: '"Point"' },
        { id: 'c', name: 'coordinates', type: 'array', required: true, nullable: false, items: { id: 'i', name: '', type: 'double', required: true, nullable: false } },
      ]),
    );
  }
  return new RawJs(scalar[field.type] ?? 'Schema.Types.Mixed');
};

const pathOptions = (ctx: Ctx, field: Field, hint: string): unknown => {
  const type = typeOf(ctx, field, hint);
  const options: Record<string, unknown> = { type };
  if (field.required) options.required = true;
  const target = field.reference && ctx.project.collections.find((c) => c.id === field.reference!.collectionId);
  if (target) options.ref = modelName(target);
  if (field.type === 'enum' && field.enumValues?.length) options.enum = field.enumValues;
  if (field.minLength !== undefined) options.minlength = field.minLength;
  if (field.maxLength !== undefined) options.maxlength = field.maxLength;
  if (field.pattern) options.match = new RawJs(`/${field.pattern.replace(/\//g, '\\/')}/`);
  if (field.minimum !== undefined) options.min = field.minimum;
  if (field.maximum !== undefined) options.max = field.maximum;
  const def = parseLiteral(field.defaultValue);
  if (def !== undefined) options.default = typeof def === 'string' && /^(Date\.now|now)\(?\)?$/i.test(def) ? new RawJs('Date.now') : def;
  if (field.type === 'array' && field.maxItems !== undefined) {
    options.validate = new RawJs(`{ validator: (v: unknown[]) => v.length <= ${field.maxItems}, message: 'max ${field.maxItems}' }`);
  }
  // A bare type reads better when nothing else is set.
  return Object.keys(options).length === 1 ? type : options;
};

const definition = (ctx: Ctx, fields: Field[]) =>
  Object.fromEntries(fields.filter((f) => f.name && f.name !== '_id' && f.name !== '__v').map((f) => [key(f.name), pathOptions(ctx, f, f.name)]));

/** Mongoose models in TypeScript: one schema per collection, sub schemas for embedded objects, refs and indexes. */
export const mongooseOutput = (project: Project): OutputResult => {
  const blocks: string[] = [];
  for (const collection of project.collections) {
    const ctx: Ctx = { project, subschemas: [], used: new Set() };
    const name = modelName(collection);
    const fields = definition(ctx, collection.fields);
    const hasTimestamps = ['createdAt', 'updatedAt'].every((n) => collection.fields.some((f) => f.name === n));
    const schemaOptions: Record<string, unknown> = { collection: collection.name };
    if (hasTimestamps) schemaOptions.timestamps = true;
    if (collection.options.additionalProperties === false) schemaOptions.strict = 'throw';
    const lines = [
      `// ${collection.name}`,
      ...ctx.subschemas,
      `export const ${name[0].toLowerCase()}${name.slice(1)}Schema = new Schema(${jsLiteral(fields)}, ${jsLiteral(schemaOptions)});`,
    ];
    for (const index of collection.indexes) {
      const options: Record<string, unknown> = { name: indexName(index) };
      if (index.unique) options.unique = true;
      if (index.sparse) options.sparse = true;
      const filter = parseLiteral(index.partialFilter);
      if (filter && typeof filter === 'object') options.partialFilterExpression = filter;
      lines.push(`${name[0].toLowerCase()}${name.slice(1)}Schema.index(${jsLiteral(mongoKeys(index))}, ${jsLiteral(options)});`);
    }
    if (collection.options.ttl && !collection.options.timeseries) {
      lines.push(`${name[0].toLowerCase()}${name.slice(1)}Schema.index(${jsLiteral({ [collection.options.ttl.field]: 1 })}, { expireAfterSeconds: ${collection.options.ttl.seconds} });`);
    }
    lines.push(`export const ${name} = model(${JSON.stringify(name)}, ${name[0].toLowerCase()}${name.slice(1)}Schema);`);
    blocks.push(lines.join('\n'));
  }
  return { code: `import { Schema, model } from 'mongoose';\n\n${blocks.join('\n\n')}\n`, warnings: [] };
};
