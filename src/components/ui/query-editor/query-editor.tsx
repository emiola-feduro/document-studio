import { useRef, useState } from 'react';
import useQueryEditor from '../../../hooks/data/use-query-editor';
import useT from '../../../hooks/ui/use-t';
import type { EditorSide } from '../../../stores/use-query-store';
import useUiStore from '../../../stores/use-ui-store';
import { addIndexWithKeys } from '../../../lib/actions';
import SchemaViewCode from '../schema-view/schema-view-code';
import PanelsRestoreButton from '../../layout/panels-menu/panels-restore-button';
import Button from '../button/button';
import CodeEditor from '../code-editor/code-editor';
import ConfirmDialog from '../confirm-dialog/confirm-dialog';
import SegmentedControl from '../segmented-control/segmented-control';
import QueryEditorProblems from './query-editor-problems';
import QueryResults from '../query-results/query-results';
import useQueryRun from '../../../hooks/data/use-query-run';
import { prepareNative, prepareSql } from '../../../domain/query/run';

const NATIVE_TITLE = { mongodb: 'MongoDB (mongosh)', couchdb: 'CouchDB (Mango _find)', firestore: 'Firestore (SDK)' } as const;

/** SQL and the engine's native query side by side: one is written, the other is its live translation. */
const QueryEditor = () => {
  const t = useT();
  const editor = useQueryEditor();
  const { project, side, text, setText, other, diagnostics, losses, extras, missingIndex, switchSide, nativeLanguage, complete, hoverFor, signature } = editor;
  const [confirming, setConfirming] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const runner = useQueryRun();
  if (!project) return null;
  const runKey = `${side}:${text}:${runner.documentsKey}`;
  const run = () => void runner.run(() => (side === 'sql' ? prepareSql(project, text) : prepareNative(project, text)), side, runKey);
  const sample = project.collections[0]?.name ?? 'coleccion';
  const nativeExample =
    project.engine === 'mongodb' ? `db.${sample}.find({ })` : project.engine === 'couchdb' ? '{\n  "selector": { }\n}' : `query(\n  collection(db, "${sample}")\n)`;

  const copy = async (value: string) => {
    const { notify } = useUiStore.getState();
    try {
      await navigator.clipboard.writeText(value);
      notify(t('queryEditor.copied'));
    } catch {
      notify(t('query.copyFailed'), 'error');
    }
  };

  const change = (next: EditorSide) => {
    if (next === side) return;
    if (losses.length) setConfirming(true);
    else switchSide();
  };

  const marks = diagnostics.flatMap((d) => (d.pos ? [{ start: d.pos.start, end: d.pos.end, severity: d.severity }] : []));
  const panel = (which: EditorSide) => {
    const editable = which === side;
    const value = editable ? text : other;
    const title = which === 'sql' ? 'SQL' : NATIVE_TITLE[project.engine];
    return (
      <section className="flex min-h-56 min-w-0 flex-col border-b border-line last:border-b-0 @[56rem]:border-r @[56rem]:border-b-0 @[56rem]:last:border-r-0" aria-label={title}>
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-1.5">
          <h3 className="font-semibold">
            {title}
            {!editable && <span className="ml-2 font-normal text-muted">{t('queryEditor.translation')}</span>}
          </h3>
          <Button size="sm" variant="ghost" disabled={!value} onClick={() => void copy(value)} aria-label={t('queryEditor.copyLabel', { name: title })}>
            {t('common.copy')}
          </Button>
        </div>
        <div className="relative min-h-0 flex-1">
          <CodeEditor
            id={`query-editor-${which}`}
            label={editable ? t('queryEditor.editLabel', { name: title }) : t('queryEditor.readLabel', { name: title })}
            value={value}
            onChange={editable ? setText : undefined}
            readOnly={!editable}
            language={which === 'sql' ? 'sql' : nativeLanguage}
            placeholder={editable ? (which === 'sql' ? `SELECT *\nFROM ${sample}` : nativeExample) : t('queryEditor.empty')}
            complete={editable ? complete : undefined}
            marks={editable ? marks : []}
            hover={hoverFor(which)}
            signature={editable ? signature : undefined}
            areaRef={editable ? areaRef : undefined}
            onRun={editable ? run : undefined}
          />
        </div>
      </section>
    );
  };

  return (
    <div className="@container flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2">
        <span className="font-medium" id="query-editor-side-label">
          {t('queryEditor.writeIn')}
        </span>
        <SegmentedControl<EditorSide>
          label={t('queryEditor.writeIn')}
          value={side}
          onChange={change}
          options={[
            { value: 'sql', label: 'SQL' },
            { value: 'native', label: t('queryEditor.native') },
          ]}
        />
        <div className="ml-auto flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={run} disabled={!text.trim()} title="Ctrl+Enter">
            {t('run.run')}
          </Button>
          <PanelsRestoreButton />
        </div>
      </div>
      {/* Side by side only when the editor itself is wide enough, whatever the panels around it. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto @[56rem]:grid-cols-2 @[56rem]:overflow-hidden">
        {panel('sql')}
        {panel('native')}
      </div>
      {(extras.length > 0 || missingIndex) && (
        <section className="max-h-64 shrink-0 space-y-2 overflow-y-auto border-t border-line px-4 py-2" aria-label={t('queryEditor.extras')}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{t('queryEditor.extras')}</h3>
            {missingIndex && (
              <Button size="sm" onClick={() => addIndexWithKeys(missingIndex.collectionId, missingIndex.keys)}>
                {t('query.addIndex')}
              </Button>
            )}
          </div>
          {extras.map((extra) => (
            <div key={extra.label + extra.code} className="rounded-theme border-(length:--bw) border-line">
              <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1">
                <span className="font-medium">{extra.label}</span>
                <Button size="sm" variant="ghost" onClick={() => void copy(extra.code)} aria-label={t('queryEditor.copyLabel', { name: extra.label })}>
                  {t('common.copy')}
                </Button>
              </div>
              <SchemaViewCode code={extra.code} language={extra.language} />
            </div>
          ))}
        </section>
      )}
      <QueryEditorProblems diagnostics={diagnostics} text={text} areaRef={areaRef} onFix={editor.applyFix} />
      <section className="flex max-h-[45%] min-h-24 shrink-0 flex-col overflow-hidden border-t border-line bg-bg" aria-label={t('run.results')}>
        <QueryResults state={runner.state} stale={runner.state.status === 'done' && runner.state.key !== runKey} />
      </section>
      <ConfirmDialog
        open={confirming}
        title={t('queryEditor.switchTitle', { side: side === 'sql' ? t('queryEditor.native') : 'SQL' })}
        message={t('queryEditor.switchMessage')}
        confirmLabel={t('queryEditor.switchConfirm')}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          switchSide();
        }}
      >
        <ul className="list-inside list-disc space-y-1">
          {losses.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </ConfirmDialog>
    </div>
  );
};

export default QueryEditor;
