import { create } from 'zustand';

export type Selection = { kind: 'collection' | 'relationship'; id: string } | null;
export type CenterView = 'diagram' | 'schema' | 'documents' | 'query';
/** Right-click menu on the canvas. Without a collection id it is the menu of the empty canvas. */
export type ContextMenuState = { x: number; y: number; collectionId?: string; flowPosition?: { x: number; y: number } };
export type Toast = { id: number; message: string; tone: 'info' | 'error' };
export type FieldFocus = { collectionId: string; fieldId: string } | null;
export type ImportTab = 'documents' | 'jsonSchema' | 'firestoreIndexes';

type UiState = {
  selection: Selection;
  /** Field open in the inspector's details panel. */
  fieldFocus: FieldFocus;
  view: CenterView;
  settingsOpen: boolean;
  newProjectOpen: boolean;
  newProjectStart: 'empty' | 'random';
  sidebarOpen: boolean;
  /** Hides every panel and tool so only the diagram is left. */
  focusMode: boolean;
  contextMenu: ContextMenuState | null;
  relationshipDialog: { open: boolean; fromId?: string; toId?: string; kind?: 'embed' | 'reference' };
  agentExport: { open: boolean; collectionId?: string };
  openApiExportOpen: boolean;
  importDialog: { open: boolean; tab: ImportTab };
  documentsCollectionId: string | null;
  showRelationshipLabels: boolean;
  /** Object and array fields folded in the diagram, by field id. */
  collapsedFields: Record<string, true>;
  hoveredRelationshipId: string | null;
  /** Collection waiting for the person to confirm its deletion. */
  collectionToDelete: string | null;
  toasts: Toast[];
  select: (selection: Selection) => void;
  setFieldFocus: (focus: FieldFocus) => void;
  setView: (view: CenterView) => void;
  setSettingsOpen: (open: boolean) => void;
  setNewProjectOpen: (open: boolean, start?: 'empty' | 'random') => void;
  setNewProjectStart: (start: 'empty' | 'random') => void;
  setSidebarOpen: (open: boolean) => void;
  setFocusMode: (on: boolean) => void;
  openContextMenu: (menu: ContextMenuState) => void;
  closeContextMenu: () => void;
  openRelationshipDialog: (init?: { fromId?: string; toId?: string; kind?: 'embed' | 'reference' }) => void;
  closeRelationshipDialog: () => void;
  openAgentExport: (collectionId?: string) => void;
  closeAgentExport: () => void;
  setOpenApiExportOpen: (open: boolean) => void;
  openImport: (tab?: ImportTab) => void;
  closeImport: () => void;
  showDocuments: (collectionId: string | null) => void;
  setDocumentsCollection: (id: string | null) => void;
  toggleRelationshipLabels: () => void;
  toggleCollapsed: (fieldId: string) => void;
  setHoveredRelationship: (id: string | null) => void;
  requestDeleteCollection: (id: string | null) => void;
  notify: (message: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;
};

let toastId = 0;

const useUiStore = create<UiState>((set, get) => ({
  selection: null,
  fieldFocus: null,
  view: 'diagram',
  settingsOpen: false,
  newProjectOpen: false,
  newProjectStart: 'empty',
  sidebarOpen: false,
  focusMode: false,
  contextMenu: null,
  relationshipDialog: { open: false },
  agentExport: { open: false },
  openApiExportOpen: false,
  importDialog: { open: false, tab: 'documents' },
  documentsCollectionId: null,
  showRelationshipLabels: true,
  collapsedFields: {},
  hoveredRelationshipId: null,
  collectionToDelete: null,
  toasts: [],
  select: (selection) => set({ selection, ...(selection?.kind === 'collection' ? {} : { fieldFocus: null }) }),
  setFieldFocus: (fieldFocus) => set(fieldFocus ? { fieldFocus, selection: { kind: 'collection', id: fieldFocus.collectionId } } : { fieldFocus }),
  setView: (view) => set({ view, contextMenu: null }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setNewProjectOpen: (newProjectOpen, newProjectStart = 'empty') => set(newProjectOpen ? { newProjectOpen, newProjectStart } : { newProjectOpen }),
  setNewProjectStart: (newProjectStart) => set({ newProjectStart }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setFocusMode: (focusMode) => set(focusMode ? { focusMode, view: 'diagram', contextMenu: null } : { focusMode }),
  openContextMenu: (contextMenu) => set({ contextMenu }),
  closeContextMenu: () => set({ contextMenu: null }),
  openRelationshipDialog: (init = {}) => set({ relationshipDialog: { open: true, ...init }, contextMenu: null }),
  closeRelationshipDialog: () => set({ relationshipDialog: { open: false } }),
  openAgentExport: (collectionId) => set({ agentExport: { open: true, collectionId }, contextMenu: null }),
  closeAgentExport: () => set({ agentExport: { open: false } }),
  setOpenApiExportOpen: (openApiExportOpen) => set({ openApiExportOpen }),
  openImport: (tab = 'documents') => set({ importDialog: { open: true, tab } }),
  closeImport: () => set({ importDialog: { open: false, tab: get().importDialog.tab } }),
  showDocuments: (documentsCollectionId) => set({ documentsCollectionId, view: 'documents', focusMode: false, contextMenu: null }),
  setDocumentsCollection: (documentsCollectionId) => set({ documentsCollectionId }),
  toggleRelationshipLabels: () => set({ showRelationshipLabels: !get().showRelationshipLabels }),
  toggleCollapsed: (fieldId) => {
    const next = { ...get().collapsedFields };
    if (next[fieldId]) delete next[fieldId];
    else next[fieldId] = true;
    set({ collapsedFields: next });
  },
  setHoveredRelationship: (hoveredRelationshipId) => set({ hoveredRelationshipId }),
  requestDeleteCollection: (collectionToDelete) => set({ collectionToDelete, contextMenu: null }),
  notify: (message, tone = 'info') => {
    toastId += 1;
    const id = toastId;
    set({ toasts: [...get().toasts, { id, message, tone }] });
    setTimeout(() => get().dismissToast(id), tone === 'error' ? 6000 : 4000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export default useUiStore;
