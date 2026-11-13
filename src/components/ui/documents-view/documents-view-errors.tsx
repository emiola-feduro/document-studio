import type { DocResult } from '../../../domain/documents';
import useT from '../../../hooks/ui/use-t';

/** Problems found in the documents, by document number and path. */
const DocumentsViewErrors = ({ results }: { results: DocResult[] }) => {
  const t = useT();
  const rows = results.flatMap((r) => r.errors.map((e) => ({ n: r.index + 1, ...e })));
  if (rows.length === 0) return null;

  return (
    <section aria-label={t('docs.errorsTitle')} className="max-h-48 overflow-y-auto border-t border-line bg-danger-soft px-4 py-2 text-danger">
      <h3 className="mb-1 font-semibold">{t('docs.errorsTitleCount', { count: rows.length })}</h3>
      <ul className="space-y-0.5">
        {rows.slice(0, 200).map((row, i) => (
          <li key={i}>
            <span className="font-semibold">{t('docs.documentN', { n: row.n })}</span>
            {row.path && <span className="font-canvas">{` ${row.path}`}</span>}: {row.message}
          </li>
        ))}
      </ul>
    </section>
  );
};

export default DocumentsViewErrors;
