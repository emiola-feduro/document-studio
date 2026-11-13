import { ENGINES } from './engines';
import type { Collection, EngineId, Field, Project } from './types';

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

export const createProject = (name: string, engine: EngineId, databaseName?: string): Project => {
  const now = Date.now();
  const project: Project = { id: uid(), name, engine, collections: [], relationships: [], documents: {}, createdAt: now, updatedAt: now };
  if (databaseName?.trim()) project.databaseName = databaseName.trim();
  return project;
};

export const createField = (overrides: Partial<Field> = {}): Field => ({
  id: uid(),
  name: 'field',
  type: 'string',
  required: false,
  nullable: false,
  ...overrides,
});

/** A collection with the id fields its engine puts in every document. */
export const createCollection = (engine: EngineId, name: string, position = { x: 0, y: 0 }): Collection => ({
  id: uid(),
  name,
  kind: 'collection',
  fields: ENGINES[engine].systemFields.map((f) => createField({ name: f.name, type: f.type, required: true })),
  indexes: [],
  options: {},
  position,
});

/** `base`, or `base_2`, `base_3`... when the name is taken (case insensitive). */
export const nextName = (base: string, taken: string[]) => {
  const set = new Set(taken.map((n) => n.toLowerCase()));
  if (!set.has(base.toLowerCase())) return base;
  let i = 2;
  while (set.has(`${base}_${i}`.toLowerCase())) i += 1;
  return `${base}_${i}`;
};

/** Subcollections of a collection, at any depth. */
export const descendantsOf = (project: Project, collectionId: string): Collection[] => {
  const direct = project.collections.filter((c) => c.parentId === collectionId);
  return direct.flatMap((c) => [c, ...descendantsOf(project, c.id)]);
};

/** Removes a collection, its subcollections, the relationships that touch them and their documents. */
export const removeCollection = (project: Project, collectionId: string) => {
  const ids = new Set([collectionId, ...descendantsOf(project, collectionId).map((c) => c.id)]);
  project.collections = project.collections.filter((c) => !ids.has(c.id));
  project.relationships = project.relationships.filter((r) => !ids.has(r.from.collectionId) && !ids.has(r.to.collectionId));
  for (const id of ids) delete project.documents?.[id];
};

/** Fields at every depth: object children and array element types. */
export const countFields = (fields: Field[]): number =>
  fields.reduce((n, f) => n + 1 + countFields(f.children ?? []) + (f.items?.children ? countFields(f.items.children) : 0), 0);
