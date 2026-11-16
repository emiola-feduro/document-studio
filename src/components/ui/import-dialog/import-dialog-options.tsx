import type { ImportFormState } from '../../../hooks/data/use-import-form';
import useT from '../../../hooks/ui/use-t';
import { LOCALES, type Locale } from '../../../i18n';
import type { EngineId } from '../../../domain/types';
import SegmentedControl from '../segmented-control/segmented-control';

/** Where the import goes and, for a new project, its name, engine and names language. */
const ImportDialogOptions = ({ form }: { form: ImportFormState }) => {
  const t = useT();
  const { destination, setDestination, canChooseDestination, projectName, setProjectName, engine, setEngine, engines, namesLocale, setNamesLocale, detectedLocale } = form;
  if (!canChooseDestination) return null;
  const detectedName = LOCALES.find((l) => l.id === detectedLocale)?.name;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <span className="block font-medium">{t('import.destination')}</span>
        <SegmentedControl<'current' | 'new'>
          label={t('import.destination')}
          value={destination}
          onChange={setDestination}
          options={[
            { value: 'current', label: t('import.currentProject') },
            { value: 'new', label: t('import.newProject') },
          ]}
        />
      </div>
      {destination === 'new' && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label htmlFor="import-project-name" className="block font-medium">
              {t('import.projectName')}
            </label>
            <input id="import-project-name" className="field" value={projectName} required onChange={(e) => setProjectName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="import-engine" className="block font-medium">
              {t('newProject.engine')}
            </label>
            <select id="import-engine" className="field" value={engine} onChange={(e) => setEngine(e.target.value as EngineId)}>
              {engines.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="import-names-locale" className="block font-medium">
              {t('import.namesLocale')}
            </label>
            <select id="import-names-locale" className="field" value={namesLocale} onChange={(e) => setNamesLocale(e.target.value as Locale | 'auto')}>
              <option value="auto">{detectedName ? t('import.namesDetected', { language: detectedName }) : t('import.auto')}</option>
              {LOCALES.map(({ id, name }) => (
                <option key={id} value={id} lang={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImportDialogOptions;
