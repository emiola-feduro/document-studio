import type { ImportTab } from '../../../stores/use-ui-store';
import useImportForm from '../../../hooks/data/use-import-form';
import useT from '../../../hooks/ui/use-t';
import Button from '../button/button';
import Modal from '../modal/modal';
import ImportDialogOptions from './import-dialog-options';
import ImportDialogPreview from './import-dialog-preview';

type Format = Exclude<ImportTab, 'auto'>;

const FORMATS: Format[] = ['documents', 'jsonSchema', 'mongosh', 'mongoose', 'prisma', 'firestoreIndexes'];

/** Imports documents, a $jsonSchema, Mongoose or Prisma models, or Firestore indexes, with a live preview. */
const ImportDialog = () => {
  const t = useT();
  const form = useImportForm();
  const { open, tab, setTab, close, name, setName, needsName, text, setText, files, readFiles, clearFiles, format, detected, preview, canSubmit, submit, canViewScript } = form;
  const label = (f: Format) =>
    f === 'documents' ? t('import.formatDocuments') : f === 'prisma' ? t('import.formatPrisma') : f === 'mongosh' ? t('import.formatMongosh') : f === 'mongoose' ? 'Mongoose' : f === 'jsonSchema' ? '$jsonSchema' : 'firestore.indexes.json';
  const accept = format === 'prisma' ? '.prisma,text/plain' : format === 'mongoose' ? '.js,.ts,.mjs,.cjs' : '.json,.ndjson,.jsonl,.js,.ts,.prisma,application/json,text/plain';

  return (
    <Modal
      title={t('infer.title')}
      open={open}
      onClose={close}
      width="max-w-3xl"
      footer={
        <>
          <Button onClick={close}>{t('common.cancel')}</Button>
          {canViewScript && <Button onClick={() => void submit(true)}>{t('import.viewScript')}</Button>}
          <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
            {t('infer.import')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="import-format" className="block font-medium">
            {t('import.format')}
          </label>
          <select id="import-format" className="field" value={tab} onChange={(e) => setTab(e.target.value as ImportTab)} aria-describedby={tab === 'auto' && detected ? 'import-detected' : undefined}>
            <option value="auto">{t('import.auto')}</option>
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {label(f)}
              </option>
            ))}
          </select>
          {tab === 'auto' && detected && (
            <span id="import-detected" className="block text-[0.9em] text-muted">
              {t('import.detected', { format: label(detected) })}
            </span>
          )}
        </div>
        {needsName && (
          <div className="space-y-1.5">
            <label htmlFor="import-name" className="block font-medium">
              {t('infer.collectionName')}
            </label>
            <input id="import-name" className="field font-canvas" value={name} placeholder={format === 'documents' ? 'documents' : 'collection'} spellCheck={false} onChange={(e) => setName(e.target.value)} />
          </div>
        )}
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="import-text" className="font-medium">
              {t('import.pasteSource')}
            </label>
            <div className="flex items-center gap-2">
              <label className="inline-flex min-h-8 cursor-pointer items-center rounded-[calc(var(--radius)*0.75)] border-(length:--bw) border-line bg-surface px-2.5 text-[0.93em] font-medium hover:bg-surface-2 focus-within:outline-2 focus-within:outline-accent">
                {t('infer.chooseFiles')}
                <input type="file" multiple accept={accept} className="sr-only" onChange={(e) => void readFiles(e.target.files)} />
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
              placeholder={format === 'prisma' ? 'model User { ... }' : format === 'mongoose' ? 'const userSchema = new Schema({ ... })' : format === 'jsonSchema' ? '{ "$jsonSchema": { "bsonType": "object", ... } }' : format === 'firestoreIndexes' ? '{ "indexes": [...] }' : '[{ "_id": { "$oid": "..." }, "nombre": "Ana" }]'}
              onChange={(e) => setText(e.target.value)}
            />
          )}
        </div>
        <ImportDialogOptions form={form} />
        {preview.error && (
          <p role="alert" className="rounded-theme bg-danger-soft p-3 text-danger">
            {preview.error}
          </p>
        )}
        {preview.indexes !== undefined && <p className="rounded-theme bg-surface-2 p-3">{t('infer.indexesImported', { count: preview.indexes })}</p>}
        {preview.result && <ImportDialogPreview result={preview.result} engine={form.destination === 'new' ? form.engine : undefined} />}
      </div>
    </Modal>
  );
};

export default ImportDialog;
