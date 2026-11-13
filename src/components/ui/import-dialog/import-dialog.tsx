import type { ImportTab } from '../../../stores/use-ui-store';
import useImportForm from '../../../hooks/data/use-import-form';
import useT from '../../../hooks/ui/use-t';
import useUiStore from '../../../stores/use-ui-store';
import Button from '../button/button';
import Modal from '../modal/modal';
import SegmentedControl from '../segmented-control/segmented-control';
import ImportDialogPreview from './import-dialog-preview';

/** Imports documents and infers their schema, or imports a $jsonSchema or a firestore.indexes.json. */
const ImportDialog = () => {
  const t = useT();
  const { open, tab, close, name, setName, text, setText, files, readFiles, clearFiles, preview, canSubmit, submit } = useImportForm();
  const openImport = useUiStore((s) => s.openImport);
  const accept = tab === 'documents' ? '.json,.ndjson,.jsonl,application/json' : '.json,application/json';

  return (
    <Modal
      title={t('infer.title')}
      open={open}
      onClose={close}
      width="max-w-2xl"
      footer={
        <>
          <Button onClick={close}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={!canSubmit} onClick={submit}>
            {t('infer.import')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <SegmentedControl<ImportTab>
          label={t('infer.what')}
          value={tab}
          onChange={(v) => openImport(v)}
          options={[
            { value: 'documents', label: t('infer.tabDocuments') },
            { value: 'jsonSchema', label: '$jsonSchema' },
            { value: 'firestoreIndexes', label: 'firestore.indexes.json' },
          ]}
        />
        {files.length === 0 && tab !== 'firestoreIndexes' && (
          <div className="space-y-1.5">
            <label htmlFor="import-name" className="block font-medium">
              {t('infer.collectionName')}
            </label>
            <input id="import-name" className="field font-canvas" value={name} placeholder={tab === 'documents' ? 'documents' : 'collection'} spellCheck={false} onChange={(e) => setName(e.target.value)} />
          </div>
        )}
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="import-text" className="font-medium">
              {tab === 'documents' ? t('infer.pasteDocuments') : tab === 'jsonSchema' ? t('infer.pasteSchema') : t('infer.pasteIndexes')}
            </label>
            <div className="flex items-center gap-2">
              <label className="inline-flex min-h-8 cursor-pointer items-center rounded-[calc(var(--radius)*0.75)] border-(length:--bw) border-line bg-surface px-2.5 text-[0.93em] font-medium hover:bg-surface-2 focus-within:outline-2 focus-within:outline-accent">
                {t('infer.chooseFiles')}
                <input type="file" multiple={tab !== 'firestoreIndexes'} accept={accept} className="sr-only" onChange={(e) => void readFiles(e.target.files)} />
              </label>
              {files.length > 0 && (
                <Button size="sm" variant="ghost" onClick={clearFiles}>
                  {t('infer.clearFiles')}
                </Button>
              )}
            </div>
          </div>
          {files.length > 0 ? (
            <ul className="rounded-theme border-(length:--bw) border-line p-2 font-canvas">
              {files.map((f) => (
                <li key={f.name}>{f.name}</li>
              ))}
            </ul>
          ) : (
            <textarea
              id="import-text"
              className="field min-h-40 resize-y font-code text-[13px]"
              value={text}
              spellCheck={false}
              placeholder={tab === 'documents' ? '[{ "_id": { "$oid": "..." }, "nombre": "Ana" }]' : tab === 'jsonSchema' ? '{ "$jsonSchema": { "bsonType": "object", ... } }' : '{ "indexes": [...] }'}
              onChange={(e) => setText(e.target.value)}
            />
          )}
        </div>
        {tab === 'documents' && preview.error && (
          <p role="alert" className="rounded-theme bg-danger-soft p-3 text-danger">
            {preview.error}
          </p>
        )}
        {tab === 'documents' && preview.plan && <ImportDialogPreview plan={preview.plan} />}
      </div>
    </Modal>
  );
};

export default ImportDialog;
