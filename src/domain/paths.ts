import { createField } from './model';
import type { Collection, Field, FieldType, Project } from './types';

/**
 * Paths are written with dots, and `[]` marks the elements of an array: `direccion.ciudad`, `items[].sku`.
 * MongoDB writes the same paths without the brackets: `items.sku`.
 */

/** Fields nested inside a field: an object's children, or the children of an array of objects. */
export const childList = (field: Field): Field[] | undefined => {
  if (field.type === 'object') return field.children;
  if (field.type === 'array' && field.items?.type === 'object') return field.items.children;
  return undefined;
};

/** Ensures the list that holds a field's children exists, creating it when the type allows children. */
const ensureChildList = (field: Field): Field[] | undefined => {
  if (field.type === 'object') return (field.children ??= []);
  if (field.type === 'array') {
    field.items ??= createField({ name: '', type: 'object' });
    if (field.items.type !== 'object') return undefined;
    return (field.items.children ??= []);
  }
  return undefined;
};

export const joinPath = (parent: string, field: Field, parentIsArray: boolean) =>
  parent ? `${parent}${parentIsArray ? '[]' : ''}.${field.name}` : field.name;

export const toMongoPath = (path: string) => path.replace(/\[\]/g, '');

export type PathEntry = {
  path: string;
  field: Field;
  depth: number;
  /** The field sits inside an array of objects (multikey in MongoDB). */
  inArray: boolean;
  parentPath: string;
};

/** Every field in the tree with its path, in display order. */
export const walkFields = (fields: Field[], parent = '', depth = 0, inArray = false, parentIsArray = false): PathEntry[] =>
  fields.flatMap((field) => {
    const path = joinPath(parent, field, parentIsArray);
    const entry: PathEntry = { path, field, depth, inArray, parentPath: parent };
    const nested = childList(field);
    const isArray = field.type === 'array';
    return [entry, ...(nested ? walkFields(nested, path, depth + 1, inArray || isArray, isArray) : [])];
  });

export const allPaths = (collection: Pick<Collection, 'fields'>) => walkFields(collection.fields);

/** Field at a path, accepting both `items[].sku` and the MongoDB form `items.sku`. */
export const fieldAtPath = (fields: Field[], path: string): Field | undefined => {
  const wanted = toMongoPath(path);
  return walkFields(fields).find((e) => toMongoPath(e.path) === wanted)?.field;
};

export type FieldLocation = { field: Field; list: Field[]; index: number; parent?: Field; path: string; depth: number };

/** Where a field lives in the tree, so it can be edited, moved or removed in place. */
export const locateField = (fields: Field[], id: string, parent?: Field, prefix = '', depth = 0): FieldLocation | undefined => {
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const path = joinPath(prefix, field, parent?.type === 'array');
    if (field.id === id) return { field, list: fields, index, parent, path, depth };
    const nested = childList(field);
    if (nested) {
      const found = locateField(nested, id, field, path, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
};

export const pathOfField = (fields: Field[], id: string) => locateField(fields, id)?.path;

export const findFieldById = (project: Project, fieldId: string) => {
  for (const collection of project.collections) {
    const location = locateField(collection.fields, fieldId);
    if (location) return { collection, ...location };
  }
  return undefined;
};

/** Changes a field's type, creating or dropping children and the element type as needed. */
export const setFieldType = (field: Field, type: FieldType) => {
  const previous = field.type;
  const previousChildren = field.children;
  field.type = type;
  if (type === 'object') {
    // An array of objects turned into an object keeps its children.
    field.children ??= previous === 'array' && field.items?.type === 'object' ? (field.items.children ?? []) : [];
  } else {
    delete field.children;
  }
  if (type === 'array') {
    if (!field.items) {
      field.items = createField({ name: '', type: previous === 'object' ? 'object' : 'string' });
      if (previous === 'object') field.items.children = previousChildren ?? [];
    }
  } else {
    delete field.items;
  }
  if (type === 'enum') field.enumValues ??= [];
  else delete field.enumValues;
  if (type !== 'string' && type !== 'enum') {
    delete field.minLength;
    delete field.maxLength;
    delete field.pattern;
  }
  if (!['int', 'long', 'double', 'decimal', 'number', 'date', 'timestamp'].includes(type)) {
    delete field.minimum;
    delete field.maximum;
    delete field.exclusiveMin;
  }
  if (type !== 'array') {
    delete field.minItems;
    delete field.maxItems;
    delete field.uniqueItems;
  }
  if (type !== 'reference' && type !== 'objectId' && type !== 'string') delete field.reference;
};

/** Element type of an array changes; an object element gets an empty children list. */
export const setItemsType = (field: Field, type: FieldType) => {
  field.items ??= createField({ name: '', type });
  setFieldType(field.items, type);
};

/** Adds a child to an object or an array of objects. Returns the new field. */
export const addChild = (parent: Field, child: Field) => {
  const list = ensureChildList(parent);
  if (!list) return undefined;
  list.push(child);
  return child;
};

export const moveField = (fields: Field[], id: string, delta: -1 | 1) => {
  const loc = locateField(fields, id);
  if (!loc) return false;
  const target = loc.index + delta;
  if (target < 0 || target >= loc.list.length) return false;
  [loc.list[loc.index], loc.list[target]] = [loc.list[target], loc.list[loc.index]];
  return true;
};

/** Moves a field inside the sibling above it, when that sibling can hold children. */
export const indentField = (fields: Field[], id: string) => {
  const loc = locateField(fields, id);
  if (!loc || loc.index === 0) return false;
  const previous = loc.list[loc.index - 1];
  if (previous.type !== 'object' && !(previous.type === 'array' && (!previous.items || previous.items.type === 'object'))) return false;
  const list = ensureChildList(previous);
  if (!list) return false;
  loc.list.splice(loc.index, 1);
  list.push(loc.field);
  return true;
};

/** Moves a field out of its parent, right after it. */
export const outdentField = (fields: Field[], id: string) => {
  const loc = locateField(fields, id);
  if (!loc?.parent) return false;
  const parentLoc = locateField(fields, loc.parent.id);
  if (!parentLoc) return false;
  loc.list.splice(loc.index, 1);
  parentLoc.list.splice(parentLoc.index + 1, 0, loc.field);
  return true;
};

export const removeField = (fields: Field[], id: string) => {
  const loc = locateField(fields, id);
  if (!loc) return undefined;
  loc.list.splice(loc.index, 1);
  return loc;
};

const replacePrefix = (path: string, from: string, to: string) => {
  if (path === from) return to;
  for (const sep of ['.', '[].']) if (path.startsWith(from + sep)) return to + path.slice(from.length);
  if (path.startsWith(`${from}[]`)) return to + path.slice(from.length);
  return undefined;
};

/** After a field's path changes, updates indexes, options and relationships that used it. */
export const renamePath = (project: Project, collectionId: string, from: string, to: string) => {
  if (from === to) return;
  const collection = project.collections.find((c) => c.id === collectionId);
  if (!collection) return;
  const swap = (path: string) => replacePrefix(path, from, to) ?? replacePrefix(path, toMongoPath(from), toMongoPath(to)) ?? path;
  for (const index of collection.indexes) for (const key of index.keys) key.path = swap(key.path);
  const { ttl, timeseries } = collection.options;
  if (ttl) ttl.field = swap(ttl.field);
  if (timeseries) {
    timeseries.timeField = swap(timeseries.timeField);
    if (timeseries.metaField) timeseries.metaField = swap(timeseries.metaField);
  }
  for (const rel of project.relationships) {
    if (rel.from.collectionId === collectionId) rel.from.fieldPath = swap(rel.from.fieldPath);
    if (rel.reverseFieldPath && rel.to.collectionId === collectionId) rel.reverseFieldPath = swap(rel.reverseFieldPath);
  }
  // References from other collections that point at a field of this one other than its id.
  for (const other of project.collections) {
    for (const { field } of walkFields(other.fields)) {
      for (const f of [field, field.items].filter(Boolean) as Field[]) {
        if (f.reference?.collectionId === collectionId) f.reference.fieldPath = swap(f.reference.fieldPath);
      }
    }
  }
};

/** Deep copy of fields with new ids, for duplicating collections and embedding. */
export const cloneFields = (fields: Field[]): Field[] =>
  fields.map((field) => {
    const copy: Field = { ...structuredClone(field), id: createField().id };
    if (field.children) copy.children = cloneFields(field.children);
    if (field.items) copy.items = cloneFields([field.items])[0];
    return copy;
  });

/** Deepest nesting of objects below the document root. */
export const maxDepth = (fields: Field[]): number => Math.max(0, ...walkFields(fields).map((e) => e.depth + 1));
