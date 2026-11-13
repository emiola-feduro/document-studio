import { applyNodeChanges, type Node, type NodeChange } from '@xyflow/react';
import { useCallback, useEffect, useState } from 'react';
import type { Collection, EngineId } from '../../domain/types';
import { moveCollections } from '../../lib/actions';
import useProjectStore from '../../stores/use-project-store';
import useUiStore from '../../stores/use-ui-store';

export type CollectionNodeData = { collection: Collection; engine: EngineId };
export type CollectionNodeType = Node<CollectionNodeData, 'collection'>;

/** Nodes and handlers for the document canvas, derived from the open project. */
const useDocGraph = () => {
  const project = useProjectStore((s) => s.project);
  const selection = useUiStore((s) => s.selection);
  const [nodes, setNodes] = useState<CollectionNodeType[]>([]);

  useEffect(() => {
    if (!project) {
      setNodes([]);
      return;
    }
    const selectedId = selection?.kind === 'collection' ? selection.id : undefined;
    // Keep measured sizes between rebuilds so the canvas does not flicker.
    setNodes((prev) => {
      const measured = new Map(prev.map((n) => [n.id, n.measured]));
      return project.collections.map((collection) => ({
        id: collection.id,
        type: 'collection' as const,
        position: collection.position,
        data: { collection, engine: project.engine },
        selected: collection.id === selectedId,
        measured: measured.get(collection.id),
      }));
    });
  }, [project, selection]);

  const onNodesChange = useCallback(
    (changes: NodeChange<CollectionNodeType>[]) =>
      setNodes((current) => applyNodeChanges(changes.filter((c) => c.type !== 'select' && c.type !== 'remove'), current)),
    [],
  );

  const onNodeDragStop = useCallback((_: unknown, __: Node, dragged: Node[]) => {
    moveCollections(dragged.map((n) => ({ id: n.id, position: n.position })));
  }, []);

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    useUiStore.getState().select({ kind: 'collection', id: node.id });
  }, []);

  const onPaneClick = useCallback(() => useUiStore.getState().select(null), []);

  return { nodes, onNodesChange, onNodeDragStop, onNodeClick, onPaneClick };
};

export default useDocGraph;
