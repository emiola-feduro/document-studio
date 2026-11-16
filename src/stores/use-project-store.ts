import { t } from '../i18n';
import { create } from 'zustand';
import { createProject as newProject, uid } from '../domain/model';
import type { EngineId, Project, ProjectMeta } from '../domain/types';
import * as db from '../lib/db';
import { createSampleProject } from '../lib/sample-project';

const HISTORY_LIMIT = 100;
const COALESCE_MS = 1000;
const SAVE_DELAY_MS = 400;

export type LoadStatus = 'loading' | 'ready' | 'error';
export type SaveStatus = 'saved' | 'saving' | 'error';

type ProjectState = {
  status: LoadStatus;
  error?: string;
  saveStatus: SaveStatus;
  projects: ProjectMeta[];
  project: Project | null;
  past: Project[];
  future: Project[];
  lastKey?: string;
  lastAt: number;

  init: () => Promise<void>;
  openProject: (id: string) => Promise<void>;
  createProject: (name: string, engine: EngineId, databaseName?: string) => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
  duplicateProject: (id: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  importProject: (project: Project) => Promise<void>;
  /** Applies a change to the open project. Changes with the same key in quick succession share one undo step. */
  mutate: (change: (draft: Project) => void, key?: string) => void;
  undo: () => void;
  redo: () => void;
};

let saveTimer: ReturnType<typeof setTimeout> | undefined;

const LAST_OPEN_KEY = 'document-studio:last-project';

const rememberLastOpen = (id: string) => {
  try {
    localStorage.setItem(LAST_OPEN_KEY, id);
  } catch {
    /* storage may be unavailable */
  }
};

const readLastOpen = () => {
  try {
    return localStorage.getItem(LAST_OPEN_KEY);
  } catch {
    return null;
  }
};

const PENDING_KEY = 'document-studio:pending-save';

const stashPending = (project: Project) => {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(project));
  } catch {
    /* storage may be full or unavailable */
  }
};

/** The copy left by a page that closed before its save finished, removed once read. */
const takePending = (): Project | null => {
  try {
    const text = localStorage.getItem(PENDING_KEY);
    localStorage.removeItem(PENDING_KEY);
    return text ? (JSON.parse(text) as Project) : null;
  } catch {
    return null;
  }
};

const useProjectStore = create<ProjectState>((set, get) => {
  const scheduleSave = () => {
    set({ saveStatus: 'saving' });
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const { project } = get();
      if (!project) return;
      try {
        await db.saveProject(project);
        set({ saveStatus: 'saved', projects: await db.listProjects() });
      } catch {
        set({ saveStatus: 'error' });
      }
    }, SAVE_DELAY_MS);
  };

  const flushSave = async () => {
    clearTimeout(saveTimer);
    const { project, saveStatus } = get();
    if (project && saveStatus === 'saving') await db.saveProject(project);
  };

  // A reload or a closed tab would lose the changes still waiting for the debounced save. The browser
  // may cancel an IndexedDB write while the page unloads, so a synchronous copy goes to localStorage too.
  const saveBeforeLeaving = () => {
    const { project, saveStatus } = get();
    if (!project || saveStatus !== 'saving') return;
    stashPending(project);
    void flushSave();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', saveBeforeLeaving);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveBeforeLeaving();
    });
  }

  const load = async (project: Project) => {
    await flushSave();
    rememberLastOpen(project.id);
    set({ project, past: [], future: [], lastKey: undefined, saveStatus: 'saved' });
  };

  const persistNew = async (project: Project) => {
    await db.saveProject(project);
    set({ projects: await db.listProjects() });
    await load(project);
  };

  return {
    status: 'loading',
    saveStatus: 'saved',
    projects: [],
    project: null,
    past: [],
    future: [],
    lastAt: 0,

    init: async () => {
      try {
        const pending = takePending();
        if (pending) {
          const stored = await db.getProject(pending.id);
          // Only a newer copy of a project that still exists replaces what IndexedDB has.
          if (stored && pending.updatedAt > stored.updatedAt) await db.saveProject(pending);
        }
        let projects = await db.listProjects();
        if (projects.length === 0) {
          await db.saveProject(createSampleProject());
          projects = await db.listProjects();
        }
        const lastId = readLastOpen();
        const id = projects.find((p) => p.id === lastId)?.id ?? projects[0].id;
        const project = await db.getProject(id);
        set({ projects, status: 'ready' });
        if (project) await load(project);
      } catch (error) {
        set({ status: 'error', error: error instanceof Error ? error.message : String(error) });
      }
    },

    openProject: async (id) => {
      if (get().project?.id === id) return;
      const project = await db.getProject(id);
      if (project) await load(project);
    },

    createProject: async (name, engine, databaseName) => {
      await persistNew(newProject(name, engine, databaseName));
    },

    renameProject: async (id, name) => {
      const { project, mutate } = get();
      if (project?.id === id) {
        mutate((draft) => {
          draft.name = name;
        }, 'project-name');
        return;
      }
      const stored = await db.getProject(id);
      if (!stored) return;
      await db.saveProject({ ...stored, name, updatedAt: Date.now() });
      set({ projects: await db.listProjects() });
    },

    duplicateProject: async (id) => {
      await flushSave();
      const stored = await db.getProject(id);
      if (!stored) return;
      const now = Date.now();
      await persistNew({ ...structuredClone(stored), id: uid(), name: t('projects.copyName', { name: stored.name }), createdAt: now, updatedAt: now });
    },

    deleteProject: async (id) => {
      clearTimeout(saveTimer);
      await db.deleteProject(id);
      const projects = await db.listProjects();
      set({ projects });
      if (get().project?.id !== id) return;
      const next = projects[0] ? await db.getProject(projects[0].id) : undefined;
      if (next) await load(next);
      else set({ project: null, past: [], future: [] });
    },

    importProject: async (project) => persistNew(project),

    mutate: (change, key) => {
      const { project, past, lastKey, lastAt } = get();
      if (!project) return;
      const draft = structuredClone(project);
      change(draft);
      draft.updatedAt = Date.now();
      const now = Date.now();
      const coalesce = key !== undefined && key === lastKey && now - lastAt < COALESCE_MS;
      set({
        project: draft,
        past: coalesce ? past : [...past, project].slice(-HISTORY_LIMIT),
        future: [],
        lastKey: key,
        lastAt: now,
      });
      scheduleSave();
    },

    undo: () => {
      const { project, past, future } = get();
      const previous = past.at(-1);
      if (!project || !previous) return;
      set({ project: previous, past: past.slice(0, -1), future: [project, ...future], lastKey: undefined });
      scheduleSave();
    },

    redo: () => {
      const { project, past, future } = get();
      const [next, ...rest] = future;
      if (!project || !next) return;
      set({ project: next, past: [...past, project], future: rest, lastKey: undefined });
      scheduleSave();
    },
  };
});

export default useProjectStore;
