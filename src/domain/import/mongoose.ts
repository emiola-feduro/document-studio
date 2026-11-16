import { t } from '../../i18n';
import { ID_KEY } from '../engines';
import { createCollection, createField, uid } from '../model';
import type { Collection, DocIndex, EngineId, Field, FieldType } from '../types';
import { balancedArgs, entry, literal, parseArgs, type JsValue } from './js-literal';
import { relationshipsFromFields } from './references';
import type { SchemaImport } from './types';

/**
 * Collections from Mongoose models: `new Schema({...})` definitions with their types and options
 * (required, enum, default, min, max, minlength, maxlength, match, ref, unique, index), subschemas
 * as embedded objects, `schema.index(...)` calls, `timestamps`, and `model('Name', schema)` to name
 * the collections. Hooks, methods, virtuals and validators written as functions are listed as skipped.
 */

const TYPES: Record<string, FieldType> = {
  string: 'string',
  number: 'double',
  date: 'date',
  boolean: 'bool',
  buffer: 'binary',
  objectid: 'objectId',
  decimal128: 'decimal',
  mixed: 'any',
  uuid: 'uuid',
  bigint: 'long',
  int32: 'int',
  double: 'double',
  map: 'object',
};

/** Collection name Mongoose gives a model when none is set: lower case and plural, in English. */
export const mongoosePlural = (model: string) => {
  const name = model.toLowerCase();
  if (/[^aeiou]y$/.test(name)) return `${name.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/.test(name)) return `${name}es`;
  return `${name}s`;
};

type Context = {
  schemas: Map<string, JsValue>;
  /** Fields whose reference points at a model name, resolved once every model is known. */
  refs: { field: Field; model: string }[];
  indexes: DocIndex[];
  skipped: string[];
  where: string;
};

const typeName = (v: JsValue | undefined): string | undefined => {
  if (!v) return undefined;
  if (v.kind === 'ident') return v.name.split('.').pop();
  if (v.kind === 'string') return v.value;
  return undefined;
};

const isOptions = (v: JsValue) => v.kind === 'object' && v.entries.some(([k, x]) => k === 'type' && (x.kind !== 'object' || !x.entries.some(([kk]) => kk === 'type')));

const subschemaDefinition = (v: JsValue, ctx: Context): JsValue | undefined => {
  if (v.kind === 'ident' && ctx.schemas.has(v.name)) return ctx.schemas.get(v.name);
  if (v.kind === 'call' && /(^|\.)Schema$/.test(v.callee)) return v.args[0];
  return undefined;
};

const convert = (name: string, v: JsValue, ctx: Context, path: string): Field => {
  const sub = subschemaDefinition(v, ctx);
  if (sub) return createField({ name, type: 'object', children: fieldsOf(sub, ctx, path) });
  if (v.kind === 'array') {
    const item = v.items[0];
    const field = createField({ name, type: 'array' });
    field.items = item ? { ...convert('', item, ctx, `${path}[]`), name: '', required: true } : createField({ name: '', type: 'any' });
    return field;
  }
  if (v.kind === 'object') {
    if (isOptions(v)) return withOptions(name, v, ctx, path);
    if (v.entries.length === 0) return createField({ name, type: 'any' });
    return createField({ name, type: 'object', children: fieldsOf(v, ctx, path) });
  }
  const type = TYPES[(typeName(v) ?? '').toLowerCase()];
  if (!type) ctx.skipped.push(t('import.unknownType', { path, type: typeName(v) ?? v.kind }));
  return createField({ name, type: type ?? 'any' });
};

const withOptions = (name: string, v: JsValue, ctx: Context, path: string): Field => {
  const field = convert(name, entry(v, 'type')!, ctx, path);
  const scalar = field.type === 'array' && field.items ? field.items : field;
  for (const [key, value] of (v as Extract<JsValue, { kind: 'object' }>).entries) {
    const raw = literal(value);
    switch (key) {
      case 'type':
        break;
      case 'required':
        if (value.kind === 'code') ctx.skipped.push(t('import.conditionalRequired', { path }));
        field.required = Array.isArray(raw) ? Boolean(raw[0]) : value.kind === 'code' ? false : Boolean(raw);
        break;
      case 'enum': {
        const values = Array.isArray(raw) ? raw : (raw as { values?: unknown[] })?.values;
        if (Array.isArray(values) && scalar.type === 'string') {
          scalar.type = 'enum';
          scalar.enumValues = values.map(String);
        }
        break;
      }
      case 'default':
        if (value.kind === 'ident' && /Date\.now$/.test(value.name)) field.defaultValue = 'now()';
        else if (value.kind === 'code') ctx.skipped.push(t('import.computedDefault', { path }));
        else if (raw !== undefined) field.defaultValue = JSON.stringify(raw);
        break;
      case 'min':
      case 'max':
        if (typeof raw === 'number') scalar[key === 'min' ? 'minimum' : 'maximum'] = raw;
        break;
      case 'minlength':
      case 'minLength':
        if (typeof raw === 'number') scalar.minLength = raw;
        break;
      case 'maxlength':
      case 'maxLength':
        if (typeof raw === 'number') scalar.maxLength = raw;
        break;
      case 'match':
        if (value.kind === 'regex' || value.kind === 'string') scalar.pattern = String(raw);
        else if (Array.isArray(raw) && typeof raw[0] === 'string') scalar.pattern = raw[0];
        break;
      case 'ref':
        if (typeof raw === 'string') ctx.refs.push({ field: scalar, model: raw });
        break;
      case 'unique':
      case 'index':
        if (raw) ctx.indexes.push({ id: uid(), name: '', nameIsCustom: false, keys: [{ path, order: 1 }], ...(key === 'unique' ? { unique: true } : {}) });
        break;
      case 'description':
        if (typeof raw === 'string') field.description = raw;
        break;
      case 'trim':
      case 'lowercase':
      case 'uppercase':
      case 'immutable':
      case 'select':
      case 'sparse':
      case '_id':
        break;
      default:
        ctx.skipped.push(t('import.option', { option: key, path }));
    }
  }
  return field;
};

const fieldsOf = (definition: JsValue, ctx: Context, prefix = ''): Field[] => {
  if (definition.kind !== 'object') return [];
  return definition.entries.flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (key === '...' || value.kind === 'code') {
      ctx.skipped.push(t('import.code', { path }));
      return [];
    }
    return [convert(key, value, ctx, path)];
  });
};

const schemaOptions = (v: JsValue | undefined) => {
  const timestamps = entry(v, 'timestamps');
  if (!timestamps) return [];
  if (timestamps.kind === 'bool') return timestamps.value ? ['createdAt', 'updatedAt'] : [];
  if (timestamps.kind === 'object') {
    const named = (key: string) => {
      const x = entry(timestamps, key);
      return x?.kind === 'string' ? x.value : x?.kind === 'bool' && !x.value ? undefined : key;
    };
    return [named('createdAt'), named('updatedAt')].filter((x): x is string => Boolean(x));
  }
  return [];
};

const callsOf = (text: string, pattern: RegExp) => {
  const out: { match: RegExpExecArray; args: string }[] = [];
  for (const match of text.matchAll(pattern)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    const args = balancedArgs(text, open);
    if (args !== undefined) out.push({ match: match as RegExpExecArray, args });
  }
  return out;
};

export const readMongoose = (text: string, engine: EngineId): SchemaImport => {
  const skipped: string[] = [];
  const warnings: string[] = [];
  const definitions = new Map<string, { definition: JsValue; options?: JsValue }>();
  for (const { match, args } of callsOf(text, /(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*new\s+(?:mongoose\.)?Schema\s*(?:<[^>]*>)?\(/g)) {
    const [definition, options] = parseArgs(args);
    if (definition) definitions.set(match[1], { definition, options });
  }
  const ctxBase = { schemas: new Map([...definitions].map(([k, v]) => [k, v.definition])) };

  // Models name the collections; a schema used by no model is only a subschema.
  const models: { model: string; schema: string | JsValue; collection?: string }[] = [];
  for (const { args } of callsOf(text, /(?:mongoose\.)?model\s*(?:<[^>]*>)?\(/g)) {
    const [name, schema, coll] = parseArgs(args);
    if (name?.kind !== 'string' || !schema) continue;
    models.push({ model: name.value, schema: schema.kind === 'ident' ? schema.name : schema, collection: coll?.kind === 'string' ? coll.value : undefined });
  }
  if (models.length === 0) {
    const used = new Set<string>();
    for (const { definition } of definitions.values()) {
      const walk = (v: JsValue) => {
        if (v.kind === 'ident') used.add(v.name);
        if (v.kind === 'object') v.entries.forEach(([, x]) => walk(x));
        if (v.kind === 'array') v.items.forEach(walk);
      };
      walk(definition);
    }
    for (const name of definitions.keys()) {
      if (used.has(name)) continue;
      const base = name.replace(/Schema$/i, '') || name;
      models.push({ model: base[0].toUpperCase() + base.slice(1), schema: name });
    }
  }

  const collections: Collection[] = [];
  const byModel = new Map<string, Collection>();
  const refs: Context['refs'] = [];
  models.forEach(({ model, schema, collection: explicit }, i) => {
    const source = typeof schema === 'string' ? definitions.get(schema) : schema.kind === 'call' ? { definition: schema.args[0], options: schema.args[1] } : undefined;
    if (!source?.definition) {
      warnings.push(t('import.noSchemaFor', { model }));
      return;
    }
    const ctx: Context = { ...ctxBase, refs, indexes: [], skipped, where: model };
    const collection = createCollection(engine, explicit ?? mongoosePlural(model), { x: i * 340, y: 0 });
    const fields = fieldsOf(source.definition, ctx);
    const id = fields.find((f) => f.name === ID_KEY);
    collection.fields = [...collection.fields.map((f) => (f.name === ID_KEY && id ? { ...id, required: true } : f)), ...fields.filter((f) => f.name !== ID_KEY)];
    for (const name of schemaOptions(source.options)) {
      if (!collection.fields.some((f) => f.name === name)) collection.fields.push(createField({ name, type: 'date', required: true }));
    }
    collection.indexes.push(...ctx.indexes);
    // schema.index({ a: 1, b: -1 }, { unique: true })
    if (typeof schema === 'string') {
      for (const { args } of callsOf(text, new RegExp(`\\b${schema}\\.index\\s*\\(`, 'g'))) {
        const [keys, options] = parseArgs(args);
        if (keys?.kind !== 'object') continue;
        const opts = (literal(options) ?? {}) as Record<string, unknown>;
        collection.indexes.push({
          id: uid(),
          name: typeof opts.name === 'string' ? opts.name : '',
          nameIsCustom: typeof opts.name === 'string',
          keys: keys.entries.map(([path, order]) => {
            const o = literal(order);
            return { path, order: o === -1 ? -1 : o === 'text' || o === '2dsphere' || o === 'hashed' ? o : 1 };
          }),
          ...(opts.unique ? { unique: true } : {}),
          ...(opts.sparse ? { sparse: true } : {}),
          ...(opts.partialFilterExpression ? { partialFilter: JSON.stringify(opts.partialFilterExpression) } : {}),
        });
      }
      for (const m of text.matchAll(new RegExp(`\\b${schema}\\.(virtual|pre|post|method|methods|statics|static|plugin|set|discriminator)\\b`, 'g'))) {
        skipped.push(t('import.schemaCode', { what: m[1], model }));
      }
    }
    byModel.set(model, collection);
    collections.push(collection);
  });

  for (const { field, model } of refs) {
    const target = byModel.get(model);
    if (target) field.reference = { collectionId: target.id, fieldPath: ID_KEY };
    else warnings.push(t('import.unknownModel', { model }));
  }
  if (definitions.size === 0) throw new Error(t('import.noMongoose'));
  return { collections, relationships: relationshipsFromFields(collections), documents: {}, stats: {}, warnings, skipped: [...new Set(skipped)] };
};
