import ResizeHandle from '../../ui/resize-handle/resize-handle';
import useT from '../../../hooks/ui/use-t';
import InspectorOverview from './inspector-overview';

const Inspector = () => {
  const t = useT();

  return (
    <aside aria-label={t('inspector.label')} className="relative flex min-h-0 flex-col border-l border-line bg-surface">
      <ResizeHandle panel="inspector" label={t('inspector.resize')} />
      {/* The handle stays outside the scrolling area so it covers the whole edge. */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
        <InspectorOverview />
      </div>
    </aside>
  );
};

export default Inspector;
