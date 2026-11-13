import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import type { RelationEdgeType } from '../../../lib/graph';
import DocCanvasMarker from './doc-canvas-marker';

const DocCanvasEdge = ({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<RelationEdgeType>) => {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 10,
    offset: source === target ? 36 : 28,
  });
  if (!data) return null;
  const { kind, sourceEnd, targetEnd, highlighted, showLabel, label, relationship } = data;
  const color = highlighted ? 'var(--c-edge-hl)' : kind === 'embed' ? 'var(--c-accent)' : 'var(--c-edge)';
  const startId = `m-${id}-start`;
  const endId = `m-${id}-end`;
  const text = kind === 'subcollection' ? label : label ?? (relationship ? relationship.cardinality : undefined);
  const labelAnchor = source === target ? 'translate(6px, -50%)' : 'translate(-50%, -50%)';

  return (
    <>
      <defs>
        <DocCanvasMarker id={startId} kind={sourceEnd} color={color} />
        <DocCanvasMarker id={endId} kind={targetEnd} color={color} />
      </defs>
      <BaseEdge
        id={id}
        path={path}
        markerStart={sourceEnd === 'none' ? undefined : `url(#${startId})`}
        markerEnd={targetEnd === 'none' ? undefined : `url(#${endId})`}
        className={`rel-edge-path ${highlighted ? 'is-hl' : ''}`}
        style={{ stroke: color, strokeWidth: highlighted ? 2.5 : 1.6, strokeDasharray: kind === 'subcollection' ? '6 5' : undefined }}
        interactionWidth={16}
      />
      {text && (showLabel || highlighted) && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute rounded-[calc(var(--radius)*0.5)] border border-line bg-surface px-1.5 py-0.5 font-canvas text-[11px] leading-tight text-muted"
            style={{ transform: `translate(${labelX}px, ${labelY}px) ${labelAnchor}`, borderColor: highlighted ? 'var(--c-edge-hl)' : undefined, color: highlighted ? 'var(--c-fg)' : undefined }}
          >
            {text}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

export default DocCanvasEdge;
