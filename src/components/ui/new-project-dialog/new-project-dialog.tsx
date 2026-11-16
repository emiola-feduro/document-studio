import { ENGINE_LIST } from '../../../domain/engines';
import type { EngineId } from '../../../domain/types';
import useNewProjectForm, { type StartWith } from '../../../hooks/model/use-new-project-form';
import useT from '../../../hooks/ui/use-t';
import useUiStore from '../../../stores/use-ui-store';
import Button from '../button/button';
import Modal from '../modal/modal';
import SegmentedControl from '../segmented-control/segmented-control';
import NewProjectDialogRandomFields from './new-project-dialog-random-fields';

const NewProjectDialog = () => {
  const t = useT();
  const open = useUiStore((s) => s.newProjectOpen);
  const setOpen = useUiStore((s) => s.setNewProjectOpen);
  const { fields, random, busy, submit } = useNewProjectForm(() => setOpen(false));
  const { name, setName, engine, setEngine, databaseName, setDatabaseName, startWith, setStartWith } = fields;
  // Importing starts from the name, engine and database typed here.
  const importInstead = () => {
    setOpen(false);
    useUiStore.getState().openImport('auto', { destination: 'new', name: name.trim(), engine, databaseName: databaseName.trim() || undefined });
  };

  return (
    <Modal title={t('newProject.title')} open={open} onClose={() => setOpen(false)} width="max-w-lg">
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="new-project-name" className="block font-medium">
            {t('common.name')}
          </label>
          <input id="new-project-name" className="field" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="new-project-engine" className="block font-medium">
              {t('newProject.engine')}
            </label>
            <select id="new-project-engine" className="field" value={engine} onChange={(e) => setEngine(e.target.value as EngineId)}>
              {ENGINE_LIST.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="new-project-database" className="block font-medium">
              {t('newProject.database')}
            </label>
            <input id="new-project-database" className="field" value={databaseName} spellCheck={false} onChange={(e) => setDatabaseName(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <span className="block font-medium">{t('newProject.startWith')}</span>
          <SegmentedControl<StartWith>
            label={t('newProject.startWith')}
            value={startWith}
            onChange={setStartWith}
            options={[
              { value: 'empty', label: t('newProject.empty') },
              { value: 'random', label: t('newProject.random') },
            ]}
          />
        </div>
        {startWith === 'random' && <NewProjectDialogRandomFields random={random} />}
        <Button variant="ghost" size="sm" onClick={importInstead}>
          {t('import.fromExisting')}
        </Button>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={!name.trim() || busy}>
            {startWith === 'random' ? t('newProject.generate') : t('newProject.create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default NewProjectDialog;
