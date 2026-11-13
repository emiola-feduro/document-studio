import { ChevronDown, ChevronRight, MoreHorizontal, Plus } from 'lucide-react';
import { childList, type PathEntry } from '../../../domain/paths';
import type { EngineId } from '../../../domain/types';
import useT from '../../../hooks/ui/use-t';
import { addField, changeFieldType, changeItemsType, deleteField, moveField, nestField, renameField } from '../../../lib/actions';
import useUiStore from '../../../stores/use-ui-store';
import IconButton from '../../ui/icon-button/icon-button';
import Menu from '../../ui/menu/menu';
import InspectorTypeSelect from './inspector-type-select';

type InspectorFieldRowProps = {
  collectionId: string;
  engine: EngineId;
  entry: PathEntry;
  system: boolean;
  focused: boolean;
  collapsed: boolean;
  first: boolean;
  last: boolean;
};

/** One field of the tree: name, type, element type for arrays, and the actions to reshape the tree. */
const InspectorFieldRow = ({ collectionId, engine, entry, system, focused, collapsed, first, last }: InspectorFieldRowProps) => {
  const t = useT();
  const { field, depth } = entry;
  const setFieldFocus = useUiStore((s) => s.setFieldFocus);
  const toggle = useUiStore((s) => s.toggleCollapsed);
  const canHoldChildren = field.type === 'object' || (field.type === 'array' && field.items?.type === 'object');
  const hasChildren = Boolean(childList(field)?.length);
  const focus = () => setFieldFocus({ collectionId, fieldId: field.id });

  return (
    <li
      className={`rounded-[calc(var(--radius)*0.75)] border-(length:--bw) py-1 pr-1 ${focused ? 'border-accent bg-accent-soft' : 'border-transparent hover:bg-surface-2'}`}
      style={{ paddingLeft: `${0.25 + depth * 1}rem` }}
      onFocusCapture={focus}
    >
      <div className="flex flex-wrap items-center gap-1">
        {hasChildren ? (
          <IconButton size="sm" label={collapsed ? t('canvas.expand', { name: field.name }) : t('canvas.collapse', { name: field.name })} aria-expanded={!collapsed} onClick={() => toggle(field.id)} className="size-6">
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </IconButton>
        ) : (
          <span className="w-6 shrink-0" aria-hidden />
        )}
        <label htmlFor={`field-name-${field.id}`} className="sr-only">
          {t('inspector.fieldName')}
        </label>
        <input
          id={`field-name-${field.id}`}
          className={`field field-sm min-w-28 flex-1 font-canvas ${field.required ? 'font-semibold' : ''}`}
          value={field.name}
          readOnly={system}
          spellCheck={false}
          onChange={(e) => renameField(collectionId, field.id, e.target.value)}
        />
        <InspectorTypeSelect
          id={`field-type-${field.id}`}
          label={t('inspector.fieldType', { name: field.name })}
          hiddenLabel
          engine={engine}
          value={field.type}
          onChange={(type) => changeFieldType(collectionId, field.id, type)}
        />
        {field.type === 'array' && (
          <InspectorTypeSelect
            id={`field-items-${field.id}`}
            label={t('inspector.itemsType', { name: field.name })}
            hiddenLabel
            engine={engine}
            value={field.items?.type ?? 'any'}
            exclude={engine === 'firestore' ? ['array'] : []}
            onChange={(type) => changeItemsType(collectionId, field.id, type)}
          />
        )}
        {canHoldChildren && (
          <IconButton size="sm" label={t('inspector.addChild', { name: field.name })} onClick={() => addField(collectionId, field.id)}>
            <Plus size={15} />
          </IconButton>
        )}
        <Menu
          trigger={({ open, toggle: toggleMenu }) => (
            <IconButton size="sm" label={t('inspector.fieldActions', { name: field.name })} aria-haspopup="menu" aria-expanded={open} onClick={toggleMenu}>
              <MoreHorizontal size={15} />
            </IconButton>
          )}
          items={[
            { label: t('inspector.details'), onSelect: focus },
            { label: t('common.moveUp'), disabled: first, onSelect: () => moveField(collectionId, field.id, -1), separatorBefore: true },
            { label: t('common.moveDown'), disabled: last, onSelect: () => moveField(collectionId, field.id, 1) },
            { label: t('inspector.indent'), disabled: first || system, onSelect: () => nestField(collectionId, field.id, 'in') },
            { label: t('inspector.outdent'), disabled: depth === 0, onSelect: () => nestField(collectionId, field.id, 'out') },
            { label: t('common.delete'), danger: true, disabled: system, onSelect: () => deleteField(collectionId, field.id), separatorBefore: true },
          ]}
        />
      </div>
    </li>
  );
};

export default InspectorFieldRow;
