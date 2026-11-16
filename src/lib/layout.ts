import dagre from '@dagrejs/dagre';
import { walkFields } from '../domain/paths';
import type { Project } from '../domain/types';

export const NODE_WIDTH = 280;

export type LayoutNode = { id: string; width: number; height: number };
/** [referenced collection, collection that points at it]: referenced collections end up on the left. */
export type LayoutEdge = [string, string];

const GAP_X = 80;
const GAP_Y = 60;

/**
 * Left to right layout with dagre for the collections joined by references, and a grid in reading
 * order below them for the ones with no reference, which dagre would stack in one tall column.
 * Returns the top left corner of each node.
 */
export const layoutNodes = (nodes: LayoutNode[], edges: LayoutEdge[]): Map<string, { x: number; y: number }> => {
  const ids = new Set(nodes.map((n) => n.id));
  const valid = edges.filter(([from, to]) => from !== to && ids.has(from) && ids.has(to));
  const linked = new Set(valid.flat());
  const connected = nodes.filter((n) => linked.has(n.id));
  const alone = nodes.filter((n) => !linked.has(n.id));
  const positions = new Map<string, { x: number; y: number }>();
  let bottom = 20;
  if (connected.length) {
    const graph = new dagre.graphlib.Graph();
    graph.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 120, marginx: 20, marginy: 20 });
    graph.setDefaultEdgeLabel(() => ({}));
    for (const node of connected) graph.setNode(node.id, { width: node.width, height: node.height });
    for (const [from, to] of valid) graph.setEdge(from, to);
    dagre.layout(graph);
    for (const node of connected) {
      const { x, y, width, height } = graph.node(node.id);
      const top = { x: Math.round(x - width / 2), y: Math.round(y - height / 2) };
      positions.set(node.id, top);
      bottom = Math.max(bottom, top.y + height + GAP_Y);
    }
  }
  if (alone.length) {
    const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(alone.length))));
    let y = connected.length ? bottom : 20;
    for (let row = 0; row * columns < alone.length; row += 1) {
      const items = alone.slice(row * columns, (row + 1) * columns);
      let x = 20;
      for (const node of items) {
        positions.set(node.id, { x, y });
        x += node.width + GAP_X;
      }
      y += Math.max(...items.map((n) => n.height)) + GAP_Y;
    }
  }
  return positions;
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
