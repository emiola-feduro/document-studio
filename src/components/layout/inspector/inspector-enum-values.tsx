import { X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import useT from '../../../hooks/ui/use-t';

type InspectorEnumValuesProps = {
  id: string;
  values: string[];
  onChange: (values: string[]) => void;
};

/** Allowed values shown as removable chips; several can be pasted at once, separated by commas or lines. */
const InspectorEnumValues = ({ id, values, onChange }: InspectorEnumValuesProps) => {
  const t = useT();
  const [draft, setDraft] = useState('');

  const add = () => {
    const incoming = draft
      .split(/[,\n]/)
      .map((v) => v.trim())
      .filter((v) => v && !values.includes(v));
    if (incoming.length) onChange([...values, ...new Set(incoming)]);
    setDraft('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add();
    } else if (event.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1));
  };

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-medium">
        {t('inspector.enumValues')}
      </label>
      <div className="flex flex-wrap items-center gap-1.5 rounded-[calc(var(--radius)*0.75)] border-(length:--bw) border-line bg-surface p-1.5">
        {values.map((value) => (
          <span key={value} className="inline-flex items-center gap-1 rounded-[calc(var(--radius)*0.5)] bg-accent-soft py-0.5 pr-0.5 pl-2 font-canvas text-[0.92em]">
            {value}
            <button type="button" aria-label={t('inspector.removeValue', { value })} onClick={() => onChange(values.filter((v) => v !== value))} className="rounded p-0.5 text-muted hover:bg-surface hover:text-danger">
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={add}
          placeholder={values.length ? t('inspector.addValue') : t('inspector.enumPlaceholder')}
          className="min-w-24 flex-1 bg-transparent px-1 py-0.5 font-canvas outline-none"
        />
      </div>
    </div>
  );
};

export default InspectorEnumValues;
