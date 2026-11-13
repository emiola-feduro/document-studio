import type { EngineId, FieldType } from './types';

export type Engine = {
  id: EngineId;
  name: string;
  /** Fields every document carries, created with each new collection. */
  systemFields: { name: string; type: FieldType }[];
  /** Type of a field that points to another collection's id. */
  referenceType: FieldType;
  /** Only Firestore nests collections under documents. */
  subcollections: boolean;
};

export const ENGINES: Record<EngineId, Engine> = {
  mongodb: {
    id: 'mongodb',
    name: 'MongoDB',
    systemFields: [{ name: '_id', type: 'objectId' }],
    referenceType: 'objectId',
    subcollections: false,
  },
  firestore: {
    id: 'firestore',
    name: 'Firestore',
    // The document id lives in the path, not in the data.
    systemFields: [],
    referenceType: 'reference',
    subcollections: true,
  },
  couchdb: {
    id: 'couchdb',
    name: 'CouchDB',
    systemFields: [
      { name: '_id', type: 'string' },
      { name: '_rev', type: 'string' },
    ],
    referenceType: 'string',
    subcollections: false,
  },
};

export const ENGINE_LIST = Object.values(ENGINES);

export const isEngine = (value: unknown): value is EngineId => typeof value === 'string' && value in ENGINES;
