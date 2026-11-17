import { useMemo, useRef, useState } from 'react';
import { MAX_ROWS, type Row } from '../../../domain/query/run';
import type { RunState } from '../../../hooks/data/use-query-run';
import useColumnWidths, { type FitColumn } from '../../../hooks/ui/use-column-widths';
import useT from '../../../hooks/ui/use-t';
import useProjectStore from '../../../stores/use-project-store';
import useUiStore from '../../../stores/use-ui-store';
import Button from '../button/button';
import ColumnResizeHandle from '../column-resize-handle/column-resize-handle';
import DocumentsViewValuePanel from '../documents-view/documents-view-value-panel';
import Pill from '../pill/pill';
import SchemaViewCode from '../schema-view/schema-view-code';
import SegmentedControl from '../segmented-control/segmented-control';

type QueryResultsProps = {
  state: RunState;
  /** The query or the documents changed since the result was computed. */
  stale: boolean;
};

const plain = (v: unknown): unknown => (v instanceof Date ? v.toISOString() : v instanceof RegExp ? String(v) : Array.isArray(v) ? v.map(plain) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v);

const csvCell = (v: unknown) => {
  const text = v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Result of a query on the sample documents: a table or JSON, with every state designed. */
const QueryResults = ({ state, stale }: QueryResultsProps) => {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const [view, setView] = useState<'table' | 'json'>('table');
  const [open, setOpen] = useState<{ row: number; key: string } | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const rows = useMemo(() => (state.result?.rows ?? []).slice(0, MAX_ROWS).map((r) => plain(r) as Row), [state.result]);
  const columns = useMemo(() => {
    const keys: string[] = [];
    for (const r of rows) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
    return keys;
  }, [rows]);
  const text = (v: unknown) => (v === undefined ? '' : Array.isArray(v) ? t('docs.arrayItems', { count: v.length }) : v && typeof v === 'object' ? t('docs.objectKeys', { count: Object.keys(v).length }) : typeof v === 'string' ? v : JSON.stringify(v));
  const fit = useMemo((): FitColumn[] => columns.map((c) => ({ key: c, header: [c], values: rows.map((r) => text(r[c])) })), [columns, rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const widths = useColumnWidths(`results:${project?.id ?? ''}`, fit, tableRef, { extra: 24, min: 64, max: 420, headerExtra: 28 }, undefined, 48);

  const copy = async (content: string) => {
    const { notify } = useUiStore.getState();
    try {
      await navigator.clipboard.writeText(content);
      notify(t('run.copied'));
    } catch {
      notify(t('query.copyFailed'), 'error');
    }
  };
  const asCsv = () => [columns.map(csvCell).join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\n');

  if (state.status === 'idle') return <p className="p-4 text-muted">{t('run.notRun')}</p>;
  if (state.status === 'loading') {
    return (
      <p className="p-4 text-muted" aria-busy="true" role="status">
        {t('run.loading')}
      </p>
    );
  }
  const header = (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-1.5">
      <span className="font-medium">{state.from ? t(`run.from.${state.from}` as 'run.from.sql') : t('run.results')}</span>
      {state.result && <span className="text-muted">{t('run.count', { count: state.result.total, ms: Math.max(1, Math.round(state.result.ms)) })}</span>}
      {state.result && state.result.total > MAX_ROWS && <span className="text-muted">{t('run.shown', { shown: MAX_ROWS })}</span>}
      {stale && <Pill tone="warning">{t('run.stale')}</Pill>}
      <span className="flex-1" />
      {state.status === 'done' && rows.length > 0 && (
        <>
          <SegmentedControl<'table' | 'json'> size="sm" label={t('run.view')} value={view} onChange={setView} options={[{ value: 'table', label: t('run.table') }, { value: 'json', label: t('run.json') }]} />
          <Button size="sm" variant="ghost" onClick={() => void copy(JSON.stringify(rows, null, 2))}>
            {t('run.copyJson')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void copy(asCsv())}>
            {t('run.copyCsv')}
          </Button>
        </>
      )}
    </div>
  );
  const notes = state.warnings.length > 0 && (
    <ul className="space-y-1 border-b border-line bg-warning-soft px-4 py-2 text-warning">
      {state.warnings.map((w) => (
        <li key={w}>{w}</li>
      ))}
    </ul>
  );

  if (state.status === 'error') {
    return (
      <div role="alert">
        {header}
        {notes}
        <p className="p-4">
          <span className="font-semibold text-danger">{t('run.error')}: </span>
          {state.error}
        </p>
      </div>
    );
  }
  const empty = state.result?.emptyCollections ?? [];
  if (rows.length === 0) {
    const first = project?.collections.find((c) => c.name === empty[0]);
    return (
      <div>
        {header}
        {notes}
        <div className="space-y-2 p-4">
          <p className="text-muted">{t('run.noResults')}</p>
          {empty.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span>{t('run.noDocs', { names: empty.join(', ') })}</span>
              <Button
                size="sm"
                onClick={() => {
                  const ui = useUiStore.getState();
                  if (first) ui.setDocumentsCollection(first.id);
                  ui.setView('documents');
                }}
              >
                {t('run.goToDocuments')}
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      {notes}
      <div className="flex min-h-0 flex-1">
        {view === 'json' ? (
          <div className="min-h-0 flex-1 overflow-auto">
            <SchemaViewCode code={JSON.stringify(rows, null, 2)} language="json" />
          </div>
        ) : (
          <div className="relative min-h-0 min-w-0 flex-1 overflow-auto">
            <table ref={tableRef} className="table-fixed border-separate border-spacing-0 text-[0.93em]" style={{ width: widths.total }}>
              <colgroup>
                <col style={{ width: 48 }} />
                {columns.map((c) => (
                  <col key={c} style={{ width: widths.widthOf(c) }} />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-10 bg-surface">
                <tr>
                  <th scope="col" className="border-b border-line px-2 py-1.5 text-left font-semibold text-muted">
                    #
                  </th>
                  {columns.map((c) => (
                    <th key={c} scope="col" className="relative border-b border-line px-2 py-1.5 text-left font-semibold font-canvas">
                      <span className="block truncate">{c}</span>
                      <ColumnResizeHandle column={c} width={widths.widthOf(c)} onResize={(w) => widths.resize(c, w)} onFit={() => widths.fit(c)} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <th scope="row" className="border-b border-line px-2 py-1 text-left font-normal text-muted tabular-nums">
                      {i + 1}
                    </th>
                    {columns.map((c) => {
                      const v = r[c];
                      const nested = v !== null && typeof v === 'object';
                      return (
                        <td key={c} className="truncate border-b border-line px-2 py-1 font-canvas" title={nested ? undefined : text(v)}>
                          {nested ? (
                            <button type="button" className="text-accent hover:underline" onClick={() => setOpen({ row: i, key: c })} aria-label={t('run.cellLabel', { field: c, n: i + 1 })}>
                              {text(v)}
                            </button>
                          ) : (
                            text(v)
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {open && rows[open.row] && <DocumentsViewValuePanel key={`${open.row}:${open.key}`} title={`${open.row + 1}.${open.key}`} value={rows[open.row][open.key]} onClose={() => setOpen(null)} />}
      </div>
    </div>
  );
};

export default QueryResults;
