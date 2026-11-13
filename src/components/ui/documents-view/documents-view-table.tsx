import { Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { parseDocument, type DocResult, type JsonObject } from '../../../domain/documents';
import type { Collection, SampleDocument } from '../../../domain/types';
import useT from '../../../hooks/ui/use-t';
import { deleteDocument, updateDocument } from '../../../lib/actions';
import IconButton from '../icon-button/icon-button';
import DocumentsViewCell from './documents-view-cell';
import DocumentsViewValuePanel from './documents-view-value-panel';

type DocumentsViewTableProps = {
  collection: Collection;
  docs: SampleDocument[];
  results: DocResult[];
};

/** Top level fields as columns; objects and arrays open in a side panel. */
const DocumentsViewTable = ({ collection, docs, results }: DocumentsViewTableProps) => {
  const t = useT();
  const [open, setOpen] = useState<{ docId: string; key: string } | null>(null);
  const parsed = useMemo(() => docs.map((d) => ({ doc: d, ...parseDocument(d) })), [docs]);
  const columns = useMemo(() => {
    const names = collection.fields.map((f) => f.name).filter(Boolean);
    for (const p of parsed) for (const k of Object.keys(p.value ?? {})) if (!names.includes(k)) names.push(k);
    return names;
  }, [collection.fields, parsed]);

  const write = (doc: SampleDocument, value: JsonObject) => updateDocument(collection.id, doc.id, JSON.stringify(value, null, 2));
  const openDoc = open ? parsed.find((p) => p.doc.id === open.docId) : undefined;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="relative min-h-0 min-w-0 flex-1 overflow-auto">
        <table className="min-w-full border-separate border-spacing-0 text-[0.95em]">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr>
              <th scope="col" className="border-b border-line px-2 py-2 text-left font-semibold text-muted">
                #
              </th>
              {columns.map((c) => (
                <th key={c} scope="col" className="border-b border-line px-2 py-2 text-left font-semibold whitespace-nowrap font-canvas">
                  {c}
                </th>
              ))}
              <th scope="col" className="border-b border-line px-2 py-2">
                <span className="sr-only">{t('docs.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {parsed.map(({ doc, value, error }, i) => {
              const errors = results[i]?.errors ?? [];
              const bad = new Set(errors.map((e) => e.path.split(/[.[]/)[0]));
              return (
                <tr key={doc.id} className="align-top">
                  <th scope="row" className="border-b border-line px-2 py-1.5 text-left font-normal text-muted tabular-nums">
                    <span className={errors.length ? 'font-semibold text-danger' : ''} title={errors.length ? t('docs.errorCount', { count: errors.length }) : undefined}>
                      {i + 1}
                    </span>
                  </th>
                  {error || !value ? (
                    <td colSpan={columns.length} className="border-b border-line px-2 py-1.5 text-danger">
                      {error}
                    </td>
                  ) : (
                    columns.map((c) => (
                      <td key={c} className="max-w-56 border-b border-line px-1 py-1">
                        <DocumentsViewCell
                          id={`cell-${doc.id}-${c}`}
                          label={t('docs.cellLabel', { field: c, n: i + 1 })}
                          value={value[c]}
                          present={c in value}
                          invalid={bad.has(c)}
                          onOpen={() => setOpen({ docId: doc.id, key: c })}
                          onChange={(next, remove) => {
                            const copy = { ...value };
                            if (remove) delete copy[c];
                            else copy[c] = next;
                            write(doc, copy);
                          }}
                        />
                      </td>
                    ))
                  )}
                  <td className="border-b border-line px-1 py-1">
                    <IconButton size="sm" tone="danger" label={t('docs.deleteDocument', { n: i + 1 })} onClick={() => deleteDocument(collection.id, doc.id)}>
                      <Trash2 size={15} />
                    </IconButton>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {open && openDoc?.value && (
        <DocumentsViewValuePanel
          key={`${open.docId}:${open.key}`}
          title={`${parsed.indexOf(openDoc) + 1}.${open.key}`}
          value={openDoc.value[open.key]}
          onClose={() => setOpen(null)}
          onSave={(next) => write(openDoc.doc, { ...openDoc.value!, [open.key]: next })}
        />
      )}
    </div>
  );
};

export default DocumentsViewTable;
