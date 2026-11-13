import { Handle, Position } from '@xyflow/react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { MouseEvent } from 'react';
import { displayType } from '../../../domain/outputs/json-schema';
import type { EngineId } from '../../../domain/types';
import useT from '../../../hooks/ui/use-t';
import { FIELD_HANDLE_PREFIX, handleId, type FieldRow } from '../../../lib/graph';
import useUiStore from '../../../stores/use-ui-store';

type DocCanvasRowProps = {
  collectionId: string;
  row: FieldRow;
  engine: EngineId;
  highlighted: boolean;
};

const DocCanvasRow = ({ collectionId, row, engine, highlighted }: DocCanvasRowProps) => {
  const t = useT();
  const { field, depth, hasChildren, collapsed, indexed, unique, embedded, referenceTarget } = row;
  const toggle = useUiStore((s) => s.toggleCollapsed);
  const isArrayItem = field.name === '' ;
  const flags = [unique ? 'UQ' : indexed ? 'IX' : ''].filter(Boolean);

  const onToggle = (event: MouseEvent) => {
    event.stopPropagation();
    toggle(field.id);
  };

  return (
    <div
      className={`field-row relative flex items-center gap-1.5 py-[4px] pr-3 text-[12px] leading-tight ${highlighted ? 'bg-accent-soft' : ''}`}
      style={{ paddingLeft: 10 + depth * 14 }}
      onClick={() => useUiStore.getState().setFieldFocus({ collectionId, fieldId: field.id })}
    >
      {embedded && <span aria-hidden className="absolute top-0 bottom-0 w-0.5 bg-accent" style={{ left: 4 + depth * 14 }} />}
      <Handle id={handleId(field.id, 'L', 's')} type="source" position={Position.Left} className="row-handle" isConnectable={false} />
      <Handle id={handleId(field.id, 'L', 't')} type="target" position={Position.Left} className="row-handle" isConnectable={false} />
      {hasChildren ? (
        <button
          type="button"
          className="nodrag -ml-1 flex size-4 shrink-0 items-center justify-center rounded text-muted hover:text-fg"
          aria-label={collapsed ? t('canvas.expand', { name: field.name }) : t('canvas.collapse', { name: field.name })}
          aria-expanded={!collapsed}
          onClick={onToggle}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </button>
      ) : (
        <span className="w-3 shrink-0" aria-hidden />
      )}
      <span
        className={`min-w-0 flex-1 truncate ${field.required ? 'font-semibold' : ''} ${referenceTarget ? 'text-fk' : ''} ${isArrayItem ? 'text-muted' : ''}`}
        title={referenceTarget ? t('canvas.referencesTo', { name: field.name, target: referenceTarget }) : field.name}
      >
        {field.name}
        {field.nullable && <span className="font-normal text-muted">?</span>}
      </span>
      <span className="max-w-[45%] shrink-0 truncate text-muted" title={displayType(engine, field)}>
        {referenceTarget ? `${referenceTarget}${field.type === 'array' ? '[]' : ''}` : displayType(engine, field)}
      </span>
      {flags.length > 0 && <span className="shrink-0 text-[10px] font-semibold text-muted">{flags.join(' ')}</span>}
      <Handle id={handleId(field.id, 'R', 's')} type="source" position={Position.Right} className="row-handle" isConnectable={false} />
      <Handle id={handleId(field.id, 'R', 't')} type="target" position={Position.Right} className="row-handle" isConnectable={false} />
      {field.name !== '_id' && field.name !== '_rev' && (
        <Handle id={`${FIELD_HANDLE_PREFIX}${field.id}`} type="source" position={Position.Right} className="field-handle" title={t('canvas.fieldHandleHint', { name: field.name })} />
      )}
    </div>
  );
};

export default DocCanvasRow;
