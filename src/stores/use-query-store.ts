import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { EMPTY_QUERY, type QuerySpec } from '../domain/query-builder';

type QueryState = {
  /** Query being built per project, kept when leaving the tab and across reloads. */
  specs: Record<string, QuerySpec>;
  setSpec: (projectId: string, update: (spec: QuerySpec) => QuerySpec) => void;
  forget: (projectId: string) => void;
};

const useQueryStore = create<QueryState>()(
  persist(
    (set) => ({
      specs: {},
      setSpec: (projectId, update) => set((s) => ({ specs: { ...s.specs, [projectId]: update(s.specs[projectId] ?? EMPTY_QUERY) } })),
      forget: (projectId) =>
        set((s) => {
          const specs = { ...s.specs };
          delete specs[projectId];
          return { specs };
        }),
    }),
    {
      name: 'document-studio:queries',
      storage: createJSONStorage(() => {
        try {
          return localStorage;
        } catch {
          return sessionStorage;
        }
      }),
      version: 1,
    },
  ),
);

export default useQueryStore;
