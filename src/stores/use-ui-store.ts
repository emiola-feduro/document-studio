import { create } from 'zustand';

export type Selection = { kind: 'collection' | 'relationship'; id: string } | null;
export type CenterView = 'diagram';
export type Toast = { id: number; message: string; tone: 'info' | 'error' };

type UiState = {
  selection: Selection;
  view: CenterView;
  settingsOpen: boolean;
  newProjectOpen: boolean;
  sidebarOpen: boolean;
  /** Hides every panel and tool so only the diagram is left. */
  focusMode: boolean;
  /** Collection waiting for the person to confirm its deletion. */
  collectionToDelete: string | null;
  toasts: Toast[];
  select: (selection: Selection) => void;
  setView: (view: CenterView) => void;
  setSettingsOpen: (open: boolean) => void;
  setNewProjectOpen: (open: boolean) => void;
  setSidebarOpen: (open: boolean) => void;
  setFocusMode: (on: boolean) => void;
  requestDeleteCollection: (id: string | null) => void;
  notify: (message: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;
};

let toastId = 0;

const useUiStore = create<UiState>((set, get) => ({
  selection: null,
  view: 'diagram',
  settingsOpen: false,
  newProjectOpen: false,
  sidebarOpen: false,
  focusMode: false,
  collectionToDelete: null,
  toasts: [],
  select: (selection) => set({ selection }),
  setView: (view) => set({ view }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setNewProjectOpen: (newProjectOpen) => set({ newProjectOpen }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setFocusMode: (focusMode) => set(focusMode ? { focusMode, view: 'diagram' } : { focusMode }),
  requestDeleteCollection: (collectionToDelete) => set({ collectionToDelete }),
  notify: (message, tone = 'info') => {
    toastId += 1;
    const id = toastId;
    set({ toasts: [...get().toasts, { id, message, tone }] });
    setTimeout(() => get().dismissToast(id), 4000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export default useUiStore;
