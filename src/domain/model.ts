import { walkFields } from './paths';
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

/**
 * Order in which documents have to be created: first the collections that reference no other, then
 * the ones that only reference those, and so on by levels, keeping the model order inside a level.
 * References (relationships and reference fields) and the parent of a subcollection count; embeds do
 * not, as they live inside the document. A reference to itself or a cycle never blocks the order: the
 * first collection left in model order goes next.
 */
export const creationOrder = (project: Project): Collection[] => {
  const ids = new Set(project.collections.map((c) => c.id));
  const deps = new Map<string, Set<string>>();
  for (const c of project.collections) {
    const own = new Set<string>(c.parentId ? [c.parentId] : []);
    for (const { field } of walkFields(c.fields)) {
      const target = (field.type === 'array' ? field.items : field)?.reference?.collectionId;
      if (target) own.add(target);
    }
    deps.set(c.id, own);
  }
  for (const r of project.relationships) if (r.kind === 'reference') deps.get(r.from.collectionId)?.add(r.to.collectionId);
  for (const [id, set] of deps) {
    set.delete(id);
    for (const d of [...set]) if (!ids.has(d)) set.delete(d);
  }
  const out: Collection[] = [];
  const placed = new Set<string>();
  let rest = [...project.collections];
  while (rest.length) {
    const level = rest.filter((c) => [...deps.get(c.id)!].every((d) => placed.has(d)));
    // A cycle: the first collection left goes next and the order goes on from there.
    const next = level.length ? level : [rest[0]];
    for (const c of next) {
      out.push(c);
      placed.add(c.id);
    }
    rest = rest.filter((c) => !placed.has(c.id));
  }
  return out;
};

/** Kept for the callers that generate documents. */
export const topologicalOrder = creationOrder;
