import type { FieldStats } from '../infer';
import type { Collection, Relationship, SampleDocument } from '../types';

export type ImportFormat = 'documents' | 'jsonSchema' | 'mongoose' | 'prisma' | 'firestoreIndexes';

/** What an import adds: collections with their references, sample documents, and what could not be read. */
export type SchemaImport = {
  collections: Collection[];
  relationships: Relationship[];
  documents: Record<string, SampleDocument[]>;
  /** Field statistics by collection id, only when the import came from documents. */
  stats: Record<string, FieldStats[]>;
  warnings: string[];
  /** Parts of the source that have no place in the model, such as hooks or validators written as code. */
  skipped: string[];
};
