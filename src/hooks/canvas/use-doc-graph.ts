import { applyNodeChanges, type Edge, type FinalConnectionState, type Node, type NodeChange, useReactFlow } from '@xyflow/react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { linkFieldTo, moveCollections } from '../../lib/actions';
import { buildEdges, buildNodes, FIELD_HANDLE_PREFIX, type CollectionNodeType } from '../../lib/graph';
import useProjectStore from '../../stores/use-project-store';
import useUiStore from '../../stores/use-ui-store';
import useAdvisor from '../data/use-advisor';

const nodeIdAtPoint = (event: MouseEvent | TouchEvent) => {
  const point = 'changedTouches' in event ? event.changedTouches[0] : event;
  const el = document.elementFromPoint(point.clientX, point.clientY)?.closest('.react-flow__node');
  return el?.getAttribute('data-id') ?? undefined;
};

/** Pointer position, or the element's corner when the menu key opened the menu (no pointer). */
const pointOf = (event: ReactMouseEvent | MouseEvent) => {
  if (event.clientX || event.clientY) return { x: event.clientX, y: event.clientY };
  const rect = (event.target as Element).getBoundingClientRect();
  return { x: rect.left + 16, y: rect.top + 16 };
};

/** Nodes, edges and handlers for the document canvas, derived from the open project. */
const useDocGraph = () => {
  const project = useProjectStore((s) => s.project);
  const issues = useAdvisor();
  const selection = useUiStore((s) => s.selection);
  const collapsed = useUiStore((s) => s.collapsedFields);
  const hovered = useUiStore((s) => s.hoveredRelationshipId);
  const showLabels = useUiStore((s) => s.showRelationshipLabels);
  const [nodes, setNodes] = useState<CollectionNodeType[]>([]);
  const { screenToFlowPosition } = useReactFlow();

  useEffect(() => {
    if (!project) {
      setNodes([]);
      return;
    }
    const next = buildNodes({ project, selectedId: selection?.kind === 'collection' ? selection.id : undefined, collapsed, issues, hoveredRelationshipId: hovered });
    // Keep measured sizes so edges can pick sides without waiting for a new measurement.
    setNodes((prev) => {
      const measured = new Map(prev.map((n) => [n.id, n.measured]));
      return next.map((n) => ({ ...n, measured: measured.get(n.id) }));
    });
  }, [project, selection, collapsed, issues, hovered]);

  const edges = useMemo(
    () =>
      project
        ? buildEdges({ project, nodes, selectedRelationshipId: selection?.kind === 'relationship' ? selection.id : undefined, hoveredRelationshipId: hovered, showLabels })
        : [],
    [project, nodes, selection, hovered, showLabels],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<CollectionNodeType>[]) =>
      setNodes((current) => applyNodeChanges(changes.filter((c) => c.type !== 'select' && c.type !== 'remove'), current)),
    [],
  );

  const onNodeDragStop = useCallback((_: unknown, __: Node, dragged: Node[]) => {
    moveCollections(dragged.map((n) => ({ id: n.id, position: n.position })));
  }, []);

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    const ui = useUiStore.getState();
    if (ui.selection?.id !== node.id) ui.select({ kind: 'collection', id: node.id });
  }, []);

  const onEdgeClick = useCallback((_: unknown, edge: Edge) => {
    if (!edge.id.startsWith('sub:')) useUiStore.getState().select({ kind: 'relationship', id: edge.id });
  }, []);

  const onPaneClick = useCallback(() => {
    useUiStore.getState().select(null);
    useUiStore.getState().closeContextMenu();
  }, []);

  const onEdgeMouseEnter = useCallback((_: unknown, edge: Edge) => useUiStore.getState().setHoveredRelationship(edge.id), []);
  const onEdgeMouseLeave = useCallback(() => useUiStore.getState().setHoveredRelationship(null), []);

  const onNodeContextMenu = useCallback((event: ReactMouseEvent, node: Node) => {
    event.preventDefault();
    const { x, y } = pointOf(event);
    const ui = useUiStore.getState();
    ui.select({ kind: 'collection', id: node.id });
    ui.openContextMenu({ x, y, collectionId: node.id });
  }, []);

  const onPaneContextMenu = useCallback(
    (event: ReactMouseEvent | MouseEvent) => {
      event.preventDefault();
      const { x, y } = pointOf(event);
      useUiStore.getState().openContextMenu({ x, y, flowPosition: screenToFlowPosition({ x, y }) });
    },
    [screenToFlowPosition],
  );

  /**
   * Dragging a field row onto another collection makes it a reference; with Alt held, an embed.
   * Dragging the collection's own connector opens the relationship dialog with both ends filled in.
   */
  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    const fromId = state.fromNode?.id;
    const toId = state.toNode?.id ?? nodeIdAtPoint(event);
    if (!fromId || !toId) return;
    const handle = state.fromHandle?.id ?? '';
    const alt = 'altKey' in event && event.altKey;
    if (handle.startsWith(FIELD_HANDLE_PREFIX)) {
      if (fromId === toId && !alt) return;
      linkFieldTo(fromId, handle.slice(FIELD_HANDLE_PREFIX.length), toId, alt);
      return;
    }
    useUiStore.getState().openRelationshipDialog({ fromId, toId, kind: alt ? 'embed' : 'reference' });
  }, []);

  return {
    nodes,
    edges,
    onNodesChange,
    onNodeDragStop,
    onNodeClick,
    onEdgeClick,
    onPaneClick,
    onEdgeMouseEnter,
    onEdgeMouseLeave,
    onNodeContextMenu,
    onPaneContextMenu,
    onConnectEnd,
  };
};

export default useDocGraph;
