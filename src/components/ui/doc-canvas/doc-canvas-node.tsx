import { Handle, Position, type NodeProps } from '@xyflow/react';
import useT from '../../../hooks/ui/use-t';
import { HEADER, handleId, NODE_WIDTH, type CollectionNodeType } from '../../../lib/graph';
import DocCanvasRow from './doc-canvas-row';

/** Collection with its field tree: nesting by indentation, folding for objects and arrays. */
const DocCanvasNode = ({ data, selected }: NodeProps<CollectionNodeType>) => {
  const t = useT();
  const { collection, engine, rows, issueCount, parentName, highlightedPaths } = data;
  const { id, name, color } = collection;
  const headerStyle = color ? { background: color, color: '#111' } : undefined;

  return (
    <div
      style={{ width: NODE_WIDTH }}
      className={`overflow-hidden rounded-theme border-(length:--bw) bg-node shadow-theme ${selected ? 'border-accent outline-2 outline-accent' : 'border-node-border'}`}
    >
      <div style={headerStyle} className="relative flex items-center gap-2 bg-node-header px-3 py-2 text-node-header-fg">
        <Handle id={handleId(HEADER, 'L', 's')} type="source" position={Position.Left} className="row-handle" isConnectable={false} />
        <Handle id={handleId(HEADER, 'L', 't')} type="target" position={Position.Left} className="row-handle" isConnectable={false} />
        <span className="min-w-0 flex-1">
          {parentName && <span className="block truncate text-[11px] opacity-75">{`${parentName}/{id}/`}</span>}
          <span className="block truncate font-semibold" title={name}>
            {name || t('common.unnamed')}
          </span>
        </span>
        {issueCount > 0 && (
          <span className="shrink-0 rounded-full bg-danger-soft px-1.5 text-[11px] font-semibold text-danger" title={t('common.warningsCount', { count: issueCount })}>
            {issueCount}
          </span>
        )}
        <Handle id={handleId(HEADER, 'R', 's')} type="source" position={Position.Right} className="row-handle" isConnectable={false} />
        <Handle id={handleId(HEADER, 'R', 't')} type="target" position={Position.Right} className="row-handle" isConnectable={false} />
      </div>
      <div className="py-1">
        {rows.length === 0 && <p className="px-3 py-2 text-[12px] text-muted">{t('canvas.noFields')}</p>}
        {rows.map((row) => (
          <DocCanvasRow
            key={row.field.id}
            collectionId={id}
            row={row}
            engine={engine}
            highlighted={highlightedPaths.includes(row.path)}
          />
        ))}
      </div>
      <Handle id="connect" type="source" position={Position.Right} className="connect-handle" style={{ top: 18 }} title={t('canvas.connectHint')} />
    </div>
  );
};

export default DocCanvasNode;
