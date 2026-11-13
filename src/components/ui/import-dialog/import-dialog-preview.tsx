import type { ImportPlan } from '../../../domain/infer';
import { displayType } from '../../../domain/outputs/json-schema';
import { walkFields } from '../../../domain/paths';
import useT from '../../../hooks/ui/use-t';
import useProjectStore from '../../../stores/use-project-store';

/** What will be created: each collection's inferred fields with how often they appear, and detected references. */
const ImportDialogPreview = ({ plan }: { plan: ImportPlan }) => {
  const t = useT();
  const engine = useProjectStore((s) => s.project?.engine ?? 'mongodb');
  const nameOf = (id: string) => plan.collections.find((c) => c.collection.id === id)?.collection.name ?? '?';

  return (
    <div className="space-y-3">
      {plan.collections.map(({ collection, documents, stats }) => (
        <section key={collection.id} className="rounded-theme border-(length:--bw) border-line">
          <h3 className="border-b border-line px-3 py-2 font-semibold">
            {collection.name} <span className="font-normal text-muted">{t('infer.docCount', { count: documents.length })}</span>
          </h3>
          <div className="relative max-h-56 overflow-auto">
            <table className="min-w-full text-[0.93em]">
              <thead className="sticky top-0 bg-surface text-left text-muted">
                <tr>
                  <th scope="col" className="px-3 py-1 font-medium">{t('infer.path')}</th>
                  <th scope="col" className="px-3 py-1 font-medium">{t('infer.type')}</th>
                  <th scope="col" className="px-3 py-1 text-right font-medium">{t('infer.presence')}</th>
                  <th scope="col" className="px-3 py-1 text-right font-medium">{t('infer.length')}</th>
                </tr>
              </thead>
              <tbody>
                {walkFields(collection.fields).map(({ path, field }) => {
                  const s = stats.find((x) => x.path === path);
                  const presence = s && documents.length ? Math.round((s.present / documents.length) * 100) : 100;
                  return (
                    <tr key={field.id} className="border-t border-line">
                      <td className="px-3 py-1 font-canvas">{path}</td>
                      <td className="px-3 py-1 font-canvas text-muted">
                        {displayType(engine, field)}
                        {field.enumValues?.length ? ` (${field.enumValues.join(', ')})` : ''}
                      </td>
                      <td className="px-3 py-1 text-right tabular-nums">{path.includes('.') ? '' : `${presence} %`}</td>
                      <td className="px-3 py-1 text-right tabular-nums text-muted">{s?.maxLength !== undefined ? `${s.minLength}..${s.maxLength}` : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {plan.relationships.length > 0 && (
        <div>
          <h3 className="font-semibold">{t('infer.references')}</h3>
          <ul className="list-inside list-disc">
            {plan.relationships.map((r) => (
              <li key={r.id} className="font-canvas">{`${nameOf(r.from.collectionId)}.${r.from.fieldPath} → ${nameOf(r.to.collectionId)}`}</li>
            ))}
          </ul>
        </div>
      )}
      {plan.warnings.length > 0 && (
        <ul className="space-y-1 rounded-theme bg-warning-soft p-3 text-warning">
          {plan.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ImportDialogPreview;
