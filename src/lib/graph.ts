import type { Edge, Node } from '@xyflow/react';
import type { Issue } from '../domain/advisor';
import { docIdParam } from '../domain/model';
import { childList, fieldAtPath, walkFields, type PathEntry } from '../domain/paths';
import type { Collection, EngineId, Project, Relationship } from '../domain/types';
import { NODE_WIDTH } from './layout';

export { NODE_WIDTH };

export type FieldRow = PathEntry & {
  /** The row has children and they are folded. */
  collapsed: boolean;
  hasChildren: boolean;
  /** Paths kept in indexes, and in unique indexes. */
  indexed: boolean;
  unique: boolean;
  /** Inside a field filled by an embed relationship. */
  embedded: boolean;
  referenceTarget?: string;
};

export type CollectionNodeData = {
  collection: Collection;
  engine: EngineId;
  rows: FieldRow[];
  issueCount: number;
  parentName?: string;
  highlightedPaths: string[];
};

export type CollectionNodeType = Node<CollectionNodeData, 'collection'>;

export type EndMarker = 'one' | 'zeroOrOne' | 'many' | 'zeroOrMany' | 'diamond' | 'none';

export type RelationEdgeData = {
  kind: 'reference' | 'embed' | 'subcollection';
  relationship?: Relationship;
  label?: string;
  sourceEnd: EndMarker;
  targetEnd: EndMarker;
  highlighted: boolean;
  showLabel: boolean;
};

export type RelationEdgeType = Edge<RelationEdgeData, 'relation'>;

/** Handle on each field row; dragging it onto another collection creates a reference (Alt: an embed). */
export const FIELD_HANDLE_PREFIX = 'field:';
export const HEADER = 'header';

export const handleId = (rowId: string, side: 'L' | 'R', type: 's' | 't') => `${rowId}|${side}|${type}`;

/** Rows the node shows, skipping the children of folded fields. */
export const visibleRows = (collection: Collection, collapsed: Record<string, true>, project: Project): FieldRow[] => {
  const indexedPaths = new Set(collection.indexes.flatMap((i) => i.keys.map((k) => k.path.replace(/\[\]/g, ''))));
  const uniquePaths = new Set(collection.indexes.filter((i) => i.unique && i.keys.length === 1).map((i) => i.keys[0].path.replace(/\[\]/g, '')));
  const embedRoots = project.relationships.filter((r) => r.kind === 'embed' && r.from.collectionId === collection.id).map((r) => r.from.fieldPath);
  const rows: FieldRow[] = [];
  let hiddenUnder: string | undefined;
  for (const entry of walkFields(collection.fields)) {
    if (hiddenUnder && (entry.path.startsWith(`${hiddenUnder}.`) || entry.path.startsWith(`${hiddenUnder}[]`))) continue;
    hiddenUnder = undefined;
    const hasChildren = Boolean(childList(entry.field)?.length);
    const isCollapsed = hasChildren && Boolean(collapsed[entry.field.id]);
    if (isCollapsed) hiddenUnder = entry.path;
    const plain = entry.path.replace(/\[\]/g, '');
    const holder = entry.field.type === 'array' ? entry.field.items : entry.field;
    const target = holder?.reference && project.collections.find((c) => c.id === holder.reference!.collectionId);
    rows.push({
      ...entry,
      collapsed: isCollapsed,
      hasChildren,
      indexed: indexedPaths.has(plain),
      unique: uniquePaths.has(plain),
      embedded: embedRoots.some((root) => entry.path === root || entry.path.startsWith(`${root}.`) || entry.path.startsWith(`${root}[]`)),
      referenceTarget: target ? target.name : undefined,
    });
  }
  return rows;
};

type NodeInput = {
  project: Project;
  selectedId?: string;
  collapsed: Record<string, true>;
  issues: Issue[];
  hoveredRelationshipId: string | null;
};

export const buildNodes = ({ project, selectedId, collapsed, issues, hoveredRelationshipId }: NodeInput): CollectionNodeType[] => {
  const hovered = hoveredRelationshipId ? project.relationships.find((r) => r.id === hoveredRelationshipId) : undefined;
  return project.collections.map((collection) => {
    const parent = collection.parentId ? project.collections.find((c) => c.id === collection.parentId) : undefined;
    const highlightedPaths = hovered
      ? [...(hovered.from.collectionId === collection.id ? [hovered.from.fieldPath] : []), ...(hovered.to.collectionId === collection.id ? ['_id', hovered.reverseFieldPath ?? ''] : [])]
      : [];
    return {
      id: collection.id,
      type: 'collection',
      position: collection.position,
      selected: collection.id === selectedId,
      data: {
        collection,
        engine: project.engine,
        rows: visibleRows(collection, collapsed, project),
        issueCount: issues.filter((i) => i.collectionId === collection.id && i.level !== 'info').length,
        parentName: collection.kind === 'subcollection' ? parent?.name : undefined,
        highlightedPaths,
      },
    };
  });
};

/** Row that draws an edge for a path: the field itself, or its closest visible parent. */
const rowFor = (node: CollectionNodeType | undefined, path: string) => {
  if (!node) return HEADER;
  const rows = node.data.rows;
  let current = path;
  while (current) {
    const row = rows.find((r) => r.path === current);
    if (row) return row.field.id;
    const cut = Math.max(current.lastIndexOf('.'), current.lastIndexOf('[]'));
    if (cut <= 0) break;
    current = current.slice(0, cut).replace(/\[\]$/, '');
  }
  return HEADER;
};

const idRow = (node: CollectionNodeType | undefined) => node?.data.rows.find((r) => r.depth === 0 && r.field.name === '_id')?.field.id ?? HEADER;

const centerX = (node: Node | undefined) => (node ? node.position.x + (node.measured?.width ?? NODE_WIDTH) / 2 : 0);

type EdgeInput = {
  project: Project;
  nodes: CollectionNodeType[];
  selectedRelationshipId?: string;
  hoveredRelationshipId: string | null;
  showLabels: boolean;
};

const sides = (from: Node | undefined, to: Node | undefined, self: boolean) => {
  const left = centerX(from) <= centerX(to);
  return { source: self || left ? 'R' : 'L', target: self ? 'R' : left ? 'L' : 'R' } as const;
};

export const buildEdges = ({ project, nodes, selectedRelationshipId, hoveredRelationshipId, showLabels }: EdgeInput): RelationEdgeType[] => {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: RelationEdgeType[] = [];
  for (const rel of project.relationships) {
    const fromNode = byId.get(rel.from.collectionId);
    const toNode = byId.get(rel.to.collectionId);
    if (!fromNode || !toNode) continue;
    const self = rel.from.collectionId === rel.to.collectionId;
    const side = sides(fromNode, toNode, self);
    const highlighted = rel.id === selectedRelationshipId || rel.id === hoveredRelationshipId;
    const from = project.collections.find((c) => c.id === rel.from.collectionId)!;
    const field = fieldAtPath(from.fields, rel.from.fieldPath);
    const required = field?.required ?? false;
    const many = rel.cardinality !== '1:1';
    edges.push({
      id: rel.id,
      type: 'relation',
      source: rel.from.collectionId,
      target: rel.to.collectionId,
      sourceHandle: handleId(rowFor(fromNode, rel.from.fieldPath), side.source, 's'),
      targetHandle: handleId(rel.kind === 'reference' ? idRow(toNode) : HEADER, side.target, 't'),
      selected: rel.id === selectedRelationshipId,
      data: {
        kind: rel.kind,
        relationship: rel,
        label: rel.name?.trim() || undefined,
        sourceEnd: rel.kind === 'embed' ? 'diamond' : many ? 'zeroOrMany' : 'zeroOrOne',
        targetEnd: rel.kind === 'embed' ? 'none' : rel.cardinality === 'N:M' ? 'zeroOrMany' : required ? 'one' : 'zeroOrOne',
        highlighted,
        showLabel: showLabels,
      },
    });
  }
  for (const collection of project.collections) {
    if (collection.kind !== 'subcollection' || !collection.parentId) continue;
    const parent = project.collections.find((c) => c.id === collection.parentId);
    const parentNode = byId.get(collection.parentId);
    const node = byId.get(collection.id);
    if (!parent || !parentNode || !node) continue;
    const side = sides(parentNode, node, false);
    edges.push({
      id: `sub:${collection.id}`,
      type: 'relation',
      source: parent.id,
      target: collection.id,
      sourceHandle: handleId(HEADER, side.source, 's'),
      targetHandle: handleId(HEADER, side.target, 't'),
      selectable: false,
      data: { kind: 'subcollection', label: `{${docIdParam(parent)}}`, sourceEnd: 'none', targetEnd: 'none', highlighted: false, showLabel: true },
    });
  }
  return edges;
};
