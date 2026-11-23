import { useState } from 'react';
import { editableQuery } from '../../../domain/query-builder';
import { prepareGenerated } from '../../../domain/query/run';
import useQueryRun from '../../../hooks/data/use-query-run';
import QueryResults from '../query-results/query-results';
import useQueryBuilder from '../../../hooks/data/use-query-builder';
import useQueryStore from '../../../stores/use-query-store';
import ConfirmDialog from '../confirm-dialog/confirm-dialog';
import useT from '../../../hooks/ui/use-t';
import { addIndexWithKeys } from '../../../lib/actions';
import { downloadText } from '../../../lib/project-file';
import useUiStore from '../../../stores/use-ui-store';
import PanelsRestoreButton from '../../layout/panels-menu/panels-restore-button';
import Button from '../button/button';
import SchemaViewCode from '../schema-view/schema-view-code';
import QueryBuilderFields from './query-builder-fields';
import QueryBuilderJoins from './query-builder-joins';
import QueryBuilderOptions from './query-builder-options';
import QueryBuilderRoot from './query-builder-root';

/** Builds a query on a base collection, resolving references, in the language of the project engine. */
const QueryBuilder = () => {
  const t = useT();
  const builder = useQueryBuilder();
  const { result, root, spec, clear, collections, project } = builder;
  const [confirming, setConfirming] = useState(false);
  const runner = useQueryRun();
  const runKey = `${JSON.stringify(spec)}:${runner.documentsKey}`;
  const run = () => project && void runner.run(() => prepareGenerated(project, spec), 'generated', runKey);
  const editorText = useQueryStore((s) => (project ? s.editors[project.id]?.text : undefined));

  /** Puts the generated query in the editor, on its native side, and opens the editor. */
  const toEditor = () => {
    if (!project || !result) return;
    const { setEditor, setMode } = useQueryStore.getState();
    setEditor(project.id, { side: 'native', text: editableQuery(project.engine, result.code) });
    setMode(project.id, 'editor');
  };

  const copy = async () => {
    const { notify } = useUiStore.getState();
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.code);
      notify(t('query.copied'));
    } catch {
      notify(t('query.copyFailed'), 'error');
    }
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 bg-bg md:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]">
      <div className="relative min-h-0 space-y-5 overflow-y-auto border-r border-line bg-surface p-4">
        <QueryBuilderRoot builder={builder} />
        {root && (
          <>
            <QueryBuilderJoins builder={builder} />
            <QueryBuilderFields builder={builder} />
            <QueryBuilderOptions builder={builder} onRun={run} />
          </>
        )}
      </div>
      <div className="flex min-h-0 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
          <h2 className="mr-auto font-semibold">{t('query.title')}</h2>
          <Button size="sm" variant="ghost" onClick={clear} disabled={!spec.rootId}>
            {t('query.clear')}
          </Button>
          <Button size="sm" onClick={() => void copy()} disabled={!result}>
            {t('common.copy')}
          </Button>
          <Button size="sm" disabled={!result} onClick={run}>
            {t('run.run')}
          </Button>
          <Button size="sm" disabled={!result} onClick={() => (editorText?.trim() ? setConfirming(true) : toEditor())}>
            {t('query.copyToEditor')}
          </Button>
          <Button size="sm" variant="primary" disabled={!result} onClick={() => result && downloadText(result.fileName, result.code, 'text/plain')}>
            {t('query.download')}
          </Button>
          <PanelsRestoreButton />
        </div>
        {result ? (
          <>
            {(result.warnings.length > 0 || result.missingIndex) && (
              <div className="space-y-2 border-b border-line bg-surface px-4 py-3" role="status">
                <ul className="space-y-1">
                  {result.warnings.map((w) => (
                    <li key={w} className="text-warning">
                      {w}
                    </li>
                  ))}
                </ul>
                {result.missingIndex && (
                  <Button size="sm" onClick={() => addIndexWithKeys(result.missingIndex!.collectionId, result.missingIndex!.keys)}>
                    {t('query.addIndex')}
                  </Button>
                )}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-auto">
              <SchemaViewCode code={result.code} language={result.language} />
            </div>
            <section className="flex max-h-[50%] min-h-24 shrink-0 flex-col overflow-hidden border-t border-line" aria-label={t('run.results')}>
              <QueryResults state={runner.state} stale={runner.state.status === 'done' && runner.state.key !== runKey} />
            </section>
          </>
        ) : (
          <p className="p-6 text-muted">{collections.length ? t('query.empty') : t('query.noCollections')}</p>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        title={t('query.replaceEditorTitle')}
        message={t('query.replaceEditorMessage')}
        confirmLabel={t('query.replaceEditorConfirm')}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          toEditor();
        }}
      />
    </div>
  );
};

export default QueryBuilder;
