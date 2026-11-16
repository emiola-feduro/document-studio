import useT from '../../../hooks/ui/use-t';
import useProjectStore from '../../../stores/use-project-store';
import useQueryStore, { type QueryMode } from '../../../stores/use-query-store';
import QueryEditor from '../query-editor/query-editor';
import SegmentedControl from '../segmented-control/segmented-control';
import QueryBuilder from './query-builder';

/** The Queries tab: the builder that assembles a query, or the editor where it is written. */
const QueryView = () => {
  const t = useT();
  const projectId = useProjectStore((s) => s.project?.id ?? '');
  const mode = useQueryStore((s) => s.modes[projectId]) ?? 'builder';
  const setMode = useQueryStore((s) => s.setMode);

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div className="flex items-center gap-2 border-b border-line bg-surface px-4 py-1.5">
        <SegmentedControl<QueryMode>
          label={t('queryEditor.mode')}
          value={mode}
          onChange={(m) => setMode(projectId, m)}
          options={[
            { value: 'builder', label: t('queryEditor.builder') },
            { value: 'editor', label: t('queryEditor.editor') },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1">{mode === 'builder' ? <QueryBuilder /> : <QueryEditor />}</div>
    </div>
  );
};

export default QueryView;
