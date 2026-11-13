import { useMemo } from 'react';
import { adviseProject, type Issue } from '../../domain/advisor';
import useProjectStore from '../../stores/use-project-store';
import usePreferencesStore from '../../stores/use-preferences-store';

/** Advisor warnings for the open project, recomputed when the model or the language changes. */
const useAdvisor = (): Issue[] => {
  const project = useProjectStore((s) => s.project);
  const locale = usePreferencesStore((s) => s.locale);
  return useMemo(() => (project ? adviseProject(project) : []), [project, locale]); // eslint-disable-line react-hooks/exhaustive-deps
};

/** Number of warnings per collection or relationship id. */
export const useIssueCounts = () => {
  const issues = useAdvisor();
  return useMemo(() => {
    const counts = new Map<string, number>();
    for (const issue of issues) {
      if (issue.level === 'info') continue;
      const key = issue.collectionId ?? issue.relationshipId;
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [issues]);
};

export default useAdvisor;
