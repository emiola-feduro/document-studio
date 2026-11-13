import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { DEFAULT_LOCALE, isLocale, setLocale, t, type Locale, type MessageKey } from '../i18n';
import { DEFAULT_THEME_ID } from '../lib/themes/themes';

export type TextSize = 'sm' | 'md' | 'lg';
export type PanelId = 'header' | 'projects' | 'collections' | 'relationships' | 'inspector';

/** Panels that can be hidden. `shortcut` is the digit used with Alt to toggle each one. */
export const PANELS: { id: PanelId; label: MessageKey; shortcut: string }[] = [
  { id: 'projects', label: 'panels.projects', shortcut: '1' },
  { id: 'collections', label: 'panels.collections', shortcut: '2' },
  { id: 'relationships', label: 'panels.relationships', shortcut: '3' },
  { id: 'inspector', label: 'panels.inspector', shortcut: '4' },
  { id: 'header', label: 'panels.header', shortcut: '5' },
];

export const panelShortcut = (id: PanelId) => `Alt+${PANELS.find((p) => p.id === id)!.shortcut}`;

type PreferencesState = {
  locale: Locale;
  themeId: string;
  uiFontId: string;
  canvasFontId: string;
  codeFontId: string;
  textSize: TextSize;
  /** Width in pixels of each resizable side panel (wide screens only). */
  panelWidths: Record<ResizablePanel, number>;
  hiddenPanels: Partial<Record<PanelId, boolean>>;
  setLocale: (locale: Locale) => void;
  setTheme: (id: string) => void;
  setUiFont: (id: string) => void;
  setCanvasFont: (id: string) => void;
  setCodeFont: (id: string) => void;
  setTextSize: (size: TextSize) => void;
  setPanelWidth: (panel: ResizablePanel, width: number) => void;
  setPanelHidden: (id: PanelId, hidden: boolean) => void;
};

export type ResizablePanel = 'sidebar' | 'inspector';

export const PANEL_WIDTHS: Record<ResizablePanel, { min: number; max: number; default: number }> = {
  sidebar: { min: 200, max: 520, default: 272 },
  inspector: { min: 320, max: 760, default: 410 },
};

/** localStorage can throw in private windows; preferences then just do not persist. */
const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      /* ignore */
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch {
      /* ignore */
    }
  },
};

const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      locale: DEFAULT_LOCALE,
      // The i18n module reads the language synchronously, so it changes before components re-render.
      setLocale: (locale) => {
        setLocale(locale);
        set({ locale });
      },
      themeId: DEFAULT_THEME_ID,
      uiFontId: 'system',
      canvasFontId: 'system',
      codeFontId: 'jetbrains-mono',
      textSize: 'md',
      panelWidths: { sidebar: PANEL_WIDTHS.sidebar.default, inspector: PANEL_WIDTHS.inspector.default },
      hiddenPanels: {},
      setTheme: (themeId) => set({ themeId }),
      setUiFont: (uiFontId) => set({ uiFontId }),
      setCanvasFont: (canvasFontId) => set({ canvasFontId }),
      setCodeFont: (codeFontId) => set({ codeFontId }),
      setTextSize: (textSize) => set({ textSize }),
      setPanelWidth: (panel, width) => {
        const { min, max } = PANEL_WIDTHS[panel];
        set((s) => ({ panelWidths: { ...s.panelWidths, [panel]: Math.round(Math.min(max, Math.max(min, width))) } }));
      },
      setPanelHidden: (id, hidden) => set((s) => ({ hiddenPanels: { ...s.hiddenPanels, [id]: hidden } })),
    }),
    {
      name: 'document-studio:preferences',
      storage: createJSONStorage(() => safeStorage),
      version: 1,
      // Later versions translate older saved shapes here.
      migrate: (persisted) => persisted as PreferencesState,
      onRehydrateStorage: () => (state) => {
        if (state && !isLocale(state.locale)) state.locale = DEFAULT_LOCALE;
        if (state) setLocale(state.locale);
      },
    },
  ),
);

setLocale(usePreferencesStore.getState().locale);

/** Label of a panel in the current language. */
export const panelLabel = (id: PanelId) => t(PANELS.find((p) => p.id === id)!.label);

export default usePreferencesStore;
