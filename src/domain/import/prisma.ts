import { t } from '../../i18n';
import { ID_KEY } from '../engines';
import { createCollection, createField, uid } from '../model';
import type { Collection, DocIndex, EngineId, Field, FieldType } from '../types';
import { relationshipsFromFields } from './references';
import type { SchemaImport } from './types';

/**
 * Collections from a Prisma schema for MongoDB: `model` blocks become collections (named by
 * `@@map` or the model), composite `type` blocks become embedded objects, `enum` blocks give
 * enum values, `@relation(fields: [...])` turns the scalar fields into references, and `@unique`,
 * `@@unique` and `@@index` become indexes.
 */

const SCALARS: Record<string, FieldType> = {
  String: 'string',
  Int: 'int',
  BigInt: 'long',
  Float: 'double',
  Decimal: 'decimal',
  Boolean: 'bool',
  DateTime: 'date',
  Json: 'any',
  Bytes: 'binary',
};

type Block = { kind: 'model' | 'type' | 'enum' | 'view'; name: string; body: string };
type Line = { name: string; type: string; list: boolean; optional: boolean; attrs: string };

const blocks = (text: string): Block[] =>
  [...text.matchAll(/^\s*(model|type|enum|view)\s+(\w+)\s*\{([\s\S]*?)^\s*\}/gm)].map((m) => ({ kind: m[1] as Block['kind'], name: m[2], body: m[3] }));

const clean = (line: string) => line.replace(/\/\/.*$/, '').trim();

const fieldLines = (body: string): Line[] =>
  body
    .split('\n')
    .map(clean)
    .filter((l) => l && !l.startsWith('@@'))
    .flatMap((l) => {
      const m = /^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/.exec(l);
      return m ? [{ name: m[1], type: m[2], list: Boolean(m[3]), optional: Boolean(m[4]), attrs: m[5] }] : [];
    });

const attr = (attrs: string, name: string) => {
  const i = attrs.search(new RegExp(`@${name.replace('.', '\\.')}(?![\\w.])`));
  if (i < 0) return undefined;
  const rest = attrs.slice(i + name.length + 1);
  if (!rest.startsWith('(')) return '';
  let depth = 0;
  for (let j = 0; j < rest.length; j += 1) {
    if (rest[j] === '(') depth += 1;
    else if (rest[j] === ')') {
      depth -= 1;
      if (depth === 0) return rest.slice(1, j);
    }
  }
  return rest.slice(1);
};

const listArg = (args: string, key?: string) => {
  const source = key ? new RegExp(`${key}\\s*:\\s*\\[([^\\]]*)\\]`).exec(args)?.[1] : /^\s*\[([^\]]*)\]/.exec(args)?.[1];
  return (source ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

/** Splits a list on the commas that are not inside parentheses: `a(sort: Desc), b`. */
const splitTop = (text: string) => {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
    } else current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
};

const unquote = (s: string | undefined) => (s ? s.trim().replace(/^"(.*)"$/, '$1') : s);

export const readPrisma = (text: string, engine: EngineId): SchemaImport => {
  const all = blocks(text);
  if (!all.some((b) => b.kind === 'model')) throw new Error(t('import.noPrisma'));
  const warnings: string[] = [];
  const skipped: string[] = [];
  const provider = /datasource\s+\w+\s*\{[^}]*provider\s*=\s*"(\w+)"/.exec(text)?.[1];
  if (provider && provider !== 'mongodb') warnings.push(t('import.prismaProvider', { provider }));
  const enums = new Map(all.filter((b) => b.kind === 'enum').map((b) => [b.name, b.body.split('\n').map(clean).filter((l) => l && !l.startsWith('@@')).map((l) => l.split(/\s/)[0])]));
  const types = new Map(all.filter((b) => b.kind === 'type').map((b) => [b.name, b]));
  const models = all.filter((b) => b.kind === 'model');
  for (const view of all.filter((b) => b.kind === 'view')) skipped.push(t('import.prismaView', { name: view.name }));
  const modelNames = new Set(models.map((m) => m.name));

  const toField = (line: Line, where: string, depth = 0): Field | undefined => {
    if (modelNames.has(line.type)) return undefined;
    const name = unquote(attr(line.attrs, 'map')) || line.name;
    let field: Field;
    if (SCALARS[line.type]) {
      const objectId = attr(line.attrs, 'db.ObjectId') !== undefined;
      field = createField({ name: '', type: objectId ? 'objectId' : SCALARS[line.type] });
    } else if (enums.has(line.type)) {
      field = createField({ name: '', type: 'enum', enumValues: enums.get(line.type) });
    } else if (types.has(line.type) && depth < 10) {
      field = createField({ name: '', type: 'object', children: fieldLines(types.get(line.type)!.body).flatMap((l) => toField(l, `${where}.${name}`, depth + 1) ?? []) });
    } else {
      skipped.push(t('import.unknownType', { path: `${where}.${name}`, type: line.type }));
      field = createField({ name: '', type: 'any' });
    }
    const def = attr(line.attrs, 'default');
    if (def !== undefined && def !== 'auto()') {
      if (def === 'now()') field.defaultValue = 'now()';
      else if (def === 'uuid()' || def === 'cuid()') field.defaultValue = 'uuid()';
      else if (/^(true|false|-?\d+(\.\d+)?|"[^"]*")$/.test(def)) field.defaultValue = def;
      else if (enums.get(line.type)?.includes(def)) field.defaultValue = JSON.stringify(def);
    }
    if (attr(line.attrs, 'updatedAt') !== undefined) skipped.push(t('import.prismaUpdatedAt', { path: `${where}.${name}` }));
    if (line.list) {
      const items = { ...field, name: '', required: true };
      return createField({ name, type: 'array', required: true, items });
    }
    return { ...field, name, required: !line.optional, nullable: line.optional };
  };

  const collections: Collection[] = [];
  const byModel = new Map<string, Collection>();
  models.forEach((model, i) => {
    const map = /@@map\(\s*"([^"]+)"\s*\)/.exec(model.body)?.[1];
    const collection = createCollection(engine, map ?? model.name, { x: i * 340, y: 0 });
    const lines = fieldLines(model.body);
    const indexes: DocIndex[] = [];
    const nameOf = (prismaName: string) => {
      const line = lines.find((l) => l.name === prismaName);
      return line ? (unquote(attr(line.attrs, 'map')) || line.name) : prismaName;
    };
    for (const line of lines) {
      const field = toField(line, collection.name);
      if (!field) continue;
      // The @id field is the document id.
      if (attr(line.attrs, 'id') !== undefined) {
        const id = collection.fields.find((f) => f.name === ID_KEY);
        if (id) Object.assign(id, { type: field.type, defaultValue: field.defaultValue });
        else collection.fields.unshift({ ...field, name: ID_KEY, required: true, nullable: false });
        if (field.name !== ID_KEY && engine === 'mongodb') warnings.push(t('import.prismaId', { field: line.name, model: model.name }));
        continue;
      }
      if (attr(line.attrs, 'unique') !== undefined) indexes.push({ id: uid(), name: '', nameIsCustom: false, keys: [{ path: field.name, order: 1 }], unique: true });
      collection.fields.push(field);
    }
    const blockLines = model.body.split('\n').map(clean).filter((l) => /^@@(index|unique)\(/.test(l));
    for (const line of blockLines) {
      const kind = line.startsWith('@@unique') ? 'unique' : 'index';
      const args = attr(line, kind) ?? '';
      const keys = splitTop(/^\s*\[([\s\S]*)\]/.exec(args)?.[1] ?? '').map((k) => {
        const name = k.replace(/\(.*$/, '').trim();
        return { path: nameOf(name), order: (/sort:\s*Desc/.test(k) ? -1 : 1) as 1 | -1 };
      });
      const custom = /map:\s*"([^"]+)"/.exec(args)?.[1] ?? /name:\s*"([^"]+)"/.exec(args)?.[1];
      if (keys.length) indexes.push({ id: uid(), name: custom ?? '', nameIsCustom: Boolean(custom), keys, ...(kind === 'unique' ? { unique: true } : {}) });
    }
    for (const m of model.body.matchAll(/@@(fulltext|id|ignore|schema)\b/g)) skipped.push(t('import.prismaBlock', { attribute: `@@${m[1]}`, model: model.name }));
    collection.indexes.push(...indexes);
    byModel.set(model.name, collection);
    collections.push(collection);
  });

  // `cliente Cliente @relation(fields: [clienteId], references: [id])` makes clienteId a reference.
  models.forEach((model) => {
    const collection = byModel.get(model.name)!;
    for (const line of fieldLines(model.body)) {
      if (!modelNames.has(line.type)) continue;
      const relation = attr(line.attrs, 'relation');
      const fields = relation ? listArg(relation, 'fields') : [];
      const target = byModel.get(line.type)!;
      for (const scalar of fields) {
        const own = fieldLines(model.body).find((l) => l.name === scalar);
        const name = own ? (unquote(attr(own.attrs, 'map')) || own.name) : scalar;
        const field = collection.fields.find((f) => f.name === name);
        const holder = field?.type === 'array' ? field.items : field;
        if (holder) holder.reference = { collectionId: target.id, fieldPath: ID_KEY };
      }
    }
  });
  return { collections, relationships: relationshipsFromFields(collections), documents: {}, stats: {}, warnings, skipped: [...new Set(skipped)] };
};
