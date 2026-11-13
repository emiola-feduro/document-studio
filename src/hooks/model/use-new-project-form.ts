import { t } from '../../i18n';
import { useState, type FormEvent } from 'react';
import type { EngineId } from '../../domain/types';
import useProjectStore from '../../stores/use-project-store';
import useUiStore from '../../stores/use-ui-store';

/** State and submit of the new project dialog. */
const useNewProjectForm = (onDone: () => void) => {
  const createProject = useProjectStore((s) => s.createProject);
  const [name, setName] = useState(() => t('projects.defaultName'));
  const [engine, setEngine] = useState<EngineId>('mongodb');
  const [databaseName, setDatabaseName] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setName(t('projects.defaultName'));
    setDatabaseName('');
    setBusy(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await createProject(name.trim(), engine, databaseName);
      useUiStore.getState().select(null);
      onDone();
      reset();
    } catch {
      setBusy(false);
      useUiStore.getState().notify(t('projects.createFailed'), 'error');
    }
  };

  return { name, setName, engine, setEngine, databaseName, setDatabaseName, busy, submit };
};

export default useNewProjectForm;
