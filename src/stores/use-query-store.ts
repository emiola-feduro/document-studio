import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { EMPTY_QUERY, type QuerySpec } from '../domain/query-builder';

export type EditorSide = 'sql' | 'native';
export type EditorState = { side: EditorSide; text: string };
export type QueryMode = 'builder' | 'editor';

type QueryState = {
  /** Query being built per project, kept when leaving the tab and across reloads. */
  specs: Record<string, QuerySpec>;
  /** Text of the editor and which language it is written in, per project. */
  editors: Record<string, EditorState>;
  modes: Record<string, QueryMode>;
  setSpec: (projectId: string, update: (spec: QuerySpec) => QuerySpec) => void;
  setEditor: (projectId: string, editor: EditorState) => void;
  setMode: (projectId: string, mode: QueryMode) => void;
  forget: (projectId: string) => void;
};

const useQueryStore = create<QueryState>()(
  persist(
    (set) => ({
      specs: {},
      editors: {},
      modes: {},
      setSpec: (projectId, update) => set((s) => ({ specs: { ...s.specs, [projectId]: update(s.specs[projectId] ?? EMPTY_QUERY) } })),
      setEditor: (projectId, editor) => set((s) => ({ editors: { ...s.editors, [projectId]: editor } })),
      setMode: (projectId, mode) => set((s) => ({ modes: { ...s.modes, [projectId]: mode } })),
      forget: (projectId) =>
        set((s) => {
          const specs = { ...s.specs };
          const editors = { ...s.editors };
          const modes = { ...s.modes };
          delete specs[projectId];
          delete editors[projectId];
          delete modes[projectId];
          return { specs, editors, modes };
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
