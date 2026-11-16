import type { Issue } from '../../../domain/advisor';
import useT from '../../../hooks/ui/use-t';
import { applyIssueFix, dismissIssue, fixLabel } from '../../../lib/actions';
import useProjectStore from '../../../stores/use-project-store';
import useUiStore from '../../../stores/use-ui-store';
import Button from '../../ui/button/button';
import Pill from '../../ui/pill/pill';

const tone = { error: 'danger', warning: 'warning', info: 'neutral' } as const;
const label = { error: 'common.error', warning: 'common.warning', info: 'common.tip' } as const;

/** Advisor findings with what can be done about each: go to it, fix it in one click, or ignore it. */
const InspectorIssueList = ({ issues }: { issues: Issue[] }) => {
  const t = useT();
  const select = useUiStore((s) => s.select);
  const selection = useUiStore((s) => s.selection);
  const project = useProjectStore((s) => s.project);
  if (issues.length === 0) return <p className="text-success">{t('common.noWarnings')}</p>;

  const targetName = (issue: Issue) =>
    issue.relationshipId
      ? project?.relationships.find((r) => r.id === issue.relationshipId)?.from.fieldPath
      : project?.collections.find((c) => c.id === issue.collectionId)?.name;

  return (
    <ul className="space-y-2">
      {issues.map((issue) => {
        const { id, level, message, collectionId, relationshipId, fixes = [] } = issue;
        const target = relationshipId ? ({ kind: 'relationship', id: relationshipId } as const) : collectionId ? ({ kind: 'collection', id: collectionId } as const) : null;
        return (
          <li key={id} className="space-y-1.5 rounded-[calc(var(--radius)*0.75)] p-1.5 hover:bg-surface-2">
            <div className="flex items-start gap-2">
              <Pill tone={tone[level]}>{t(label[level])}</Pill>
              <span className="flex-1 font-normal leading-snug">{message}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {fixes.map((fix) => (
                <Button key={JSON.stringify(fix)} size="sm" onClick={() => applyIssueFix(fix)}>
                  {fixLabel(fix)}
                </Button>
              ))}
              {/* "View" is left out when the inspector already shows what the issue is about. */}
              {target && selection?.id !== target.id && (
                <Button size="sm" variant="ghost" aria-label={t('advisor.viewLabel', { name: targetName(issue) ?? '' })} onClick={() => select(target)}>
                  {t('advisor.view')}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => dismissIssue(id)}>
                {t('advisor.dismiss')}
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
};

export default InspectorIssueList;
