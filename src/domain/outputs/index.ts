import type { MessageKey } from '../../i18n';
import type { EngineId, Project } from '../types';
import { couchbaseIndexes, couchDesignOutput, mangoIndexes } from './couchdb';
import { firestoreIndexes } from './firestore-indexes';
import { firestoreRules } from './firestore-rules';
import { firestoreTypes } from './firestore-types';
import { mongoJsonSchemaOutput, standardSchemaOutput } from './json-schema';
import { mongoScript } from './mongodb-script';
import { mongooseOutput } from './mongoose';
import { prismaOutput } from './prisma';
import type { OutputResult } from './shared';

export type Language = 'js' | 'ts' | 'json' | 'prisma' | 'rules' | 'sh' | 'sql';

export type OutputOptions = { collMod?: boolean };

export type OutputDef = {
  id: string;
  label: MessageKey;
  filename: (project: Project) => string;
  language: Language;
  generate: (project: Project, options: OutputOptions) => OutputResult;
};

const base = (p: Project) => (p.databaseName?.trim() || p.name).replace(/[^A-Za-z0-9_-]+/g, '-').toLowerCase() || 'schema';

const JSON_SCHEMA: OutputDef = {
  id: 'json-schema',
  label: 'schema.out.jsonSchema',
  filename: (p) => `${base(p)}.schema.json`,
  language: 'json',
  generate: standardSchemaOutput,
};

export const OUTPUTS: Record<EngineId, OutputDef[]> = {
  mongodb: [
    { id: 'mongosh', label: 'schema.out.mongosh', filename: (p) => `${base(p)}.mongodb.js`, language: 'js', generate: (p, o) => mongoScript(p, o) },
    { id: 'jsonSchema', label: 'schema.out.bsonSchema', filename: (p) => `${base(p)}.jsonschema.json`, language: 'json', generate: mongoJsonSchemaOutput },
    { id: 'mongoose', label: 'schema.out.mongoose', filename: () => 'models.ts', language: 'ts', generate: mongooseOutput },
    { id: 'prisma', label: 'schema.out.prisma', filename: () => 'schema.prisma', language: 'prisma', generate: prismaOutput },
    JSON_SCHEMA,
  ],
  firestore: [
    { id: 'rules', label: 'schema.out.rules', filename: () => 'firestore.rules', language: 'rules', generate: firestoreRules },
    { id: 'indexes', label: 'schema.out.firestoreIndexes', filename: () => 'firestore.indexes.json', language: 'json', generate: firestoreIndexes },
    { id: 'types', label: 'schema.out.firestoreTypes', filename: () => 'firestore-types.ts', language: 'ts', generate: firestoreTypes },
    JSON_SCHEMA,
  ],
  couchdb: [
    { id: 'design', label: 'schema.out.design', filename: () => 'design-docs.json', language: 'json', generate: couchDesignOutput },
    { id: 'mango', label: 'schema.out.mango', filename: (p) => `${base(p)}-indexes.sh`, language: 'sh', generate: mangoIndexes },
    { id: 'couchbase', label: 'schema.out.couchbase', filename: (p) => `${base(p)}.n1ql`, language: 'sql', generate: couchbaseIndexes },
    JSON_SCHEMA,
  ],
};

/** The engine's own script, used by the agent export when asked to include it. */
export const primaryOutput = (project: Project) => OUTPUTS[project.engine][0].generate(project, {});
