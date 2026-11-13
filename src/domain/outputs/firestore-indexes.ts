import { t } from '../../i18n';
import { fieldAtPath, toMongoPath } from '../paths';
import type { Project } from '../types';
import { json, type OutputResult } from './shared';

type IndexField = { fieldPath: string; order?: 'ASCENDING' | 'DESCENDING'; arrayConfig?: 'CONTAINS' };

/** firestore.indexes.json: composite indexes, plus field overrides for exemptions, collection group scope and TTL. */
export const firestoreIndexes = (project: Project): OutputResult => {
  const warnings: string[] = [];
  const indexes: { collectionGroup: string; queryScope: string; fields: IndexField[] }[] = [];
  const fieldOverrides: Record<string, unknown>[] = [];

  for (const collection of project.collections) {
    for (const index of collection.indexes) {
      const keys = index.keys.filter((k) => k.path);
      if (keys.some((k) => typeof k.order === 'string')) {
        warnings.push(t('output.firestoreIndexKind', { name: index.name || keys.map((k) => k.path).join(', '), collection: collection.name }));
        continue;
      }
      if (index.unique) warnings.push(t('output.firestoreUnique', { collection: collection.name }));
      const scope = index.scope === 'collectionGroup' ? 'COLLECTION_GROUP' : 'COLLECTION';
      if (index.wildcard || keys.length === 1) {
        const path = toMongoPath(keys[0]?.path ?? '*');
        // A wildcard means "do not index this field": an exemption with no indexes.
        if (index.wildcard) fieldOverrides.push({ collectionGroup: collection.name, fieldPath: path, indexes: [] });
        else if (scope === 'COLLECTION_GROUP') {
          const field = fieldAtPath(collection.fields, keys[0].path);
          fieldOverrides.push({
            collectionGroup: collection.name,
            fieldPath: path,
            indexes: [
              { order: 'ASCENDING', queryScope: 'COLLECTION' },
              { order: 'DESCENDING', queryScope: 'COLLECTION' },
              ...(field?.type === 'array' ? [{ arrayConfig: 'CONTAINS', queryScope: 'COLLECTION_GROUP' }] : []),
              { order: keys[0].order === -1 ? 'DESCENDING' : 'ASCENDING', queryScope: 'COLLECTION_GROUP' },
            ],
          });
        }
        continue;
      }
      indexes.push({
        collectionGroup: collection.name,
        queryScope: scope,
        fields: keys.map((k) => {
          const field = fieldAtPath(collection.fields, k.path);
          const fieldPath = toMongoPath(k.path);
          return field?.type === 'array' ? { fieldPath, arrayConfig: 'CONTAINS' } : { fieldPath, order: k.order === -1 ? 'DESCENDING' : 'ASCENDING' };
        }),
      });
    }
    const { ttl } = collection.options;
    if (ttl?.field) fieldOverrides.push({ collectionGroup: collection.name, fieldPath: toMongoPath(ttl.field), ttl: true, indexes: [] });
  }
  return { code: json({ indexes, fieldOverrides }), warnings: [...new Set(warnings)] };
};
