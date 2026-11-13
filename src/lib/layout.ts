import dagre from '@dagrejs/dagre';
import { walkFields } from '../domain/paths';
import type { Project } from '../domain/types';

export const NODE_WIDTH = 280;

export type LayoutNode = { id: string; width: number; height: number };
/** [referenced collection, collection that points at it]: referenced collections end up on the left. */
export type LayoutEdge = [string, string];

/** Left to right layout with dagre. Returns the top left corner of each node. */
export const layoutNodes = (nodes: LayoutNode[], edges: LayoutEdge[]): Map<string, { x: number; y: number }> => {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 120, marginx: 20, marginy: 20 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) graph.setNode(node.id, { width: node.width, height: node.height });
  for (const [from, to] of edges) if (from !== to && graph.hasNode(from) && graph.hasNode(to)) graph.setEdge(from, to);
  dagre.layout(graph);
  return new Map(
    nodes.map((node) => {
      const { x, y, width, height } = graph.node(node.id);
      return [node.id, { x: Math.round(x - width / 2), y: Math.round(y - height / 2) }];
    }),
  );
};

/** Header plus one line per field, close to what the canvas renders before it measures. */
const estimatedHeight = (rows: number) => 48 + Math.max(1, rows) * 25;

const edgesOf = (project: Project): LayoutEdge[] => [
  ...project.relationships.map((r): LayoutEdge => [r.to.collectionId, r.from.collectionId]),
  ...project.collections.filter((c) => c.parentId).map((c): LayoutEdge => [c.parentId!, c.id]),
];

/** Positions for a project that has not been drawn yet, such as a generated or imported model. */
export const layoutProject = (project: Project) => {
  const positions = layoutNodes(
    project.collections.map((c) => ({ id: c.id, width: NODE_WIDTH, height: estimatedHeight(walkFields(c.fields).length) })),
    edgesOf(project),
  );
  for (const c of project.collections) c.position = positions.get(c.id) ?? c.position;
};

export const layoutMeasured = (project: Project, sizes: Map<string, { width: number; height: number }>) =>
  layoutNodes(
    project.collections.map((c) => ({ id: c.id, width: sizes.get(c.id)?.width ?? NODE_WIDTH, height: sizes.get(c.id)?.height ?? estimatedHeight(walkFields(c.fields).length) })),
    edgesOf(project),
  );
