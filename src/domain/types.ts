import type { Locale } from '../i18n';
import type { NamingConvention } from './naming';

export type EngineId = 'mongodb' | 'firestore' | 'couchdb';

export type FieldType =
  | 'string'
  | 'int'
  | 'long'
  | 'double'
  | 'decimal'
  | 'number'
  | 'bool'
  | 'date'
  | 'timestamp'
  | 'objectId'
  | 'uuid'
  | 'binary'
  | 'object'
  | 'array'
  | 'enum'
  | 'null'
  | 'any'
  /** GeoJSON Point in MongoDB, GeoPoint in Firestore. */
  | 'geoPoint'
  /** DocumentReference in Firestore; in MongoDB an objectId that points to another collection. */
  | 'reference';

export type Field = {
  id: string;
  name: string;
  type: FieldType;
  /** The key must exist. */
  required: boolean;
  /** The value may be null. */
  nullable: boolean;
  description?: string;
  /** JSON literal or a known expression. */
  defaultValue?: string;
  enumValues?: string[];
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMin?: boolean;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  /** Type 'object': embedded subdocument. */
  children?: Field[];
  /** Type 'array': element type, possibly an object with children. */
  items?: Field;
  /** What a reference points to; `_id` by default. */
  reference?: { collectionId: string; fieldPath: string };
};

export type IndexOrder = 1 | -1 | 'text' | '2dsphere' | 'hashed';

export type DocIndex = {
  id: string;
  name: string;
  nameIsCustom: boolean;
  keys: { path: string; order: IndexOrder }[];
  unique?: boolean;
  sparse?: boolean;
  /** JSON of partialFilterExpression. */
  partialFilter?: string;
  collation?: string;
  /** MongoDB `$**`; Firestore single field exemption. */
  wildcard?: boolean;
  /** Firestore only. */
  scope?: 'collection' | 'collectionGroup';
};

export type CollectionOptions = {
  validationLevel?: 'strict' | 'moderate' | 'off';
  validationAction?: 'error' | 'warn';
  capped?: { size: number; max?: number };
  timeseries?: { timeField: string; metaField?: string; granularity?: string };
  ttl?: { field: string; seconds: number };
  /** False rejects fields that are not in the model. */
  additionalProperties?: boolean;
  /** CouchDB and single bucket databases tell document kinds apart with a field. */
  typeDiscriminator?: { field: string; value: string };
};

export type Collection = {
  id: string;
  name: string;
  /** Subcollections exist only in Firestore. */
  kind: 'collection' | 'subcollection';
  parentId?: string;
  /** Includes `_id` (MongoDB) or `_id` and `_rev` (CouchDB); Firestore uses the document id. */
  fields: Field[];
  indexes: DocIndex[];
  options: CollectionOptions;
  position: { x: number; y: number };
  color?: string;
  notes?: string;
};

export type Cardinality = '1:1' | '1:N' | 'N:M';

export type Relationship = {
  id: string;
  name?: string;
  kind: 'embed' | 'reference';
  /** Where the subdocument or the reference lives. */
  from: { collectionId: string; fieldPath: string };
  to: { collectionId: string };
  cardinality: Cardinality;
  /** One reference or subdocument, or an array of them. */
  storage: 'single' | 'array';
  /** N:M with arrays on both sides. */
  twoWay?: boolean;
  /** With `twoWay`, the array of references kept in the target collection. */
  reverseFieldPath?: string;
};

/** The JSON text exactly as the person wrote it. */
export type SampleDocument = { id: string; json: string };

export type Project = {
  id: string;
  name: string;
  engine: EngineId;
  databaseName?: string;
  /** Language of collection and field names, used to build singulars for reference fields. */
  namesLocale?: Locale;
  namingConvention?: NamingConvention;
  collections: Collection[];
  relationships: Relationship[];
  /** By collection id. */
  documents?: Record<string, SampleDocument[]>;
  createdAt: number;
  updatedAt: number;
};

export type ProjectMeta = Pick<Project, 'id' | 'name' | 'engine' | 'createdAt' | 'updatedAt'> & { collectionCount: number };
