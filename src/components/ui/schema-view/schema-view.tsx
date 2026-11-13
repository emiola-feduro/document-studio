import { useMemo, useState } from 'react';
import { OUTPUTS } from '../../../domain/outputs';
import useT from '../../../hooks/ui/use-t';
import { setDatabaseName } from '../../../lib/actions';
import { downloadText } from '../../../lib/project-file';
import useProjectStore from '../../../stores/use-project-store';
import usePreferencesStore from '../../../stores/use-preferences-store';
import useUiStore from '../../../stores/use-ui-store';
import PanelsRestoreButton from '../../layout/panels-menu/panels-restore-button';
import Button from '../button/button';
import Checkbox from '../checkbox/checkbox';
import SegmentedControl from '../segmented-control/segmented-control';
import SchemaViewCode from './schema-view-code';
import SchemaViewFontSelect from './schema-view-font-select';

/** The engine's own output: scripts, validators, rules and indexes, ready to copy or download. */
const SchemaView = () => {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const locale = usePreferencesStore((s) => s.locale);
  const notify = useUiStore((s) => s.notify);
  const [chosen, setChosen] = useState<string>('');
  const [collMod, setCollMod] = useState(false);
  const outputs = project ? OUTPUTS[project.engine] : [];
  const output = outputs.find((o) => o.id === chosen) ?? outputs[0];
  const result = useMemo(() => (project && output ? output.generate(project, { collMod }) : undefined), [project, output, collMod, locale]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!project || !output || !result) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.code);
      notify(t('schema.copied'));
    } catch {
      notify(t('schema.copyFailed'), 'error');
    }
  };

  return (
    <div className="flex h-full flex-col bg-bg">
      <h2 className="sr-only">{t('schema.title')}</h2>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        <SegmentedControl size="sm" label={t('schema.output')} value={output.id} onChange={setChosen} options={outputs.map((o) => ({ value: o.id, label: t(o.label) }))} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2">
        <div className="flex items-center gap-2">
          <label htmlFor="schema-database" className="text-muted">
            {project.engine === 'couchdb' ? t('schema.databaseOrBucket') : t('schema.database')}
          </label>
          <input id="schema-database" className="field field-sm w-40 font-canvas" value={project.databaseName ?? ''} placeholder="app" spellCheck={false} onChange={(e) => setDatabaseName(e.target.value)} />
        </div>
        <SchemaViewFontSelect />
        {output.id === 'mongosh' && <Checkbox label={t('schema.collMod')} checked={collMod} onChange={setCollMod} />}
        <span className="flex-1" />
        <Button size="sm" onClick={copy}>
          {t('common.copy')}
        </Button>
        <Button size="sm" variant="primary" onClick={() => downloadText(output.filename(project), result.code, 'text/plain')}>
          {t('schema.download', { file: output.filename(project) })}
        </Button>
        <PanelsRestoreButton />
      </div>
      {result.warnings.length > 0 && (
        <ul className="max-h-32 space-y-1 overflow-y-auto border-b border-line bg-warning-soft px-4 py-2 text-warning">
          {result.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      {project.collections.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-8 text-muted">{t('schema.empty')}</div>
      ) : (
        <SchemaViewCode code={result.code} language={output.language} />
      )}
    </div>
  );
};

export default SchemaView;
