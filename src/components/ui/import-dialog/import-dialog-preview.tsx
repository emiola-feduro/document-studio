import type { SchemaImport } from '../../../domain/import';
import { displayType } from '../../../domain/outputs/json-schema';
import { walkFields } from '../../../domain/paths';
import type { EngineId } from '../../../domain/types';
import useT from '../../../hooks/ui/use-t';
import useProjectStore from '../../../stores/use-project-store';

type ImportDialogPreviewProps = {
  result: SchemaImport;
  /** Engine of the new project, when the import does not go to the open one. */
  engine?: EngineId;
};

/** What will be created: collections and fields (with how often they appear for documents), references, and what is left out. */
const ImportDialogPreview = ({ result, engine: forced }: ImportDialogPreviewProps) => {
  const t = useT();
  const current = useProjectStore((s) => s.project?.engine ?? 'mongodb');
  const engine = forced ?? current;
  const { collections, relationships, documents, stats, warnings, skipped } = result;
  const nameOf = (id: string) => collections.find((c) => c.id === id)?.name ?? '?';
  const indexes = collections.reduce((n, c) => n + c.indexes.length, 0);

  return (
    <div className="space-y-3" aria-live="polite">
      <p className="font-medium">{t('import.summary', { collections: collections.length, relationships: relationships.length, indexes })}</p>
      {collections.map((collection) => {
        const docs = documents[collection.id] ?? [];
        const own = stats[collection.id];
        return (
          <section key={collection.id} className="rounded-theme border-(length:--bw) border-line">
            <h3 className="border-b border-line px-3 py-2 font-semibold">
              {collection.name} {docs.length > 0 && <span className="font-normal text-muted">{t('infer.docCount', { count: docs.length })}</span>}
            </h3>
            <div className="relative max-h-56 overflow-auto">
              <table className="min-w-full text-[0.93em]">
                <thead className="sticky top-0 bg-surface text-left text-muted">
                  <tr>
                    <th scope="col" className="px-3 py-1 font-medium">{t('infer.path')}</th>
                    <th scope="col" className="px-3 py-1 font-medium">{t('infer.type')}</th>
                    {own && <th scope="col" className="px-3 py-1 text-right font-medium">{t('infer.presence')}</th>}
                    {own && <th scope="col" className="px-3 py-1 text-right font-medium">{t('infer.length')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {walkFields(collection.fields).map(({ path, field }) => {
                    const s = own?.find((x) => x.path === path);
                    const presence = s && docs.length ? Math.round((s.present / docs.length) * 100) : 100;
                    const target = (field.reference ?? field.items?.reference)?.collectionId;
                    return (
                      <tr key={field.id} className="border-t border-line">
                        <td className="px-3 py-1 font-canvas">
                          {path}
                          {field.required && <span className="sr-only"> ({t('inspector.required')})</span>}
                        </td>
                        <td className="px-3 py-1 font-canvas text-muted">
                          {displayType(engine, field)}
                          {field.enumValues?.length ? ` (${field.enumValues.join(', ')})` : ''}
                          {target ? ` → ${nameOf(target)}` : ''}
                        </td>
                        {own && <td className="px-3 py-1 text-right tabular-nums">{path.includes('.') ? '' : `${presence} %`}</td>}
                        {own && <td className="px-3 py-1 text-right tabular-nums text-muted">{s?.maxLength !== undefined ? `${s.minLength}..${s.maxLength}` : ''}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      {relationships.length > 0 && (
        <div>
          <h3 className="font-semibold">{t('infer.references')}</h3>
          <ul className="list-inside list-disc">
            {relationships.map((r) => (
              <li key={r.id} className="font-canvas">{`${nameOf(r.from.collectionId)}.${r.from.fieldPath} → ${nameOf(r.to.collectionId)}`}</li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-theme bg-warning-soft p-3 text-warning">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {skipped.length > 0 && (
        <div className="space-y-1">
          <h3 className="font-semibold">{t('import.skipped')}</h3>
          <ul className="list-inside list-disc text-muted">
            {skipped.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default ImportDialogPreview;
