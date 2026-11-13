import { docIdParam } from '../model';
import { isIdentifier, pascalCase, singular } from '../naming';
import type { Collection, Field, Project } from '../types';
import type { OutputResult } from './shared';

const TS: Partial<Record<Field['type'], string>> = {
  string: 'string',
  int: 'number',
  long: 'number',
  double: 'number',
  number: 'number',
  decimal: 'number',
  bool: 'boolean',
  date: 'Timestamp',
  timestamp: 'Timestamp',
  geoPoint: 'GeoPoint',
  reference: 'DocumentReference',
  binary: 'Bytes',
  objectId: 'string',
  uuid: 'string',
  null: 'null',
  any: 'unknown',
};

const prop = (name: string) => (isIdentifier(name) ? name : JSON.stringify(name));

export const tsType = (field: Field, indent: string, table: Partial<Record<Field['type'], string>> = TS): string => {
  let base: string;
  if (field.type === 'object') base = tsObject(field.children ?? [], indent, table);
  else if (field.type === 'array') base = field.items ? `Array<${tsType(field.items, indent, table)}>` : 'unknown[]';
  else if (field.type === 'enum') base = field.enumValues?.length ? field.enumValues.map((v) => JSON.stringify(v)).join(' | ') : 'string';
  else base = table[field.type] ?? 'unknown';
  return field.nullable && field.type !== 'null' ? `${base} | null` : base;
};

export const tsObject = (fields: Field[], indent: string, table: Partial<Record<Field['type'], string>> = TS): string => {
  const inner = `${indent}  `;
  const lines = fields
    .filter((f) => f.name)
    .map((f) => `${f.description ? `${inner}/** ${f.description} */\n` : ''}${inner}${prop(f.name)}${f.required ? '' : '?'}: ${tsType(f, inner, table)};`);
  return lines.length ? `{\n${lines.join('\n')}\n${indent}}` : 'Record<string, unknown>';
};

const typeName = (c: Collection) => pascalCase(singular(c.name));

const refFunction = (project: Project, collection: Collection) => {
  const chain: Collection[] = [];
  let current: Collection | undefined = collection;
  while (current) {
    chain.unshift(current);
    current = current.kind === 'subcollection' ? project.collections.find((c) => c.id === current!.parentId) : undefined;
  }
  const params = chain.slice(0, -1).map((c) => `${docIdParam(c)}: string`);
  const segments = chain.flatMap((c, i) => (i < chain.length - 1 ? [JSON.stringify(c.name), docIdParam(c)] : [JSON.stringify(c.name)]));
  const name = `${collection.name.replace(/[^A-Za-z0-9]/g, '')}Collection`;
  return `export const ${name} = (db: Firestore${params.map((p) => `, ${p}`).join('')}) =>\n  collection(db, ${segments.join(', ')}).withConverter(${typeName(collection)[0].toLowerCase()}${typeName(collection).slice(1)}Converter);`;
};

/** TypeScript types and a FirestoreDataConverter per collection, with typed collection references. */
export const firestoreTypes = (project: Project): OutputResult => {
  const blocks = project.collections.map((collection) => {
    const name = typeName(collection);
    const converter = `${name[0].toLowerCase()}${name.slice(1)}Converter`;
    return [
      `// ${collection.name}`,
      `export type ${name} = ${tsObject(collection.fields.filter((f) => f.name !== '_id'), '')};`,
      '',
      `export const ${converter}: FirestoreDataConverter<${name} & { id: string }, ${name}> = {`,
      '  toFirestore: ({ id: _id, ...data }: WithFieldValue<' + name + ' & { id: string }>) => data as WithFieldValue<' + name + '>,',
      `  fromFirestore: (snapshot: QueryDocumentSnapshot<${name}>) => ({ id: snapshot.id, ...snapshot.data() }),`,
      '};',
      '',
      refFunction(project, collection),
    ].join('\n');
  });
  const header = [
    "import {",
    '  collection,',
    '  type Bytes,',
    '  type DocumentReference,',
    '  type Firestore,',
    '  type FirestoreDataConverter,',
    '  type GeoPoint,',
    '  type QueryDocumentSnapshot,',
    '  type Timestamp,',
    '  type WithFieldValue,',
    "} from 'firebase/firestore';",
  ].join('\n');
  return { code: `${header}\n\n${blocks.join('\n\n')}\n`, warnings: [] };
};
