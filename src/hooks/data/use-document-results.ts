import { useMemo } from 'react';
import { validateDocuments, type DocResult } from '../../domain/documents';
import useProjectStore from '../../stores/use-project-store';
import usePreferencesStore from '../../stores/use-preferences-store';

/** Validation of one collection's sample documents against the model. */
const useDocumentResults = (collectionId: string | null): DocResult[] => {
  const project = useProjectStore((s) => s.project);
  const locale = usePreferencesStore((s) => s.locale);
  return useMemo(() => {
    const collection = project?.collections.find((c) => c.id === collectionId);
    return project && collection ? validateDocuments(project, collection) : [];
  }, [project, collectionId, locale]); // eslint-disable-line react-hooks/exhaustive-deps
};

export default useDocumentResults;
