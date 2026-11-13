import { t } from '../i18n';
import { changeEngine } from '../domain/engine-change';
import { ENGINES } from '../domain/engines';
import { createCollection, createField, duplicateCollection as duplicate, nextName, removeCollection, uid } from '../domain/model';
import {
  addChild,
  fieldAtPath,
  indentField,
  locateField,
  moveField as move,
  outdentField,
  removeField as remove,
  renamePath,
  setFieldType,
  setItemsType,
} from '../domain/paths';
import { createRelationship, rebuildRelationshipField, removeRelationship, type RelationshipInput } from '../domain/relationships';
import { generateDocuments, generateAllDocuments } from '../domain/random-values';
import type { Collection, CollectionOptions, DocIndex, EngineId, Field, FieldType, Project, Relationship, SampleDocument } from '../domain/types';
import usePreferencesStore from '../stores/use-preferences-store';
import useProjectStore from '../stores/use-project-store';
import useUiStore from '../stores/use-ui-store';
import { layoutMeasured } from './layout';

const mutate = (change: (draft: Project) => void, key?: string) => useProjectStore.getState().mutate(change, key);

const collectionIn = (project: Project, id: string) => project.collections.find((c) => c.id === id);

/** Collection that the field lives in, plus where. */
const fieldIn = (project: Project, collectionId: string, fieldId: string) => {
  const collection = collectionIn(project, collectionId);
  if (!collection) return undefined;
  const loc = locateField(collection.fields, fieldId);
  return loc ? { collection, ...loc } : undefined;
};

/* Collections */

/** Adds a collection with a free default name and selects it. */
export const addCollection = (position?: { x: number; y: number }, parentId?: string) => {
  const { project } = useProjectStore.getState();
  if (!project) return;
  const name = nextName(t('collection.defaultName'), project.collections.filter((c) => c.parentId === parentId).map((c) => c.name));
  const parent = parentId ? collectionIn(project, parentId) : undefined;
  const fallback = parent
    ? { x: parent.position.x + 60, y: parent.position.y + 260 }
    : { x: 80 + (project.collections.length % 4) * 340, y: 80 + Math.floor(project.collections.length / 4) * 300 };
  const collection = createCollection(project.engine, name, position ?? fallback);
  if (parent) {
    collection.kind = 'subcollection';
    collection.parentId = parent.id;
  }
  if (project.engine === 'couchdb') collection.options.typeDiscriminator = { field: 'type', value: name };
  mutate((draft) => {
    draft.collections.push(collection);
  });
  useUiStore.getState().select({ kind: 'collection', id: collection.id });
  return collection.id;
};

export const updateCollection = (id: string, change: (c: Collection) => void, key?: string) =>
  mutate((draft) => {
    const collection = collectionIn(draft, id);
    if (collection) change(collection);
  }, key);

export const renameCollection = (id: string, name: string) =>
  updateCollection(
    id,
    (c) => {
      // CouchDB's type value follows the name while it was never set by hand.
      if (c.options.typeDiscriminator && c.options.typeDiscriminator.value === c.name) c.options.typeDiscriminator.value = name;
      c.name = name;
    },
    `collection-name:${id}`,
  );

export const setCollectionOptions = (id: string, change: (o: CollectionOptions) => void, key?: string) => updateCollection(id, (c) => change(c.options), key);

export const moveCollections = (moves: { id: string; position: { x: number; y: number } }[]) =>
  mutate((draft) => {
    for (const { id, position } of moves) {
      const collection = collectionIn(draft, id);
      if (collection) collection.position = { x: Math.round(position.x), y: Math.round(position.y) };
    }
  });

/** Deletes a collection once the person has confirmed it. */
export const deleteCollection = (id: string) => {
  mutate((draft) => removeCollection(draft, id));
  const ui = useUiStore.getState();
  if (ui.selection?.id === id) ui.select(null);
};

export const duplicateCollection = (id: string) => {
  const { project } = useProjectStore.getState();
  const source = project && collectionIn(project, id);
  if (!project || !source) return;
  let copyId: string | undefined;
  mutate((draft) => {
    const name = nextName(t('collection.copyName', { name: source.name }), draft.collections.map((c) => c.name));
    copyId = duplicate(draft, id, name)?.id;
  });
  if (copyId) useUiStore.getState().select({ kind: 'collection', id: copyId });
};

/** Delete key: collections ask first, relationships go right away (Undo brings them back). */
export const deleteSelection = () => {
  const ui = useUiStore.getState();
  const selection = ui.selection;
  if (!selection) return;
  if (selection.kind === 'collection') {
    ui.requestDeleteCollection(selection.id);
    return;
  }
  mutate((draft) => removeRelationship(draft, selection.id, false));
  ui.select(null);
};

export const setEngine = (engine: EngineId) => {
  const { project } = useProjectStore.getState();
  if (!project || project.engine === engine) return;
  let warnings: string[] = [];
  mutate((draft) => {
    warnings = changeEngine(draft, engine);
  });
  const { notify } = useUiStore.getState();
  notify(t('engine.changed', { engine: ENGINES[engine].name }));
  for (const warning of warnings.slice(0, 4)) notify(warning, 'error');
  if (warnings.length > 4) notify(t('engine.moreWarnings', { count: warnings.length - 4 }), 'error');
};

export const setDatabaseName = (name: string) =>
  mutate((draft) => {
    if (name.trim()) draft.databaseName = name;
    else delete draft.databaseName;
  }, 'database-name');

/** Lays out every collection with dagre, using measured sizes when the canvas has them. */
export const arrangeCollections = (sizes: Map<string, { width: number; height: number }>) => {
  const { project } = useProjectStore.getState();
  if (!project) return;
  const positions = layoutMeasured(project, sizes);
  moveCollections([...positions].map(([id, position]) => ({ id, position })));
};

/* Fields */

export const addField = (collectionId: string, parentFieldId?: string) => {
  let id: string | undefined;
  mutate((draft) => {
    const collection = collectionIn(draft, collectionId);
    if (!collection) return;
    const parent = parentFieldId ? locateField(collection.fields, parentFieldId)?.field : undefined;
    const siblings = parent ? (parent.type === 'object' ? (parent.children ?? []) : (parent.items?.children ?? [])) : collection.fields;
    const field = createField({ name: nextName(t('field.defaultName'), siblings.map((f) => f.name)) });
    if (parent) {
      if (addChild(parent, field)) id = field.id;
    } else {
      collection.fields.push(field);
      id = field.id;
    }
  });
  if (id) useUiStore.getState().setFieldFocus({ collectionId, fieldId: id });
  return id;
};

export const updateField = (collectionId: string, fieldId: string, change: (f: Field) => void, key?: string) =>
  mutate((draft) => {
    const loc = fieldIn(draft, collectionId, fieldId);
    if (loc) change(loc.field);
  }, key ?? `field:${fieldId}`);

/** Renames a field and every index, option and relationship that used its path. */
export const renameField = (collectionId: string, fieldId: string, name: string) =>
  mutate((draft) => {
    const loc = fieldIn(draft, collectionId, fieldId);
    if (!loc) return;
    const before = loc.path;
    loc.field.name = name;
    const after = fieldIn(draft, collectionId, fieldId)!.path;
    renamePath(draft, collectionId, before, after);
  }, `field-name:${fieldId}`);

export const changeFieldType = (collectionId: string, fieldId: string, type: FieldType) =>
  mutate((draft) => {
    const loc = fieldIn(draft, collectionId, fieldId);
    if (loc) setFieldType(loc.field, type);
  });

export const changeItemsType = (collectionId: string, fieldId: string, type: FieldType) =>
  mutate((draft) => {
    const loc = fieldIn(draft, collectionId, fieldId);
    if (loc) setItemsType(loc.field, type);
  });

export const moveField = (collectionId: string, fieldId: string, delta: -1 | 1) =>
  mutate((draft) => {
    const c = collectionIn(draft, collectionId);
    if (c) move(c.fields, fieldId, delta);
  });

/** Indent puts the field inside the object above it; outdent takes it out of its parent. Paths change with it. */
export const nestField = (collectionId: string, fieldId: string, direction: 'in' | 'out') =>
  mutate((draft) => {
    const c = collectionIn(draft, collectionId);
    if (!c) return;
    const before = locateField(c.fields, fieldId)?.path;
    const done = direction === 'in' ? indentField(c.fields, fieldId) : outdentField(c.fields, fieldId);
    const after = locateField(c.fields, fieldId)?.path;
    if (done && before && after) renamePath(draft, collectionId, before, after);
  });

export const deleteField = (collectionId: string, fieldId: string) =>
  mutate((draft) => {
    const c = collectionIn(draft, collectionId);
    if (!c) return;
    const loc = locateField(c.fields, fieldId);
    if (!loc) return;
    // Relationships stored in this field go with it.
    draft.relationships = draft.relationships.filter(
      (r) => !(r.from.collectionId === collectionId && (r.from.fieldPath === loc.path || r.from.fieldPath.startsWith(`${loc.path}.`) || r.from.fieldPath.startsWith(`${loc.path}[]`))),
    );
    remove(c.fields, fieldId);
  });

/** Converts every field name of a collection to camelCase or snake_case, keeping paths in sync. */
export const convertFieldNames = (collectionId: string, convert: (name: string) => string) =>
  mutate((draft) => {
    const c = collectionIn(draft, collectionId);
    if (!c) return;
    const system = new Set(ENGINES[draft.engine].systemFields.map((f) => f.name));
    const walk = (fields: Field[]) => {
      for (const field of fields) {
        if (field.name && !system.has(field.name)) {
          const before = locateField(c.fields, field.id)!.path;
          field.name = convert(field.name);
          renamePath(draft, collectionId, before, locateField(c.fields, field.id)!.path);
        }
        if (field.children) walk(field.children);
        if (field.items?.children) walk(field.items.children);
      }
    };
    walk(c.fields);
  });

/* Indexes */

export const addIndex = (collectionId: string, path = '') => {
  const index: DocIndex = { id: uid(), name: '', nameIsCustom: false, keys: [{ path, order: 1 }] };
  updateCollection(collectionId, (c) => c.indexes.push(index));
  return index.id;
};

export const updateIndex = (collectionId: string, indexId: string, change: (i: DocIndex) => void, key?: string) =>
  updateCollection(
    collectionId,
    (c) => {
      const index = c.indexes.find((i) => i.id === indexId);
      if (index) change(index);
    },
    key,
  );

export const deleteIndex = (collectionId: string, indexId: string) => updateCollection(collectionId, (c) => (c.indexes = c.indexes.filter((i) => i.id !== indexId)));

/* Relationships */

export const addRelationship = (input: RelationshipInput) => {
  let rel: Relationship | undefined;
  mutate((draft) => {
    rel = createRelationship(draft, input);
    // References are what queries filter by; index them where the engine needs it.
    if (rel?.kind === 'reference' && draft.engine !== 'firestore') {
      const from = collectionIn(draft, rel.from.collectionId);
      const keys = [{ path: rel.from.fieldPath, order: 1 as const }];
      from?.indexes.push({ id: uid(), name: '', nameIsCustom: false, keys });
    }
  });
  if (rel) useUiStore.getState().select({ kind: 'relationship', id: rel.id });
  return rel;
};

export const updateRelationship = (id: string, change: (r: Relationship) => void, rebuild = false) =>
  mutate((draft) => {
    const rel = draft.relationships.find((r) => r.id === id);
    if (!rel) return;
    change(rel);
    if (rebuild) rebuildRelationshipField(draft, id);
  }, rebuild ? undefined : `relationship:${id}`);

export const deleteRelationship = (id: string, removeFields: boolean) => {
  mutate((draft) => removeRelationship(draft, id, removeFields));
  const ui = useUiStore.getState();
  if (ui.selection?.id === id) ui.select(null);
};

/** Dragging a field row onto another collection. Alt makes it an embed. */
export const linkFieldTo = (collectionId: string, fieldId: string, targetId: string, embed: boolean) => {
  const { project } = useProjectStore.getState();
  const loc = project && fieldIn(project, collectionId, fieldId);
  const target = project && collectionIn(project, targetId);
  if (!project || !loc || !target) return;
  if (embed) {
    addRelationship({ kind: 'embed', fromId: collectionId, toId: targetId, cardinality: '1:N' });
    return;
  }
  const isTopLevel = !loc.parent;
  if (!isTopLevel) {
    // Nested fields keep their place; only the reference is recorded.
    mutate((draft) => {
      const l = fieldIn(draft, collectionId, fieldId);
      if (!l) return;
      const holder = l.field.type === 'array' ? (l.field.items ??= createField({ name: '', type: ENGINES[draft.engine].referenceType })) : l.field;
      holder.type = draft.engine === 'mongodb' ? 'objectId' : ENGINES[draft.engine].referenceType;
      holder.reference = { collectionId: targetId, fieldPath: draft.engine === 'firestore' ? '__name__' : '_id' };
      draft.relationships.push({
        id: uid(),
        kind: 'reference',
        from: { collectionId, fieldPath: l.path },
        to: { collectionId: targetId },
        cardinality: l.field.type === 'array' ? 'N:M' : '1:N',
        storage: l.field.type === 'array' ? 'array' : 'single',
      });
    });
    return;
  }
  // A top level field becomes the reference: replace it in place with the right type.
  mutate((draft) => {
    const l = fieldIn(draft, collectionId, fieldId);
    if (!l) return;
    const array = l.field.type === 'array';
    const engine = ENGINES[draft.engine];
    const refType = draft.engine === 'mongodb' ? 'objectId' : engine.referenceType;
    const reference = { collectionId: targetId, fieldPath: draft.engine === 'firestore' ? '__name__' : '_id' };
    if (array) l.field.items = { ...(l.field.items ?? createField({ name: '' })), type: refType, reference, children: undefined };
    else {
      setFieldType(l.field, refType);
      l.field.reference = reference;
    }
    const rel: Relationship = {
      id: uid(),
      kind: 'reference',
      from: { collectionId, fieldPath: l.path },
      to: { collectionId: targetId },
      cardinality: array ? 'N:M' : '1:N',
      storage: array ? 'array' : 'single',
    };
    draft.relationships = draft.relationships.filter((r) => !(r.from.collectionId === collectionId && r.from.fieldPath === l.path));
    draft.relationships.push(rel);
    if (draft.engine !== 'firestore') {
      const c = collectionIn(draft, collectionId)!;
      if (!c.indexes.some((i) => i.keys[0]?.path === l.path)) c.indexes.push({ id: uid(), name: '', nameIsCustom: false, keys: [{ path: l.path, order: 1 }] });
    }
  });
  useUiStore.getState().notify(t('canvas.referenceCreated', { name: loc.field.name, target: target.name }));
};

/* Documents */

export const setDocuments = (collectionId: string, docs: SampleDocument[], key?: string) =>
  mutate((draft) => {
    draft.documents ??= {};
    draft.documents[collectionId] = docs;
  }, key);

export const updateDocument = (collectionId: string, docId: string, json: string) =>
  mutate((draft) => {
    const doc = draft.documents?.[collectionId]?.find((d) => d.id === docId);
    if (doc) doc.json = json;
  }, `doc:${docId}`);

export const addDocument = (collectionId: string, json = '{}') => {
  const doc = { id: uid(), json };
  mutate((draft) => {
    draft.documents ??= {};
    (draft.documents[collectionId] ??= []).push(doc);
  });
  return doc.id;
};

export const deleteDocument = (collectionId: string, docId: string) =>
  mutate((draft) => {
    const docs = draft.documents?.[collectionId];
    if (docs) draft.documents![collectionId] = docs.filter((d) => d.id !== docId);
  });

/** Random documents for one collection, appended to its samples. Returns how many were added. */
export const addRandomDocuments = (collectionId: string, count: number, maxArray?: number) => {
  const { project } = useProjectStore.getState();
  if (!project) return 0;
  const locale = usePreferencesStore.getState().locale;
  const docs = generateDocuments(project, collectionId, { count, locale, maxArray });
  mutate((draft) => {
    draft.documents ??= {};
    draft.documents[collectionId] = [...(draft.documents[collectionId] ?? []), ...docs];
  });
  return docs.length;
};

/** Random documents for every collection, referenced ones first. */
export const addRandomDocumentsEverywhere = (count: number, maxArray?: number) => {
  const { project } = useProjectStore.getState();
  if (!project) return;
  const locale = usePreferencesStore.getState().locale;
  const generated = generateAllDocuments(project, { count, locale, maxArray });
  mutate((draft) => {
    draft.documents ??= {};
    for (const [id, docs] of Object.entries(generated)) draft.documents[id] = [...(draft.documents[id] ?? []), ...docs];
  });
};

/* Import */

export const addCollections = (collections: Collection[], relationships: Relationship[], documents: Record<string, SampleDocument[]>) =>
  mutate((draft) => {
    for (const c of collections) {
      c.name = nextName(c.name, draft.collections.map((x) => x.name));
      draft.collections.push(c);
    }
    draft.relationships.push(...relationships);
    draft.documents ??= {};
    Object.assign(draft.documents, documents);
  });

export const pathExists = (project: Project, collectionId: string, path: string) => {
  const c = collectionIn(project, collectionId);
  return Boolean(c && fieldAtPath(c.fields, path));
};
