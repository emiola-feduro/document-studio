import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow } from '@xyflow/react';
import useDocGraph from '../../../hooks/canvas/use-doc-graph';
import useFitOnOpen from '../../../hooks/canvas/use-fit-on-open';
import useT from '../../../hooks/ui/use-t';
import { addCollection } from '../../../lib/actions';
import { getTheme } from '../../../lib/themes/themes';
import usePreferencesStore from '../../../stores/use-preferences-store';
import useUiStore from '../../../stores/use-ui-store';
import Button from '../button/button';
import DocCanvasEmpty from './doc-canvas-empty';
import DocCanvasNode from './doc-canvas-node';

const nodeTypes = { collection: DocCanvasNode };

const patterns = {
  dots: BackgroundVariant.Dots,
  lines: BackgroundVariant.Lines,
  cross: BackgroundVariant.Cross,
} as const;

const DocCanvas = () => {
  const t = useT();
  const { nodes, ...handlers } = useDocGraph();
  useFitOnOpen();
  const themeId = usePreferencesStore((s) => s.themeId);
  const { pattern, dark } = getTheme(themeId);
  const focusMode = useUiStore((s) => s.focusMode);

  return (
    <div className="relative h-full w-full bg-canvas" aria-label={t('canvas.label')}>
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        colorMode={dark ? 'dark' : 'light'}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        {...handlers}
      >
        {pattern !== 'none' && (
          <Background variant={patterns[pattern]} gap={pattern === 'dots' ? 18 : 24} size={pattern === 'dots' ? 1.4 : 1} color="var(--c-grid)" />
        )}
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          pannable
          zoomable
          nodeColor="var(--c-node-header)"
          nodeStrokeColor="var(--c-node-border)"
          maskColor="color-mix(in srgb, var(--c-canvas) 70%, transparent)"
          position="bottom-right"
        />
      </ReactFlow>
      {!focusMode && nodes.length > 0 && (
        <div className="absolute top-3 left-3 z-10 rounded-theme border-(length:--bw) border-line bg-surface/90 p-1.5 shadow-theme backdrop-blur-sm">
          <Button size="sm" variant="primary" onClick={() => addCollection()} title={t('common.shortcut', { key: 'E' })}>
            {t('canvas.newCollection')}
          </Button>
        </div>
      )}
      {nodes.length === 0 && <DocCanvasEmpty />}
    </div>
  );
};

export default DocCanvas;
