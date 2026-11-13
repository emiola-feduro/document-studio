import useT from '../../../hooks/ui/use-t';
import { countFields } from '../../../domain/model';
import useProjectStore from '../../../stores/use-project-store';
import PanelHideButton from '../../ui/panel-hide-button/panel-hide-button';
import InspectorSection from './inspector-section';

const InspectorOverview = () => {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  if (!project) return null;
  const { collections, relationships } = project;
  const stats = [
    [t('inspector.stats.collections'), collections.length],
    [t('inspector.stats.relationships'), relationships.length],
    [t('inspector.stats.fields'), collections.reduce((n, c) => n + countFields(c.fields), 0)],
    [t('inspector.stats.indexes'), collections.reduce((n, c) => n + c.indexes.length, 0)],
  ] as const;
  const shortcuts = [
    ['E', t('inspector.shortcut.newCollection')],
    [t('inspector.shortcut.deleteKey'), t('inspector.shortcut.delete')],
    ['Ctrl+Z', t('inspector.shortcut.undo')],
    ['Ctrl+Y', t('inspector.shortcut.redo')],
    ['F', t('inspector.shortcut.focus')],
    [t('inspector.shortcut.panelsKeys'), t('inspector.shortcut.panels')],
    ['Esc', t('inspector.shortcut.deselect')],
  ];

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
