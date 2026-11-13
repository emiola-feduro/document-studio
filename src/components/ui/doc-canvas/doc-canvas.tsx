import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow } from '@xyflow/react';
import useDocGraph from '../../../hooks/canvas/use-doc-graph';
import useFitOnOpen from '../../../hooks/canvas/use-fit-on-open';
import { getTheme } from '../../../lib/themes/themes';
import usePreferencesStore from '../../../stores/use-preferences-store';
import useUiStore from '../../../stores/use-ui-store';
import DocCanvasContextMenu from './doc-canvas-context-menu';
import DocCanvasEdge from './doc-canvas-edge';
import DocCanvasEmpty from './doc-canvas-empty';
import DocCanvasLegend from './doc-canvas-legend';
import DocCanvasNode from './doc-canvas-node';
import DocCanvasToolbar from './doc-canvas-toolbar';

const nodeTypes = { collection: DocCanvasNode };
const edgeTypes = { relation: DocCanvasEdge };

const patterns = {
  dots: BackgroundVariant.Dots,
  lines: BackgroundVariant.Lines,
  cross: BackgroundVariant.Cross,
} as const;

const DocCanvas = () => {
  const { nodes, edges, ...handlers } = useDocGraph();
  useFitOnOpen();
  const themeId = usePreferencesStore((s) => s.themeId);
  const { pattern, dark } = getTheme(themeId);
  const focusMode = useUiStore((s) => s.focusMode);

  return (
    <div className="relative h-full w-full bg-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
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
        {!focusMode && nodes.length > 0 && <DocCanvasToolbar />}
        {nodes.length > 0 && <DocCanvasLegend />}
        <DocCanvasContextMenu />
      </ReactFlow>
      {nodes.length === 0 && <DocCanvasEmpty />}
    </div>
  );
};

export default DocCanvas;
