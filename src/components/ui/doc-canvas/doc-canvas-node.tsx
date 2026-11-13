import type { NodeProps } from '@xyflow/react';
import useT from '../../../hooks/ui/use-t';
import type { CollectionNodeType } from '../../../hooks/canvas/use-doc-graph';

export const NODE_WIDTH = 260;

/** Collection with its top level fields. The full field tree arrives with the diagram phase. */
const DocCanvasNode = ({ data, selected }: NodeProps<CollectionNodeType>) => {
  const t = useT();
  const { name, fields, color } = data.collection;
  const headerStyle = color ? { background: color, color: '#111' } : undefined;

  return (
    <div
      style={{ width: NODE_WIDTH }}
      className={`overflow-hidden rounded-theme border-(length:--bw) bg-node shadow-theme ${selected ? 'border-accent outline-2 outline-accent' : 'border-node-border'}`}
    >
      <div style={headerStyle} className="flex items-center gap-2 bg-node-header px-3 py-2 text-node-header-fg">
        <span className="min-w-0 flex-1 truncate font-semibold" title={name}>
          {name || t('common.unnamed')}
        </span>
      </div>
      <ul className="py-1 text-[12px]">
        {fields.length === 0 && <li className="px-3 py-2 text-muted">{t('canvas.noFields')}</li>}
        {fields.map((field) => (
          <li key={field.id} className="flex items-center gap-2 px-3 py-1">
            <span className={`min-w-0 flex-1 truncate ${field.required ? 'font-semibold' : ''}`}>{field.name}</span>
            <span className="shrink-0 text-muted">{field.type === 'array' ? `${field.items?.type ?? 'any'} []` : field.type}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default DocCanvasNode;
