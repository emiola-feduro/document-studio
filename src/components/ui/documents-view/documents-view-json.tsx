import type { DocResult } from '../../../domain/documents';
import type { SampleDocument } from '../../../domain/types';
import useJsonDraft from '../../../hooks/data/use-json-draft';
import useT from '../../../hooks/ui/use-t';

type DocumentsViewJsonProps = {
  collectionId: string;
  docs: SampleDocument[];
  results: DocResult[];
};

/** Every document of the collection as one JSON array, validated as it is typed. */
const DocumentsViewJson = ({ collectionId, docs }: DocumentsViewJsonProps) => {
  const t = useT();
  const { text, error, onChange } = useJsonDraft(collectionId, docs);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <label htmlFor={`docs-json-${collectionId}`} className="sr-only">
        {t('docs.jsonLabel')}
      </label>
      <textarea
        id={`docs-json-${collectionId}`}
        className="min-h-0 flex-1 resize-none bg-surface p-4 font-code text-[13px] leading-relaxed outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        value={text}
        spellCheck={false}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `docs-json-error-${collectionId}` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && (
        <p id={`docs-json-error-${collectionId}`} role="alert" className="border-t border-line bg-danger-soft px-4 py-2 text-danger">
          {error}
        </p>
      )}
    </div>
  );
};

export default DocumentsViewJson;
