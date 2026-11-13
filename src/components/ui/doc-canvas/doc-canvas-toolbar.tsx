import { useReactFlow } from '@xyflow/react';
import useAutoLayout from '../../../hooks/canvas/use-auto-layout';
import useT from '../../../hooks/ui/use-t';
import { addCollection } from '../../../lib/actions';
import useUiStore from '../../../stores/use-ui-store';
import Button from '../button/button';
import Checkbox from '../checkbox/checkbox';

const DocCanvasToolbar = () => {
  const t = useT();
  const autoLayout = useAutoLayout();
  const { fitView, screenToFlowPosition } = useReactFlow();
  const showLabels = useUiStore((s) => s.showRelationshipLabels);
  const toggleLabels = useUiStore((s) => s.toggleRelationshipLabels);
  const openRelationshipDialog = useUiStore((s) => s.openRelationshipDialog);

  const addAtCenter = () => {
    const pane = document.querySelector('.react-flow')?.getBoundingClientRect();
    addCollection(pane ? screenToFlowPosition({ x: pane.left + pane.width / 2 - 140, y: pane.top + pane.height / 2 - 60 }) : undefined);
  };

  return (
    <div className="absolute top-3 left-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-2 rounded-theme border-(length:--bw) border-line bg-surface/90 p-1.5 shadow-theme backdrop-blur-sm">
      <Button variant="primary" size="sm" onClick={addAtCenter} title={t('common.shortcut', { key: 'E' })}>
        {t('canvas.newCollection')}
      </Button>
      <Button size="sm" onClick={() => openRelationshipDialog()}>
        {t('canvas.newRelationship')}
      </Button>
      <span className="mx-1 h-5 w-px bg-line" aria-hidden />
      <Button size="sm" variant="ghost" onClick={autoLayout}>
        {t('canvas.arrange')}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => void fitView({ padding: 0.15, duration: 250, maxZoom: 1 })}>
        {t('canvas.fitView')}
      </Button>
      <span className="mx-1 h-5 w-px bg-line" aria-hidden />
      <span className="px-1">
        <Checkbox label={t('canvas.relationshipLabels')} checked={showLabels} onChange={toggleLabels} />
      </span>
    </div>
  );
};

export default DocCanvasToolbar;
