import { getLocale, t, type Locale } from '../../i18n';
import { useEffect, useState, type FormEvent } from 'react';
import { maxCollections, MIN_COLLECTIONS, THEMES } from '../../domain/random-model';
import type { EngineId } from '../../domain/types';
import { createRandomProject } from '../../lib/random-project';
import useProjectStore from '../../stores/use-project-store';
import usePreferencesStore from '../../stores/use-preferences-store';
import useUiStore from '../../stores/use-ui-store';

export type StartWith = 'empty' | 'random';

export const MAX_DOCUMENTS = 200;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value) || min));

/** State and submit of the new project dialog, empty or with a random model. */
const useNewProjectForm = (onDone: () => void) => {
  const createProject = useProjectStore((s) => s.createProject);
  const importProject = useProjectStore((s) => s.importProject);
  const [name, setName] = useState(() => t('projects.defaultName'));
  const [nameTouched, setNameTouched] = useState(false);
  const [engine, setEngine] = useState<EngineId>('mongodb');
  const [databaseName, setDatabaseName] = useState('');
  const startWith = useUiStore((s) => s.newProjectStart);
  const setStartWith = useUiStore((s) => s.setNewProjectStart);
  const [themeId, setThemeId] = useState('');
  const [collectionCount, setCollectionCount] = useState(3);
  const [withDocuments, setWithDocuments] = useState(true);
  const [documentCount, setDocumentCount] = useState(10);
  const [busy, setBusy] = useState(false);
  // Names follow the interface language unless the person picks another one.
  const [namesLocale, setNamesLocale] = useState<Locale>(getLocale);
  const uiLocale = usePreferencesStore((s) => s.locale);
  useEffect(() => setNamesLocale(uiLocale), [uiLocale]);

  const maxCount = maxCollections(themeId || undefined);
  const random = startWith === 'random';

  const reset = () => {
    setName(t('projects.defaultName'));
    setNameTouched(false);
    setDatabaseName('');
    setBusy(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      if (random) {
        const project = createRandomProject({
          // Without a custom name the project takes the theme name, which says more than "Nuevo proyecto".
          name: nameTouched ? name : '',
          engine,
          databaseName,
          themeId: themeId || undefined,
          collectionCount: clamp(collectionCount, MIN_COLLECTIONS, maxCount),
          documentsPerCollection: withDocuments ? clamp(documentCount, 1, MAX_DOCUMENTS) : 0,
          namesLocale,
        });
        await importProject(project);
        useUiStore.getState().setView('diagram');
      } else {
        await createProject(name.trim(), engine, databaseName);
      }
      useUiStore.getState().select(null);
      onDone();
      reset();
    } catch {
      setBusy(false);
      useUiStore.getState().notify(t('projects.createFailed'), 'error');
    }
  };

  return {
    fields: {
      name,
      setName: (value: string) => {
        setName(value);
        setNameTouched(true);
      },
      engine,
      setEngine,
      databaseName,
      setDatabaseName,
      startWith,
      setStartWith,
    },
    random: {
      themes: THEMES,
      themeId,
      setThemeId,
      collectionCount,
      setCollectionCount,
      minCount: MIN_COLLECTIONS,
      maxCount,
      withDocuments,
      setWithDocuments,
      documentCount,
      setDocumentCount,
      namesLocale,
      setNamesLocale,
    },
    busy,
    submit,
  };
};

export default useNewProjectForm;
