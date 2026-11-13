import { useReactFlow } from '@xyflow/react';
import { useCallback } from 'react';
import { arrangeCollections } from '../../lib/actions';

/** Arranges collections left to right with dagre and saves the positions as one undo step. */
const useAutoLayout = () => {
  const { getNodes, fitView } = useReactFlow();

  return useCallback(() => {
    const nodes = getNodes();
    if (nodes.length === 0) return;
    arrangeCollections(new Map(nodes.map((n) => [n.id, { width: n.measured?.width ?? 280, height: n.measured?.height ?? 160 }])));
    requestAnimationFrame(() => void fitView({ padding: 0.15, duration: 250, maxZoom: 1 }));
  }, [getNodes, fitView]);
};

export default useAutoLayout;
