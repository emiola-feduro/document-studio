import { t } from '../../i18n';
import { indexName } from '../indexes';
import { camelCase, modelTypeName, pascalCase, singular } from '../naming';
import type { Collection, Field, Project } from '../types';
import { parseLiteral, type OutputResult } from './shared';

type Ctx = { project: Project; types: Map<string, string>; enums: Map<string, string>; warnings: string[]; collection: Collection };

const modelName = (project: Project, c: Collection) => modelTypeName(project, c.name);

const SCALAR: Partial<Record<Field['type'], string>> = {
  string: 'String',
  int: 'Int',
  long: 'BigInt',
  double: 'Float',
  number: 'Float',
  decimal: 'Float',
  bool: 'Boolean',
  date: 'DateTime',
  timestamp: 'DateTime',
  objectId: 'String',
  reference: 'String',
  uuid: 'String',
  binary: 'Bytes',
  any: 'Json',
  null: 'Json',
};

const uniqueName = (map: Map<string, string>, base: string) => {
  let name = base;
  let i = 2;
  while (map.has(name)) name = `${base}${i++}`;
  return name;
};

const fieldLine = (ctx: Ctx, field: Field, owner: string, inType: boolean): string[] => {
  const name = field.name;
  if (!name || (name === '_id' && !inType)) return [];
  let base: string;
  let list = false;
  const element = field.type === 'array' ? field.items : field;
  if (field.type === 'array') list = true;
  if (!element) base = 'Json';
  else if (element.type === 'object' || element.type === 'geoPoint') {
    const typeName = uniqueName(ctx.types, pascalCase(`${owner} ${singular(name, ctx.project.namesLocale)}`));
    ctx.types.set(typeName, '');
    const children =
      element.type === 'geoPoint'
        ? ['  type        String', '  coordinates Float[]']
        : (element.children ?? []).flatMap((c) => fieldLine(ctx, c, typeName, true)).map((l) => `  ${l}`);
    ctx.types.set(typeName, `type ${typeName} {\n${children.join('\n')}\n}`);
    base = typeName;
  } else if (element.type === 'enum' && element.enumValues?.length) {
    const enumName = uniqueName(ctx.enums, pascalCase(`${owner} ${name}`));
    const values = element.enumValues.map((v) => {
      const id = v.replace(/[^A-Za-z0-9_]/g, '_').replace(/^([0-9])/, '_$1') || 'empty';
      return id === v ? `  ${id}` : `  ${id} @map(${JSON.stringify(v)})`;
    });
    ctx.enums.set(enumName, `enum ${enumName} {\n${values.join('\n')}\n}`);
    base = enumName;
  } else if (element.type === 'array') {
    base = 'Json';
    list = false;
  } else {
    base = SCALAR[element.type] ?? 'Json';
    if (element.type === 'decimal') ctx.warnings.push(t('output.prismaDecimal', { collection: ctx.collection.name, path: name }));
  }
  const optional = !list && (!field.required || field.nullable) && base !== 'Json' ? '?' : '';
  const attrs: string[] = [];
  if (element && (element.type === 'objectId' || element.reference) && ctx.project.engine === 'mongodb') attrs.push('@db.ObjectId');
  const def = parseLiteral(field.defaultValue);
  if (!list && def !== undefined) {
    if (typeof def === 'string' && /^now\(?\)?$/i.test(def)) attrs.push('@default(now())');
    else if (typeof def === 'string' && base !== 'String' && !SCALAR[field.type]) attrs.push(`@default(${def})`);
    else attrs.push(`@default(${JSON.stringify(def)})`);
  }
  if (name !== camelCase(name) && !inType) attrs.push(`@map(${JSON.stringify(name)})`);
  const prismaName = inType ? name : camelCase(name) || name;
  return [`${prismaName} ${base}${list ? '[]' : optional}${attrs.length ? ` ${attrs.join(' ')}` : ''}`];
};

/** Prisma schema for MongoDB: models, composite types for embedded documents, relations and indexes. */
export const prismaOutput = (project: Project): OutputResult => {
  const warnings: string[] = [];
  const types = new Map<string, string>();
  const enums = new Map<string, string>();
  const backRelations = new Map<string, string[]>();
  const models: string[] = [];

  for (const collection of project.collections) {
    const ctx: Ctx = { project, types, enums, warnings, collection };
    const name = modelName(project, collection);
    const lines = ['id String @id @default(auto()) @map("_id") @db.ObjectId'];
    for (const field of collection.fields) lines.push(...fieldLine(ctx, field, name, false));
    // Top level references become relations; the other side gets the back relation.
    for (const rel of project.relationships.filter((r) => r.kind === 'reference' && r.from.collectionId === collection.id && !r.from.fieldPath.includes('.'))) {
      const target = project.collections.find((c) => c.id === rel.to.collectionId);
      if (!target) continue;
      const fieldName = camelCase(rel.from.fieldPath);
      const relName = `${name}_${fieldName}`;
      const navName = fieldName.replace(/Ids?$/, '') || camelCase(singular(target.name, project.namesLocale));
      if (rel.storage === 'array') {
        if (rel.twoWay) {
          lines.push(`${navName}${navName === fieldName ? 'List' : ''} ${modelName(project, target)}[] @relation("${relName}", fields: [${fieldName}], references: [id])`);
          const back = backRelations.get(target.id) ?? [];
          back.push(`${camelCase(collection.name)} ${name}[] @relation("${relName}", fields: [${camelCase(rel.reverseFieldPath ?? '')}], references: [id])`);
          backRelations.set(target.id, back);
        }
        continue;
      }
      const optional = lines.find((l) => l.startsWith(`${fieldName} `))?.includes('?') ? '?' : '';
      lines.push(`${navName}${navName === fieldName ? 'Ref' : ''} ${modelName(project, target)}${optional} @relation("${relName}", fields: [${fieldName}], references: [id])`);
      const back = backRelations.get(target.id) ?? [];
      back.push(`${camelCase(collection.name)}${target.id === collection.id ? 'Children' : ''} ${name}[] @relation("${relName}")`);
      backRelations.set(target.id, back);
    }
    const blockAttrs: string[] = [];
    for (const index of collection.indexes) {
      const keys = index.keys.filter((k) => k.path && typeof k.order === 'number').map((k) => {
        const path = k.path.replace(/\[\]/g, '');
        return k.order === -1 ? `${path}(sort: Desc)` : path;
      });
      if (keys.length === 0) continue;
      const nameArg = `, map: ${JSON.stringify(indexName(index))}`;
      if (index.unique) blockAttrs.push(`@@unique([${keys.join(', ')}]${nameArg})`);
      else blockAttrs.push(`@@index([${keys.join(', ')}]${nameArg})`);
    }
    blockAttrs.push(`@@map(${JSON.stringify(collection.name)})`);
    models.push(JSON.stringify({ name, id: collection.id, lines, blockAttrs }));
  }

  const blocks = models.map((m) => {
    const { name, id, lines, blockAttrs } = JSON.parse(m) as { name: string; id: string; lines: string[]; blockAttrs: string[] };
    const all = [...lines, ...(backRelations.get(id) ?? [])];
    return `model ${name} {\n${all.map((l) => `  ${l}`).join('\n')}\n\n${blockAttrs.map((l) => `  ${l}`).join('\n')}\n}`;
  });
  const header = 'datasource db {\n  provider = "mongodb"\n  url      = env("DATABASE_URL")\n}\n\ngenerator client {\n  provider = "prisma-client-js"\n}';
  return { code: `${[header, ...blocks, ...types.values(), ...enums.values()].join('\n\n')}\n`, warnings: [...new Set(warnings)] };
};
