import { useState } from 'react';
import { errorCount } from '../../../domain/documents';
import useDocumentResults from '../../../hooks/data/use-document-results';
import useT from '../../../hooks/ui/use-t';
import { addDocument, addRandomDocuments, addRandomDocumentsEverywhere, setDocuments } from '../../../lib/actions';
import useProjectStore from '../../../stores/use-project-store';
import useUiStore from '../../../stores/use-ui-store';
import PanelsRestoreButton from '../../layout/panels-menu/panels-restore-button';
import Button from '../button/button';
import ConfirmDialog from '../confirm-dialog/confirm-dialog';
import Menu from '../menu/menu';
import Pill from '../pill/pill';
import SegmentedControl from '../segmented-control/segmented-control';
import DocumentsViewErrors from './documents-view-errors';
import DocumentsViewJson from './documents-view-json';
import DocumentsViewTable from './documents-view-table';

type Mode = 'json' | 'table';

const DocumentsView = () => {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const selectedId = useUiStore((s) => s.documentsCollectionId);
  const setCollection = useUiStore((s) => s.setDocumentsCollection);
  const notify = useUiStore((s) => s.notify);
  const [mode, setMode] = useState<Mode>('table');
  const [count, setCount] = useState(20);
  const [maxArray, setMaxArray] = useState(5);
  const [clearing, setClearing] = useState(false);
  const collection = project?.collections.find((c) => c.id === selectedId) ?? project?.collections[0];
  const results = useDocumentResults(collection?.id ?? null);
  if (!project) return null;

  if (!collection) {
    return (
      <div className="flex h-full items-center justify-center bg-bg p-8">
        <div className="max-w-sm text-center">
          <h2 className="text-[1.2em] font-semibold">{t('docs.noCollections')}</h2>
          <Button variant="primary" className="mt-4" onClick={() => useUiStore.getState().openImport('documents')}>
            {t('canvas.importDocuments')}
          </Button>
        </div>
      </div>
    );
  }

  const docs = project.documents?.[collection.id] ?? [];
  const errors = errorCount(results);
  const safeCount = Math.max(1, Math.min(500, Math.round(count) || 1));
  const generate = () => {
    const added = addRandomDocuments(collection.id, safeCount, maxArray);
    notify(t('docs.generated', { count: added, name: collection.name }));
  };

  return (
    <div className="flex h-full flex-col bg-bg">
      <h2 className="sr-only">{t('docs.title')}</h2>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2">
        <div className="flex items-center gap-2">
          <label htmlFor="docs-collection" className="text-muted">
            {t('docs.collection')}
          </label>
          <select id="docs-collection" className="field field-sm w-auto font-canvas" value={collection.id} onChange={(e) => setCollection(e.target.value)}>
            {project.collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({project.documents?.[c.id]?.length ?? 0})
              </option>
            ))}
          </select>
        </div>
        <SegmentedControl<Mode>
          size="sm"
          label={t('docs.mode')}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'table', label: t('docs.table') },
            { value: 'json', label: 'JSON' },
          ]}
        />
        {docs.length > 0 && (errors ? <Pill tone="danger">{t('docs.errorCount', { count: errors })}</Pill> : <Pill tone="success">{t('docs.noErrors')}</Pill>)}
        <span className="flex-1" />
        <div className="flex items-center gap-1.5">
          <label htmlFor="docs-count" className="text-muted">
            {t('docs.howMany')}
          </label>
          <input id="docs-count" type="number" min={1} max={500} className="field field-sm w-20 tabular-nums" value={count} onChange={(e) => setCount(e.target.valueAsNumber)} />
          <label htmlFor="docs-max-array" className="text-muted">
            {t('docs.maxArray')}
          </label>
          <input id="docs-max-array" type="number" min={0} max={20} className="field field-sm w-16 tabular-nums" value={maxArray} onChange={(e) => setMaxArray(Math.max(0, Math.min(20, e.target.valueAsNumber || 0)))} />
          <Button size="sm" onClick={generate}>
            {t('docs.generate')}
          </Button>
        </div>
        <Menu
          trigger={({ open, toggle }) => (
            <Button size="sm" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
              {t('docs.more')}
            </Button>
          )}
          items={[
            { label: t('docs.addEmpty'), onSelect: () => addDocument(collection.id, JSON.stringify({}, null, 2)) },
            {
              label: t('docs.generateAll', { count: safeCount }),
              onSelect: () => {
                addRandomDocumentsEverywhere(safeCount, maxArray);
                notify(t('docs.generatedAll', { count: safeCount }));
              },
            },
            { label: t('docs.import'), onSelect: () => useUiStore.getState().openImport('documents'), separatorBefore: true },
            { label: t('docs.clear'), danger: true, disabled: docs.length === 0, onSelect: () => setClearing(true), separatorBefore: true },
          ]}
        />
        <PanelsRestoreButton />
      </div>
      {docs.length === 0 && mode === 'table' ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="max-w-sm text-center">
            <h3 className="text-[1.1em] font-semibold">{t('docs.empty', { name: collection.name })}</h3>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button variant="primary" onClick={generate}>
                {t('docs.generateN', { count: safeCount })}
              </Button>
              <Button onClick={() => addDocument(collection.id, JSON.stringify({}, null, 2))}>{t('docs.addEmpty')}</Button>
            </div>
          </div>
        </div>
      ) : mode === 'json' ? (
        <DocumentsViewJson key={collection.id} collectionId={collection.id} docs={docs} results={results} />
      ) : (
        <DocumentsViewTable key={collection.id} collection={collection} docs={docs} results={results} />
      )}
      <DocumentsViewErrors results={results} />
      <ConfirmDialog
        open={clearing}
        title={t('docs.clear')}
        message={t('docs.clearMessage', { count: docs.length, name: collection.name })}
        confirmLabel={t('docs.clear')}
        onCancel={() => setClearing(false)}
        onConfirm={() => {
          setClearing(false);
          setDocuments(collection.id, []);
        }}
      />
    </div>
  );
};

export default DocumentsView;
