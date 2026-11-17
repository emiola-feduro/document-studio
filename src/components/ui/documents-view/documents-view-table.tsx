import { Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { parseDocument, type DocResult, type JsonObject } from '../../../domain/documents';
import type { Collection, SampleDocument } from '../../../domain/types';
import { displayType } from '../../../domain/outputs/json-schema';
import useColumnWidths, { type FitColumn } from '../../../hooks/ui/use-column-widths';
import useT from '../../../hooks/ui/use-t';
import useProjectStore from '../../../stores/use-project-store';
import ColumnResizeHandle from '../column-resize-handle/column-resize-handle';
import { deleteDocument, updateDocument } from '../../../lib/actions';
import IconButton from '../icon-button/icon-button';
import DocumentsViewCell, { cellText } from './documents-view-cell';
import DocumentsViewValuePanel from './documents-view-value-panel';

type DocumentsViewTableProps = {
  collection: Collection;
  docs: SampleDocument[];
  results: DocResult[];
};

const ROW_NUMBER = 48;
const ACTIONS = 44;

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

  const project = useProjectStore((s) => s.project);
  const tableRef = useRef<HTMLTableElement>(null);
  const typeOf = (name: string) => {
    const field = collection.fields.find((f) => f.name === name);
    return field && project ? `${displayType(project.engine, field)}${field.required ? ' *' : ''}` : '';
  };
  const fitColumns = useMemo(
    (): FitColumn[] => columns.map((c) => ({ key: c, header: [c, typeOf(c)], values: parsed.map((p) => (p.value ? cellText(p.value[c], c in p.value, t) : '')) })),
    [columns, parsed, t, collection.fields, project?.engine], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Fitted to the content like a double click in Excel, filling the width, dragged widths kept per collection.
  const widths = useColumnWidths(`${project?.id ?? ''}:${collection.id}`, fitColumns, tableRef, { extra: 36, min: 72, max: 480, headerExtra: 28 }, 'input', ROW_NUMBER + ACTIONS);

  const write = (doc: SampleDocument, value: JsonObject) => updateDocument(collection.id, doc.id, JSON.stringify(value, null, 2));
  const openDoc = open ? parsed.find((p) => p.doc.id === open.docId) : undefined;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="relative min-h-0 min-w-0 flex-1 overflow-auto">
        <table ref={tableRef} className="table-fixed border-separate border-spacing-0 text-[0.95em]" style={{ width: widths.total }}>
          <colgroup>
            <col style={{ width: ROW_NUMBER }} />
            {columns.map((c) => (
              <col key={c} style={{ width: widths.widthOf(c) }} />
            ))}
            <col style={{ width: ACTIONS }} />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-surface">
            <tr>
              <th scope="col" className="border-b border-line px-2 py-2 text-left font-semibold text-muted">
                #
              </th>
              {columns.map((c) => (
                <th key={c} scope="col" className="relative border-b border-line px-2 py-2 text-left font-semibold whitespace-nowrap font-canvas">
                  <span className="block truncate">{c}</span>
                  {typeOf(c) && <span className="block truncate text-[0.85em] font-normal text-muted">{typeOf(c)}</span>}
                  <ColumnResizeHandle column={c} width={widths.widthOf(c)} onResize={(w) => widths.resize(c, w)} onFit={() => widths.fit(c)} />
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
                      <td key={c} className="border-b border-line px-1 py-1">
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
