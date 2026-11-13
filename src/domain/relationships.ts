import { ENGINES } from './engines';
import { createField, uid } from './model';
import { camelCase, singular } from './naming';
import { cloneFields, fieldAtPath, locateField, removeField, walkFields } from './paths';
import type { Cardinality, Collection, Field, Project, Relationship } from './types';

export type RelationshipInput = {
  kind: Relationship['kind'];
  fromId: string;
  toId: string;
  cardinality: Cardinality;
  storage?: Relationship['storage'];
  /** Name of the field created in the source collection. */
  fieldName?: string;
  twoWay?: boolean;
  /** Embed: ids of the target's top level fields to copy (extended reference). All but system fields by default. */
  embedFieldIds?: string[];
  name?: string;
};

const SYSTEM = new Set(['_id', '_rev']);

export const defaultStorage = (kind: Relationship['kind'], cardinality: Cardinality): Relationship['storage'] =>
  kind === 'embed' ? (cardinality === '1:1' ? 'single' : 'array') : cardinality === 'N:M' ? 'array' : 'single';

/** Field name the app suggests: `clienteId`, `productoIds`, `direccion`, `items`. */
export const suggestFieldName = (project: Project, input: Pick<RelationshipInput, 'kind' | 'toId' | 'cardinality' | 'storage'>) => {
  const target = project.collections.find((c) => c.id === input.toId);
  const base = target?.name || 'ref';
  const storage = input.storage ?? defaultStorage(input.kind, input.cardinality);
  if (input.kind === 'embed') return camelCase(storage === 'array' ? base : singular(base));
  const one = camelCase(singular(base));
  return storage === 'array' ? `${one}Ids` : `${one}Id`;
};

const freeName = (fields: Field[], name: string) => {
  const taken = new Set(fields.map((f) => f.name));
  if (!taken.has(name)) return name;
  let i = 2;
  while (taken.has(`${name}${i}`)) i += 1;
  return `${name}${i}`;
};

const referenceField = (project: Project, target: Collection, name: string, storage: Relationship['storage'], required: boolean) => {
  const engine = ENGINES[project.engine];
  const idField = target.fields.find((f) => f.name === '_id');
  // MongoDB references take the target id type; Firestore uses DocumentReference; CouchDB a string _id.
  const type = project.engine === 'mongodb' && idField ? idField.type : engine.referenceType;
  const reference = { collectionId: target.id, fieldPath: project.engine === 'firestore' ? '__name__' : '_id' };
  if (storage === 'array') {
    return createField({ name, type: 'array', required, items: createField({ name: '', type, required: true, reference }) });
  }
  return createField({ name, type, required, reference });
};

const embedField = (target: Collection, name: string, storage: Relationship['storage'], fieldIds?: string[]) => {
  const source = target.fields.filter((f) => (fieldIds ? fieldIds.includes(f.id) : !SYSTEM.has(f.name)));
  const children = cloneFields(source);
  if (storage === 'array') {
    return createField({ name, type: 'array', items: createField({ name: '', type: 'object', children }) });
  }
  return createField({ name, type: 'object', children });
};

/** Creates the relationship and the field that stores it in the source collection. Returns the relationship. */
export const createRelationship = (project: Project, input: RelationshipInput): Relationship | undefined => {
  const from = project.collections.find((c) => c.id === input.fromId);
  const to = project.collections.find((c) => c.id === input.toId);
  if (!from || !to) return undefined;
  const storage = input.storage ?? defaultStorage(input.kind, input.cardinality);
  const name = freeName(from.fields, input.fieldName?.trim() || suggestFieldName(project, { ...input, storage }));
  const field =
    input.kind === 'embed'
      ? embedField(to, name, storage, input.embedFieldIds)
      : referenceField(project, to, name, storage, input.cardinality !== 'N:M');
  from.fields.push(field);
  const relationship: Relationship = {
    id: uid(),
    kind: input.kind,
    from: { collectionId: from.id, fieldPath: name },
    to: { collectionId: to.id },
    cardinality: input.cardinality,
    storage,
  };
  if (input.name?.trim()) relationship.name = input.name.trim();
  if (input.kind === 'reference' && input.cardinality === 'N:M' && input.twoWay && from.id !== to.id) {
    const reverse = freeName(to.fields, `${camelCase(singular(from.name || 'ref'))}Ids`);
    to.fields.push(referenceField(project, from, reverse, 'array', false));
    relationship.twoWay = true;
    relationship.reverseFieldPath = reverse;
  }
  project.relationships.push(relationship);
  return relationship;
};

/** Removes a relationship and, when asked, the fields it created. */
export const removeRelationship = (project: Project, id: string, removeFields: boolean) => {
  const rel = project.relationships.find((r) => r.id === id);
  if (!rel) return;
  project.relationships = project.relationships.filter((r) => r.id !== id);
  if (!removeFields) return;
  const drop = (collectionId: string, path: string) => {
    const collection = project.collections.find((c) => c.id === collectionId);
    const field = collection && fieldAtPath(collection.fields, path);
    if (collection && field) removeField(collection.fields, field.id);
  };
  drop(rel.from.collectionId, rel.from.fieldPath);
  if (rel.reverseFieldPath) drop(rel.to.collectionId, rel.reverseFieldPath);
};

/** Relationship that a field stores, if any. */
export const relationshipOfField = (project: Project, collectionId: string, path: string) =>
  project.relationships.find(
    (r) =>
      (r.from.collectionId === collectionId && r.from.fieldPath === path) ||
      (r.to.collectionId === collectionId && r.reverseFieldPath === path),
  );

/** Keeps a relationship's stored field in line with its kind, cardinality and storage after an edit. */
export const rebuildRelationshipField = (project: Project, id: string) => {
  const rel = project.relationships.find((r) => r.id === id);
  const from = project.collections.find((c) => c.id === rel?.from.collectionId);
  const to = project.collections.find((c) => c.id === rel?.to.collectionId);
  if (!rel || !from || !to) return;
  const current = fieldAtPath(from.fields, rel.from.fieldPath);
  const loc = current && locateField(from.fields, current.id);
  const name = current?.name ?? rel.from.fieldPath;
  const next =
    rel.kind === 'embed'
      ? embedField(to, name, rel.storage, undefined)
      : referenceField(project, to, name, rel.storage, current?.required ?? rel.cardinality !== 'N:M');
  // Keep what the person set on the field that still makes sense.
  if (current) {
    next.id = current.id;
    next.description = current.description;
    if (rel.kind === 'embed' && current.type === next.type) {
      next.children = current.children;
      next.items = current.items ?? next.items;
    }
    if (next.type === 'array') {
      next.maxItems = current.maxItems;
      next.minItems = current.minItems;
    }
  }
  if (loc) loc.list[loc.index] = next;
  else from.fields.push(next);
  if (rel.twoWay && rel.kind === 'reference' && rel.cardinality === 'N:M') {
    if (!rel.reverseFieldPath || !fieldAtPath(to.fields, rel.reverseFieldPath)) {
      const reverse = freeName(to.fields, `${camelCase(singular(from.name || 'ref'))}Ids`);
      to.fields.push(referenceField(project, from, reverse, 'array', false));
      rel.reverseFieldPath = reverse;
    }
  } else if (rel.reverseFieldPath) {
    const reverse = fieldAtPath(to.fields, rel.reverseFieldPath);
    if (reverse) removeField(to.fields, reverse.id);
    delete rel.reverseFieldPath;
    delete rel.twoWay;
  }
};

/** Fields of a collection that point at another collection, with their paths. */
export const referencePaths = (collection: Collection) =>
  walkFields(collection.fields).flatMap(({ path, field }) => {
    if (field.reference) return [{ path, field, target: field.reference.collectionId, array: false }];
    if (field.type === 'array' && field.items?.reference) return [{ path, field, target: field.items.reference.collectionId, array: true }];
    return [];
  });
