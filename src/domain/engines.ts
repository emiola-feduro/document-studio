import type { EngineId, FieldType } from './types';

export type TypeGroup = 'text' | 'number' | 'date' | 'structure' | 'identity' | 'other';

export type TypeInfo = {
  type: FieldType;
  /** Name in the engine: bsonType in MongoDB, rules type in Firestore, JSON type in CouchDB. */
  native: string;
  group: TypeGroup;
};

export type Engine = {
  id: EngineId;
  name: string;
  types: TypeInfo[];
  /** Fields every document carries, created with each new collection. */
  systemFields: { name: string; type: FieldType }[];
  /** Type of a field that points to another collection's id. */
  referenceType: FieldType;
  /** Only Firestore nests collections under documents. */
  subcollections: boolean;
  /** Largest document in bytes. */
  maxDocumentBytes: number;
  /** Deepest nesting of objects. */
  maxDepth: number;
  maxIndexes?: number;
  /** Arrays may hold arrays. */
  nestedArrays: boolean;
};

const t = (type: FieldType, native: string, group: TypeGroup): TypeInfo => ({ type, native, group });

export const ENGINES: Record<EngineId, Engine> = {
  mongodb: {
    id: 'mongodb',
    name: 'MongoDB',
    types: [
      t('string', 'string', 'text'),
      t('enum', 'string (enum)', 'text'),
      t('int', 'int', 'number'),
      t('long', 'long', 'number'),
      t('double', 'double', 'number'),
      t('decimal', 'decimal', 'number'),
      t('bool', 'bool', 'other'),
      t('date', 'date', 'date'),
      t('timestamp', 'timestamp', 'date'),
      t('objectId', 'objectId', 'identity'),
      t('reference', 'objectId (ref)', 'identity'),
      t('uuid', 'binData (UUID)', 'identity'),
      t('object', 'object', 'structure'),
      t('array', 'array', 'structure'),
      t('geoPoint', 'GeoJSON Point', 'structure'),
      t('binary', 'binData', 'other'),
      t('null', 'null', 'other'),
      t('any', 'any', 'other'),
    ],
    systemFields: [{ name: '_id', type: 'objectId' }],
    referenceType: 'objectId',
    subcollections: false,
    maxDocumentBytes: 16 * 1024 * 1024,
    maxDepth: 100,
    maxIndexes: 64,
    nestedArrays: true,
  },
  firestore: {
    id: 'firestore',
    name: 'Firestore',
    types: [
      t('string', 'string', 'text'),
      t('enum', 'string (enum)', 'text'),
      t('int', 'int', 'number'),
      t('double', 'float', 'number'),
      t('number', 'number', 'number'),
      t('bool', 'bool', 'other'),
      t('timestamp', 'timestamp', 'date'),
      t('reference', 'reference', 'identity'),
      t('object', 'map', 'structure'),
      t('array', 'array', 'structure'),
      t('geoPoint', 'geopoint', 'structure'),
      t('binary', 'bytes', 'other'),
      t('null', 'null', 'other'),
      t('any', 'any', 'other'),
    ],
    // The document id lives in the path, not in the data.
    systemFields: [],
    referenceType: 'reference',
    subcollections: true,
    maxDocumentBytes: 1024 * 1024,
    maxDepth: 20,
    nestedArrays: false,
  },
  couchdb: {
    id: 'couchdb',
    name: 'CouchDB',
    types: [
      t('string', 'string', 'text'),
      t('enum', 'string (enum)', 'text'),
      t('int', 'number (int)', 'number'),
      t('number', 'number', 'number'),
      t('decimal', 'string (decimal)', 'number'),
      t('bool', 'boolean', 'other'),
      t('date', 'string (ISO 8601)', 'date'),
      t('uuid', 'string (UUID)', 'identity'),
      t('reference', 'string (_id)', 'identity'),
      t('object', 'object', 'structure'),
      t('array', 'array', 'structure'),
      t('geoPoint', '{lat, lng}', 'structure'),
      t('null', 'null', 'other'),
      t('any', 'any', 'other'),
    ],
    systemFields: [
      { name: '_id', type: 'string' },
      { name: '_rev', type: 'string' },
    ],
    referenceType: 'reference',
    subcollections: false,
    // CouchDB's default max_document_size.
    maxDocumentBytes: 8 * 1000 * 1000,
    maxDepth: 100,
    nestedArrays: true,
  },
};

export const ENGINE_LIST = Object.values(ENGINES);

export const isEngine = (value: unknown): value is EngineId => typeof value === 'string' && value in ENGINES;

export const typeInfo = (engine: EngineId, type: FieldType) => ENGINES[engine].types.find((i) => i.type === type);

export const supportsType = (engine: EngineId, type: FieldType) => Boolean(typeInfo(engine, type));

export const nativeType = (engine: EngineId, type: FieldType) => typeInfo(engine, type)?.native ?? type;

/** Closest type an engine has. `lossy` means some meaning or precision is lost. */
export const convertType = (engine: EngineId, type: FieldType): { type: FieldType; lossy: boolean } => {
  if (supportsType(engine, type)) return { type, lossy: false };
  const fallbacks: Partial<Record<EngineId, Partial<Record<FieldType, [FieldType, boolean]>>>> = {
    mongodb: { number: ['double', false] },
    firestore: {
      long: ['int', false],
      decimal: ['double', true],
      date: ['timestamp', false],
      objectId: ['string', false],
      uuid: ['string', false],
    },
    couchdb: {
      long: ['int', false],
      double: ['number', false],
      timestamp: ['date', false],
      objectId: ['string', false],
      binary: ['string', true],
    },
  };
  const [next, lossy] = fallbacks[engine]?.[type] ?? ['any', true];
  return { type: next, lossy };
};

/** Problem with a field name in an engine, or undefined when it is fine. Returns a message key and params. */
export const fieldNameProblem = (engine: EngineId, name: string, isSystem = false): 'empty' | 'dollar' | 'dot' | 'reserved' | 'underscore' | 'tooLong' | undefined => {
  if (!name.trim()) return 'empty';
  if (isSystem) return undefined;
  if (engine === 'mongodb') {
    if (name.startsWith('$')) return 'dollar';
    if (name.includes('.')) return 'dot';
  }
  if (engine === 'firestore') {
    if (/^__.*__$/.test(name)) return 'reserved';
    if (new TextEncoder().encode(name).length > 1500) return 'tooLong';
  }
  if (engine === 'couchdb' && name.startsWith('_') && !['_id', '_rev', '_attachments', '_deleted'].includes(name)) return 'underscore';
  return undefined;
};

export const collectionNameProblem = (engine: EngineId, name: string): 'empty' | 'dollar' | 'system' | 'slash' | 'reserved' | undefined => {
  if (!name.trim()) return 'empty';
  if (engine === 'mongodb') {
    if (name.includes('$')) return 'dollar';
    if (name.startsWith('system.')) return 'system';
  }
  if (engine === 'firestore') {
    if (name.includes('/')) return 'slash';
    if (/^__.*__$/.test(name) || name === '.' || name === '..') return 'reserved';
  }
  return undefined;
};

/** Field that holds the document id in sample documents; in Firestore it is the document id, not data. */
export const ID_KEY = '_id';
