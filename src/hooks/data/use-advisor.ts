import { useMemo } from 'react';
import { activeIssues, type Issue } from '../../domain/advisor';
import useProjectStore from '../../stores/use-project-store';
import usePreferencesStore from '../../stores/use-preferences-store';

const useAdvisorResult = () => {
  const project = useProjectStore((s) => s.project);
  const locale = usePreferencesStore((s) => s.locale);
  return useMemo(() => (project ? activeIssues(project) : { issues: [], dismissedCount: 0 }), [project, locale]); // eslint-disable-line react-hooks/exhaustive-deps
};

/** Advisor warnings for the open project, without the ignored ones, recomputed when the model or the language changes. */
const useAdvisor = (): Issue[] => useAdvisorResult().issues;

/** How many warnings the person chose to ignore. */
export const useDismissedCount = () => useAdvisorResult().dismissedCount;

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
