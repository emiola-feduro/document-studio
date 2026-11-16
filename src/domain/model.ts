import { getLocale } from '../i18n';
import { ENGINES } from './engines';
import type { Collection, EngineId, Field, Project } from './types';

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

export const createProject = (name: string, engine: EngineId, databaseName?: string): Project => {
  const now = Date.now();
  // Names start in the interface language; the overview lets people change it.
  const project: Project = { id: uid(), name, engine, namesLocale: getLocale(), collections: [], relationships: [], documents: {}, createdAt: now, updatedAt: now };
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

/** Copy of a collection with new ids, placed beside the original. */
export const duplicateCollection = (project: Project, collectionId: string, name: string): Collection | undefined => {
  const source = project.collections.find((c) => c.id === collectionId);
  if (!source) return undefined;
  const copy: Collection = structuredClone(source);
  copy.id = uid();
  copy.name = name;
  copy.position = { x: source.position.x + 40, y: source.position.y + 40 };
  const reid = (fields: Field[]) => {
    for (const field of fields) {
      field.id = uid();
      if (field.children) reid(field.children);
      if (field.items) reid([field.items]);
    }
  };
  reid(copy.fields);
  for (const index of copy.indexes) index.id = uid();
  project.collections.push(copy);
  return copy;
};

/** Path of a Firestore collection from the root: `usuarios/{usuarioId}/pedidos`. */
export const collectionPath = (project: Project, collection: Collection): string => {
  const parent = collection.parentId ? project.collections.find((c) => c.id === collection.parentId) : undefined;
  if (!parent || collection.kind !== 'subcollection') return collection.name;
  return `${collectionPath(project, parent)}/{${docIdParam(parent)}}/${collection.name}`;
};

export const docIdParam = (collection: Collection) => {
  const base = collection.name.replace(/[^A-Za-z0-9]/g, '') || 'doc';
  const one = base.endsWith('s') ? base.slice(0, -1) : base;
  return `${one}Id`;
};

/** Collections in an order where every referenced collection comes before the ones that point at it. */
export const topologicalOrder = (project: Project): Collection[] => {
  const deps = new Map<string, Set<string>>();
  for (const c of project.collections) deps.set(c.id, new Set(c.parentId ? [c.parentId] : []));
  for (const r of project.relationships) {
    if (r.kind === 'reference' && r.from.collectionId !== r.to.collectionId) deps.get(r.from.collectionId)?.add(r.to.collectionId);
  }
  const out: Collection[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();
  const visit = (c: Collection) => {
    if (done.has(c.id) || visiting.has(c.id)) return;
    visiting.add(c.id);
    for (const dep of deps.get(c.id) ?? []) {
      const d = project.collections.find((x) => x.id === dep);
      if (d) visit(d);
    }
    visiting.delete(c.id);
    done.add(c.id);
    out.push(c);
  };
  project.collections.forEach(visit);
  return out;
};
