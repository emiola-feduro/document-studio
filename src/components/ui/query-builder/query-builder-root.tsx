import type { QueryBuilderState } from '../../../hooks/data/use-query-builder';
import { collectionPath } from '../../../domain/model';
import useT from '../../../hooks/ui/use-t';

/** The collection the query starts from. */
const QueryBuilderRoot = ({ builder }: { builder: QueryBuilderState }) => {
  const t = useT();
  const { project, collections, spec, setRoot } = builder;

  return (
    <div className="space-y-1.5">
      <label htmlFor="query-root" className="block font-semibold">
        {t('query.root')}
      </label>
      <select id="query-root" className="field" value={spec.rootId ?? ''} onChange={(e) => setRoot(e.target.value)} disabled={!collections.length}>
        <option value="">{t('query.chooseRoot')}</option>
        {collections.map((c) => (
          <option key={c.id} value={c.id}>
            {project ? collectionPath(project, c) : c.name}
          </option>
        ))}
      </select>
    </div>
  );
};

export default QueryBuilderRoot;
