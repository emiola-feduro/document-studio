import { countFields } from '../../../domain/model';
import { PATTERNS } from '../../../domain/advisor';
import useAdvisor from '../../../hooks/data/use-advisor';
import useT from '../../../hooks/ui/use-t';
import useProjectStore from '../../../stores/use-project-store';
import PanelHideButton from '../../ui/panel-hide-button/panel-hide-button';
import InspectorIssueList from './inspector-issue-list';
import InspectorSection from './inspector-section';

const InspectorOverview = () => {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const issues = useAdvisor();
  if (!project) return null;
  const { collections, relationships } = project;
  const documents = Object.values(project.documents ?? {}).reduce((n, d) => n + d.length, 0);
  const stats = [
    [t('inspector.stats.collections'), collections.length],
    [t('inspector.stats.relationships'), relationships.length],
    [t('inspector.stats.fields'), collections.reduce((n, c) => n + countFields(c.fields), 0)],
    [t('inspector.stats.indexes'), collections.reduce((n, c) => n + c.indexes.length, 0)],
    [t('inspector.stats.documents'), documents],
  ] as const;
  const shortcuts = [
    ['E', t('inspector.shortcut.newCollection')],
    [t('inspector.shortcut.deleteKey'), t('inspector.shortcut.delete')],
    ['Ctrl+Z', t('inspector.shortcut.undo')],
    ['Ctrl+Y', t('inspector.shortcut.redo')],
    ['F', t('inspector.shortcut.focus')],
    [t('inspector.shortcut.panelsKeys'), t('inspector.shortcut.panels')],
    ['Esc', t('inspector.shortcut.deselect')],
    [t('inspector.shortcut.dragKey'), t('inspector.shortcut.drag')],
    [t('inspector.shortcut.altDragKey'), t('inspector.shortcut.altDrag')],
  ];
  const serious = issues.filter((i) => i.level !== 'info');
  const tips = issues.filter((i) => i.level === 'info');

  return (
    <>
      <div className="border-b border-line px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[1.15em] font-semibold">{t('inspector.overview')}</h2>
          <PanelHideButton panel="inspector" />
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
          {stats.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-2">
              <dt className="text-muted">{label}</dt>
              <dd className="font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <InspectorSection title={serious.length ? t('common.warningsTitle', { count: serious.length }) : t('common.warnings')}>
        <InspectorIssueList issues={serious} />
      </InspectorSection>
      {tips.length > 0 && (
        <InspectorSection title={t('inspector.tips', { count: tips.length })}>
          <InspectorIssueList issues={tips} />
        </InspectorSection>
      )}
      <InspectorSection title={t('inspector.patterns')}>
        <ul className="space-y-1">
          {PATTERNS.map((p) => (
            <li key={p.id}>
              <details className="group">
                <summary className="cursor-pointer rounded-[calc(var(--radius)*0.5)] px-1 py-0.5 font-medium hover:bg-surface-2">{t(p.name)}</summary>
                <p className="px-1 pt-1 pb-2 text-muted">{t(p.text)}</p>
              </details>
            </li>
          ))}
        </ul>
      </InspectorSection>
      <InspectorSection title={t('inspector.shortcuts')}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
          {shortcuts.map(([key, label]) => (
            <div key={key} className="contents">
              <dt className="font-mono font-semibold">{key}</dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
      </InspectorSection>
    </>
  );
};

export default InspectorOverview;
