import { t } from '../i18n';
import { convertType, ENGINES } from './engines';
import { createField } from './model';
import { walkFields } from './paths';
import type { EngineId, Field, Project } from './types';

/**
 * Moves a project to another engine: converts field types, swaps the id fields and turns
 * subcollections into collections where the engine has none. Returns what could not be kept as is.
 */
export const changeEngine = (project: Project, engine: EngineId): string[] => {
  if (project.engine === engine) return [];
  const warnings: string[] = [];
  const from = ENGINES[project.engine];
  const to = ENGINES[engine];
  const oldSystem = new Set(from.systemFields.map((f) => f.name));

  for (const collection of project.collections) {
    // Id fields of the old engine go; the new engine's are added in front.
    collection.fields = collection.fields.filter((f) => !(oldSystem.has(f.name) && f.required));
    const system = to.systemFields
      .filter((s) => !collection.fields.some((f) => f.name === s.name))
      .map((s) => createField({ name: s.name, type: s.type, required: true }));
    collection.fields.unshift(...system);

    const convert = (field: Field, path: string) => {
      if (field.reference) {
        field.type = engine === 'mongodb' ? 'objectId' : to.referenceType;
        field.reference.fieldPath = engine === 'firestore' ? '__name__' : '_id';
        return;
      }
      const { type, lossy } = convertType(engine, field.type);
      if (type !== field.type) {
        if (lossy) warnings.push(t('engine.lossyType', { collection: collection.name, path, from: field.type, to: type }));
        field.type = type;
      }
    };
    for (const { field, path } of walkFields(collection.fields)) {
      convert(field, path);
      if (field.items) {
        convert(field.items, `${path}[]`);
        if (!to.nestedArrays && field.items.type === 'array') {
          warnings.push(t('engine.nestedArray', { collection: collection.name, path }));
        }
      }
    }

    if (collection.kind === 'subcollection' && !to.subcollections) {
      const parent = project.collections.find((c) => c.id === collection.parentId);
      warnings.push(t('engine.subcollection', { name: collection.name, parent: parent?.name ?? '?' }));
      collection.kind = 'collection';
      delete collection.parentId;
    }
    const { options } = collection;
    if (engine !== 'mongodb' && (options.capped || options.timeseries || options.validationLevel)) {
      warnings.push(t('engine.mongoOptions', { name: collection.name }));
      delete options.capped;
      delete options.timeseries;
      delete options.validationLevel;
      delete options.validationAction;
    }
    for (const index of collection.indexes) {
      const unsupported = index.keys.some((k) => typeof k.order === 'string');
      if (engine !== 'mongodb' && unsupported) warnings.push(t('engine.indexKind', { name: index.name, collection: collection.name }));
      if (engine !== 'firestore') delete index.scope;
    }
  }
  project.engine = engine;
  return warnings;
};
