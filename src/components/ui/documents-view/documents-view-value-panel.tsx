import { X } from 'lucide-react';
import { useState } from 'react';
import useT from '../../../hooks/ui/use-t';
import Button from '../button/button';
import IconButton from '../icon-button/icon-button';

type DocumentsViewValuePanelProps = {
  title: string;
  value: unknown;
  /** Without it the value is only shown, as in query results. */
  onSave?: (value: unknown) => void;
  onClose: () => void;
};

/** Side panel to edit an object or array value of one document as JSON. */
const DocumentsViewValuePanel = ({ title, value, onSave, onClose }: DocumentsViewValuePanelProps) => {
  const t = useT();
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    try {
      onSave?.(JSON.parse(text));
      onClose();
    } catch (e) {
      setError(t('docs.err.json', { detail: e instanceof Error ? e.message : String(e) }));
    }
  };

  return (
    <aside aria-label={title} className="flex w-full max-w-md min-w-0 flex-col border-l border-line bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
        <h3 className="min-w-0 truncate font-semibold font-canvas">{title}</h3>
        <IconButton size="sm" label={t('common.close')} onClick={onClose}>
          <X size={15} />
        </IconButton>
      </div>
      <label htmlFor="docs-value-editor" className="sr-only">
        {title}
      </label>
      <textarea
        id="docs-value-editor"
        className="min-h-0 flex-1 resize-none bg-surface p-3 font-code text-[13px] outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        value={text}
        readOnly={!onSave}
        spellCheck={false}
        aria-invalid={Boolean(error)}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
      />
      {error && (
        <p role="alert" className="bg-danger-soft px-4 py-2 text-danger">
          {error}
        </p>
      )}
      {onSave && (
        <div className="flex justify-end gap-2 border-t border-line px-4 py-2">
          <Button size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" variant="primary" onClick={save}>
            {t('common.save')}
          </Button>
        </div>
      )}
    </aside>
  );
};

export default DocumentsViewValuePanel;
