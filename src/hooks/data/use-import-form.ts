import { useEffect, useMemo, useState } from 'react';
import { ENGINE_LIST } from '../../domain/engines';
import { detectFormat, detectNamesLocale, readSource, type ImportFormat, type SchemaImport } from '../../domain/import';
import { importFirestoreIndexes } from '../../domain/infer';
import { createProject } from '../../domain/model';
import type { EngineId } from '../../domain/types';
import { getLocale, t, type Locale } from '../../i18n';
import { addCollections } from '../../lib/actions';
import { layoutProject } from '../../lib/layout';
import useProjectStore from '../../stores/use-project-store';
import useUiStore from '../../stores/use-ui-store';

export type ImportSource = { name: string; text: string };

const baseName = (file: string) => file.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '_') || 'documents';

/** Formats that bring their own collection names; a pasted document list or schema needs one. */
const NAMED: ImportFormat[] = ['mongoose', 'prisma', 'firestoreIndexes'];

/**
 * State of the import dialog: what is pasted or uploaded, its format (chosen or detected), a live
 * preview of what will be created and what will not, the names language, and where it goes (the
 * open project, or a new one).
 */
const useImportForm = () => {
  const project = useProjectStore((s) => s.project);
  const { open, tab, target } = useUiStore((s) => s.importDialog);
  const openImport = useUiStore((s) => s.openImport);
  const close = useUiStore((s) => s.closeImport);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<ImportSource[]>([]);
  const [destination, setDestination] = useState<'current' | 'new'>('current');
  const [projectName, setProjectName] = useState('');
  const [engine, setEngine] = useState<EngineId>('mongodb');
  const [namesLocale, setNamesLocale] = useState<Locale | 'auto'>('auto');

  useEffect(() => {
    if (!open) return;
    setName('');
    setText('');
    setFiles([]);
    setDestination(target.destination);
    setProjectName(target.name ?? '');
    setEngine(target.engine ?? project?.engine ?? 'mongodb');
    setNamesLocale('auto');
    // Only a new opening resets the form; switching the format keeps what was pasted.
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const joined = files.length ? files.map((f) => f.text).join('\n') : text;
  const detected = useMemo(() => (tab === 'auto' ? detectFormat(joined) : undefined), [tab, joined]);
  const format: ImportFormat | undefined = tab === 'auto' ? detected : tab;
  const fallbackName = name.trim() || (format === 'documents' ? 'documents' : 'collection');
  const sources = useMemo((): ImportSource[] => (files.length ? files : text.trim() ? [{ name: fallbackName, text }] : []), [files, text, fallbackName]);
  // Indexes only make sense on the collections of the open project.
  const effectiveDestination = format === 'firestoreIndexes' ? 'current' : destination;

  /** The project the import is read against: the open one, or an empty one with the chosen engine. */
  const base = useMemo(() => (effectiveDestination === 'new' || !project ? createProject(projectName || 'import', engine) : project), [effectiveDestination, project, projectName, engine]);

  const preview = useMemo((): { result?: SchemaImport; error?: string; indexes?: number } => {
    if (!open || sources.length === 0) return {};
    if (!format) return { error: t('import.notDetected') };
    try {
      if (format === 'firestoreIndexes') {
        const copy = structuredClone(base);
        return { indexes: sources.reduce((n, s) => n + importFirestoreIndexes(copy, s.text), 0) };
      }
      return { result: readSource(base, format, sources) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [open, sources, format, base]);

  const detectedLocale = useMemo(() => (preview.result ? detectNamesLocale(preview.result.collections, preview.result.relationships) : undefined), [preview.result]);
  const chosenLocale: Locale = namesLocale === 'auto' ? (detectedLocale ?? project?.namesLocale ?? getLocale()) : namesLocale;

  const readFiles = async (list: FileList | null) => {
    if (!list) return;
    const read = await Promise.all([...list].map(async (f) => ({ name: baseName(f.name), text: await f.text() })));
    setFiles(read);
  };

  const canSubmit = Boolean(project && sources.length && format && !preview.error && (preview.result?.collections.length || preview.indexes) && (effectiveDestination === 'current' || projectName.trim()));

  /** Imports; with `viewScript`, then opens the creation script in the Schema view. */
  const submit = async (viewScript = false) => {
    if (!project || !canSubmit || !format) return;
    const { notify, select, setView, setSchemaOutput } = useUiStore.getState();
    try {
      if (format === 'firestoreIndexes') {
        let added = 0;
        useProjectStore.getState().mutate((draft) => {
          for (const s of sources) added += importFirestoreIndexes(draft, s.text);
        });
        notify(t('infer.indexesImported', { count: added }), added ? 'info' : 'error');
        close();
        return;
      }
      const result = preview.result!;
      if (effectiveDestination === 'new') {
        const created = createProject(projectName.trim(), engine, target.databaseName || result.databaseName);
        created.namesLocale = chosenLocale;
        created.collections = result.collections;
        created.relationships = result.relationships;
        created.documents = result.documents;
        layoutProject(created);
        close();
        await useProjectStore.getState().importProject(created);
        setView(viewScript ? 'schema' : 'diagram');
        notify(t('import.created', { name: created.name, count: created.collections.length }));
      } else {
        // The new collections are laid out among themselves and placed below the current diagram.
        const top = Math.max(0, ...project.collections.map((c) => c.position.y + 320));
        layoutProject({ ...project, collections: result.collections, relationships: result.relationships });
        for (const c of result.collections) c.position = { x: c.position.x, y: c.position.y + top };
        addCollections(result.collections, result.relationships, result.documents);
        const docs = Object.values(result.documents).reduce((n, d) => n + d.length, 0);
        notify(docs ? t('infer.imported', { count: result.collections.length, docs }) : t('infer.schemaImported', { count: result.collections.length }));
        close();
        if (result.collections[0]) select({ kind: 'collection', id: result.collections[0].id });
        if (viewScript) setView('schema');
      }
      if (viewScript) setSchemaOutput('create');
      for (const w of result.warnings.slice(0, 3)) notify(w, 'error');
    } catch (e) {
      notify(e instanceof Error ? e.message : t('export.importFailed'), 'error');
    }
  };

  return {
    open,
    tab,
    setTab: (v: typeof tab) => openImport(v, { ...target, destination }),
    close,
    name,
    setName,
    needsName: !files.length && (format === undefined ? false : !NAMED.includes(format)),
    text,
    setText,
    files,
    readFiles,
    clearFiles: () => setFiles([]),
    format,
    detected,
    destination: effectiveDestination,
    setDestination,
    canChooseDestination: format !== 'firestoreIndexes',
    projectName,
    setProjectName,
    engine,
    setEngine,
    engines: ENGINE_LIST,
    namesLocale,
    setNamesLocale,
    detectedLocale,
    preview,
    canSubmit,
    submit,
    // The creation script exists for MongoDB, from validators or a script.
    canViewScript: canSubmit && (format === 'jsonSchema' || format === 'mongosh') && (effectiveDestination === 'new' ? engine : project?.engine) === 'mongodb',
  };
};

export type ImportFormState = ReturnType<typeof useImportForm>;

export default useImportForm;
