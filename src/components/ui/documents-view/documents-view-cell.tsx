import { useEffect, useState } from 'react';
import useT from '../../../hooks/ui/use-t';

type DocumentsViewCellProps = {
  id: string;
  label: string;
  value: unknown;
  present: boolean;
  invalid: boolean;
  onChange: (value: unknown, remove?: boolean) => void;
  onOpen: () => void;
};

const summary = (value: unknown, t: ReturnType<typeof useT>) => {
  if (Array.isArray(value)) return t('docs.arrayItems', { count: value.length });
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0].startsWith('$')) return `${keys[0]}: ${String((value as Record<string, unknown>)[keys[0]])}`;
    return t('docs.objectKeys', { count: keys.length });
  }
  return '';
};

/** Text written in a cell: JSON when it parses (numbers, true, null), plain text otherwise; empty removes the key. */
const parseCell = (text: string): { value: unknown; remove: boolean } => {
  if (text === '') return { value: undefined, remove: true };
  try {
    return { value: JSON.parse(text), remove: false };
  } catch {
    return { value: text, remove: false };
  }
};

const DocumentsViewCell = ({ id, label, value, present, invalid, onChange, onOpen }: DocumentsViewCellProps) => {
  const t = useT();
  const nested = value !== null && typeof value === 'object';
  const shown = !present ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);

  if (nested) {
    return (
      <button type="button" onClick={onOpen} className={`w-full truncate rounded-[calc(var(--radius)*0.5)] px-2 py-1 text-left font-canvas text-accent hover:bg-surface-2 ${invalid ? 'ring-1 ring-danger' : ''}`} aria-label={t('docs.openValue', { field: label })}>
        {summary(value, t)}
      </button>
    );
  }
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        className={`field field-sm min-w-24 font-canvas ${invalid ? 'border-danger' : ''}`}
        value={draft}
        placeholder={present ? '' : t('docs.missing')}
        spellCheck={false}
        aria-invalid={invalid || undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft === shown) return;
          const { value: next, remove } = parseCell(draft);
          onChange(next, remove);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </>
  );
};

export default DocumentsViewCell;
