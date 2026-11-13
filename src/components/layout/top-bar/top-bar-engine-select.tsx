import { useState } from 'react';
import { ENGINE_LIST, ENGINES } from '../../../domain/engines';
import type { EngineId } from '../../../domain/types';
import useT from '../../../hooks/ui/use-t';
import { setEngine } from '../../../lib/actions';
import useProjectStore from '../../../stores/use-project-store';
import ConfirmDialog from '../../ui/confirm-dialog/confirm-dialog';

/** Engine of the project. Changing it converts types and says what has no equivalent. */
const TopBarEngineSelect = () => {
  const t = useT();
  const engine = useProjectStore((s) => s.project?.engine);
  const hasCollections = useProjectStore((s) => Boolean(s.project?.collections.length));
  const [pending, setPending] = useState<EngineId | null>(null);
  if (!engine) return null;

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="engine" className="text-muted">
        {t('topBar.engine')}
      </label>
      <select
        id="engine"
        className="field field-sm w-auto"
        value={engine}
        onChange={(e) => {
          const next = e.target.value as EngineId;
          if (hasCollections) setPending(next);
          else setEngine(next);
        }}
      >
        {ENGINE_LIST.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      <ConfirmDialog
        open={pending !== null}
        title={t('engine.confirmTitle', { engine: pending ? ENGINES[pending].name : '' })}
        message={t('engine.confirmMessage', { from: ENGINES[engine].name, to: pending ? ENGINES[pending].name : '' })}
        confirmLabel={t('engine.confirm')}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending) setEngine(pending);
          setPending(null);
        }}
      />
    </div>
  );
};

export default TopBarEngineSelect;
