import type { MessageKey } from '../../../i18n';
import { CURRENT, type ModelVersionsState } from '../../../hooks/data/use-model-versions';
import useT from '../../../hooks/ui/use-t';
import { downloadText } from '../../../lib/project-file';
import useUiStore from '../../../stores/use-ui-store';
import Button from '../button/button';
import Checkbox from '../checkbox/checkbox';
import Pill from '../pill/pill';
import SchemaViewCode from '../schema-view/schema-view-code';
import SegmentedControl from '../segmented-control/segmented-control';

/** Chooses two versions and shows what changed and the migration for the project engine. */
const VersionsViewCompare = ({ data }: { data: ModelVersionsState }) => {
  const t = useT();
  const { versions, fromId, setFromId, toId, setToId, options, setOptions, migration, file, fileIndex, setFileIndex } = data;

  const copy = async () => {
    if (!file) return;
    const { notify } = useUiStore.getState();
    try {
      await navigator.clipboard.writeText(file.code);
      notify(t('versions.copied'));
    } catch {
      notify(t('query.copyFailed'), 'error');
    }
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-2">
        <h2 className="mr-auto self-center font-semibold">{t('versions.compare')}</h2>
        <div className="flex items-center gap-2">
          <label htmlFor="version-from" className="text-muted">
            {t('versions.from')}
          </label>
          <select id="version-from" className="field field-sm w-44" value={fromId} onChange={(e) => setFromId(e.target.value)} disabled={!versions.length}>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="version-to" className="text-muted">
            {t('versions.to')}
          </label>
          <select id="version-to" className="field field-sm w-44" value={toId} onChange={(e) => setToId(e.target.value)} disabled={!versions.length}>
            <option value={CURRENT}>{t('versions.current')}</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <Button size="sm" onClick={() => void copy()} disabled={!file}>
          {t('common.copy')}
        </Button>
        <Button size="sm" variant="primary" disabled={!file} onClick={() => file && downloadText(file.name, file.code, 'text/plain')}>
          {t('versions.download')}
        </Button>
      </div>
      {migration ? (
        <>
          <div className="max-h-[42%] space-y-3 overflow-y-auto border-b border-line px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <Checkbox label={t('versions.bump')} checked={Boolean(options.bumpSchemaVersion)} onChange={(on) => setOptions((o) => ({ ...o, bumpSchemaVersion: on }))} />
              <Checkbox
                label={t('versions.onlyVersion')}
                checked={options.previousSchemaVersion !== undefined}
                onChange={(on) => setOptions((o) => ({ ...o, previousSchemaVersion: on ? 1 : undefined }))}
              />
              {options.previousSchemaVersion !== undefined && (
                <span className="flex items-center gap-2">
                  <label htmlFor="version-previous" className="sr-only">
                    {t('versions.previousVersion')}
                  </label>
                  <input
                    id="version-previous"
                    type="number"
                    min={0}
                    className="field field-sm w-20"
                    value={options.previousSchemaVersion}
                    onChange={(e) => setOptions((o) => ({ ...o, previousSchemaVersion: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
                  />
                </span>
              )}
            </div>
            <h3 className="font-semibold">{t('versions.changes', { count: migration.changes.length })}</h3>
            {migration.changes.length === 0 && <p className="text-muted">{t('versions.noChanges')}</p>}
            <ul className="space-y-1">
              {migration.changes.map((change, i) => (
                <li key={`${change.kind}-${change.collection}-${change.detail}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="shrink-0 font-medium">{t(`migration.kind.${change.kind}` as MessageKey)}</span>
                  <span className="min-w-0 font-canvas text-[0.92em] break-all">
                    {change.collection}
                    {change.detail ? `: ${change.detail}` : ''}
                  </span>
                  {change.destructive && <Pill tone="danger">{t('versions.destructive')}</Pill>}
                </li>
              ))}
            </ul>
            {migration.warnings.length > 0 && (
              <ul className="space-y-1 rounded-[calc(var(--radius)*0.75)] bg-warning-soft px-3 py-2 text-warning">
                {migration.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>
          {migration.files.length > 1 && (
            <div className="border-b border-line px-4 py-2">
              <SegmentedControl<string>
                label={t('versions.files')}
                value={String(fileIndex)}
                onChange={(v) => setFileIndex(Number(v))}
                options={migration.files.map((f, i) => ({ value: String(i), label: f.name }))}
              />
            </div>
          )}
          {file && (
            <div className="min-h-0 flex-1 overflow-auto">
              <SchemaViewCode code={file.code} language={file.language} />
            </div>
          )}
        </>
      ) : (
        <p className="p-6 text-muted">{t('versions.empty')}</p>
      )}
    </div>
  );
};

export default VersionsViewCompare;
