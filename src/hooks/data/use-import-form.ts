import { useEffect, useMemo, useState } from 'react';
import { importFirestoreIndexes, importJsonSchema, parseDocumentsText, planImport, type ImportedCollection } from '../../domain/infer';
import { t } from '../../i18n';
import { addCollections } from '../../lib/actions';
import { layoutProject } from '../../lib/layout';
import useProjectStore from '../../stores/use-project-store';
import useUiStore from '../../stores/use-ui-store';

export type ImportSource = { name: string; text: string };

const baseName = (file: string) => file.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '_') || 'documents';

/** State of the import dialog: pasted or uploaded documents, a $jsonSchema or a firestore.indexes.json. */
const useImportForm = () => {
  const project = useProjectStore((s) => s.project);
  const { open, tab } = useUiStore((s) => s.importDialog);
  const close = useUiStore((s) => s.closeImport);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<ImportSource[]>([]);

  useEffect(() => {
    if (!open) return;
    setName('');
    setText('');
    setFiles([]);
  }, [open, tab]);

  const sources = useMemo((): ImportSource[] => (files.length ? files : text.trim() ? [{ name: name.trim() || (tab === 'documents' ? 'documents' : 'collection'), text }] : []), [files, text, name, tab]);

  const preview = useMemo(() => {
    if (!project || tab !== 'documents' || sources.length === 0) return { plan: undefined, error: undefined };
    try {
      const inputs: ImportedCollection[] = sources.map((s) => ({ name: s.name, docs: parseDocumentsText(s.text) }));
      if (inputs.every((i) => i.docs.length === 0)) return { plan: undefined, error: t('infer.noDocuments') };
      return { plan: planImport(project, inputs), error: undefined };
    } catch (e) {
      return { plan: undefined, error: e instanceof Error ? e.message : String(e) };
    }
  }, [project, tab, sources]);

  const readFiles = async (list: FileList | null) => {
    if (!list) return;
    const read = await Promise.all([...list].map(async (f) => ({ name: baseName(f.name), text: await f.text() })));
    setFiles(read);
  };

  const submit = () => {
    if (!project) return;
    const { notify, select } = useUiStore.getState();
    try {
      if (tab === 'documents') {
        const plan = preview.plan;
        if (!plan) return;
        const documents = Object.fromEntries(plan.collections.map((c) => [c.collection.id, c.documents]));
        const collections = plan.collections.map((c) => c.collection);
        // Lay out the new collections next to each other below the current diagram.
        const top = Math.max(0, ...project.collections.map((c) => c.position.y + 320));
        const temp = { ...project, collections, relationships: plan.relationships };
        layoutProject(temp);
        for (const c of collections) c.position = { x: c.position.x, y: c.position.y + top };
        addCollections(collections, plan.relationships, documents);
        notify(t('infer.imported', { count: collections.length, docs: plan.collections.reduce((n, c) => n + c.documents.length, 0) }));
        for (const w of plan.warnings.slice(0, 3)) notify(w, 'error');
        if (collections[0]) select({ kind: 'collection', id: collections[0].id });
      } else if (tab === 'jsonSchema') {
        const collections = sources.flatMap((s) => importJsonSchema(s.text, project.engine, s.name));
        const top = Math.max(0, ...project.collections.map((c) => c.position.y + 320));
        for (const c of collections) c.position = { x: c.position.x, y: c.position.y + top };
        addCollections(collections, [], {});
        notify(t('infer.schemaImported', { count: collections.length }));
      } else {
        let added = 0;
        useProjectStore.getState().mutate((draft) => {
          for (const s of sources) added += importFirestoreIndexes(draft, s.text);
        });
        notify(t('infer.indexesImported', { count: added }), added ? 'info' : 'error');
      }
      close();
    } catch (e) {
      notify(e instanceof Error ? e.message : t('export.importFailed'), 'error');
    }
  };

  return { open, tab, close, name, setName, text, setText, files, readFiles, clearFiles: () => setFiles([]), preview, canSubmit: sources.length > 0 && (tab !== 'documents' || Boolean(preview.plan)), submit };
};

export default useImportForm;
