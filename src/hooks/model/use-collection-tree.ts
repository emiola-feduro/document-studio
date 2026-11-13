import { useMemo } from 'react';
import type { Collection } from '../../domain/types';
import useProjectStore from '../../stores/use-project-store';

export type CollectionTreeItem = { collection: Collection; depth: number };

/** Collections in display order: each subcollection right after its parent, one level deeper. */
const useCollectionTree = (): CollectionTreeItem[] => {
  const collections = useProjectStore((s) => s.project?.collections);

  return useMemo(() => {
    if (!collections) return [];
    const ids = new Set(collections.map((c) => c.id));
    const out: CollectionTreeItem[] = [];
    const walk = (parentId: string | undefined, depth: number) => {
      for (const collection of collections) {
        const isRoot = !collection.parentId || !ids.has(collection.parentId);
        if (parentId === undefined ? isRoot : collection.parentId === parentId) {
          out.push({ collection, depth });
          walk(collection.id, depth + 1);
        }
      }
    };
    walk(undefined, 0);
    return out;
  }, [collections]);
};

export default useCollectionTree;
