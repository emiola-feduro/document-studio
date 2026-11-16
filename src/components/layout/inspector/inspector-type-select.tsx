import type { MessageKey } from '../../../i18n';
import { ENGINES, type TypeGroup } from '../../../domain/engines';
import type { EngineId, FieldType } from '../../../domain/types';
import useT from '../../../hooks/ui/use-t';

const GROUPS: TypeGroup[] = ['text', 'number', 'date', 'identity', 'structure', 'other'];

type InspectorTypeSelectProps = {
  id: string;
  label: string;
  engine: EngineId;
  value: FieldType;
  onChange: (type: FieldType) => void;
  /** Hide the label visually, for compact rows. */
  hiddenLabel?: boolean;
  exclude?: FieldType[];
  className?: string;
};

/** Field types of the engine, grouped, with the engine's own name next to each. */
const InspectorTypeSelect = ({ id, label, engine, value, onChange, hiddenLabel, exclude = [], className = '' }: InspectorTypeSelectProps) => {
  const t = useT();
  const types = ENGINES[engine].types.filter((i) => !exclude.includes(i.type));
  const known = types.some((i) => i.type === value);

  return (
    <div className={`${hiddenLabel ? 'min-w-0' : 'space-y-1'} ${className}`}>
      <label htmlFor={id} className={hiddenLabel ? 'sr-only' : 'block font-medium'}>
        {label}
      </label>
      <select id={id} className="field field-sm w-full font-canvas" value={value} onChange={(e) => onChange(e.target.value as FieldType)}>
        {!known && <option value={value}>{value}</option>}
        {GROUPS.map((group) => {
          const options = types.filter((i) => i.group === group);
          if (options.length === 0) return null;
          return (
            <optgroup key={group} label={t(`typeGroup.${group}` as MessageKey)}>
              {options.map((i) => (
                <option key={i.type} value={i.type}>
                  {i.native.includes(i.type) ? i.native : `${i.type} (${i.native})`}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
    </div>
  );
};

export default InspectorTypeSelect;
