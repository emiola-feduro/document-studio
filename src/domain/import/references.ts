import { walkFields } from '../paths';
import { uid } from '../model';
import type { Collection, Relationship } from '../types';

/** One reference relationship per field that points at another collection, as the diagram draws them. */
export const relationshipsFromFields = (collections: Collection[]): Relationship[] =>
  collections.flatMap((collection) =>
    walkFields(collection.fields).flatMap(({ path, field, inArray }) => {
      const holder = field.type === 'array' ? field.items : field;
      const target = holder?.reference?.collectionId;
      if (!target || !collections.some((c) => c.id === target)) return [];
      const many = field.type === 'array';
      return [
        {
          id: uid(),
          kind: 'reference' as const,
          from: { collectionId: collection.id, fieldPath: path },
          to: { collectionId: target },
          cardinality: many ? ('N:M' as const) : inArray ? ('N:M' as const) : ('1:N' as const),
          storage: many ? ('array' as const) : ('single' as const),
        },
      ];
    }),
  );
