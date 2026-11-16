import type { QueryBuilderState } from '../../../hooks/data/use-query-builder';
import useQueryFilter from '../../../hooks/data/use-query-filter';
import useT from '../../../hooks/ui/use-t';
import ExpressionInput from '../expression-input/expression-input';
import SegmentedControl from '../segmented-control/segmented-control';

const toCount = (value: string) => Math.max(0, Math.floor(Number(value) || 0));

/** Filter with suggestions, sort, skip and limit. */
const QueryBuilderOptions = ({ builder }: { builder: QueryBuilderState }) => {
  const t = useT();
  const { project, spec, update, filterPaths } = builder;
  const filter = spec.filter ?? '';
  const { suggestions, placeholder, error, invalid } = useQueryFilter(project?.engine, filterPaths, filter);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="query-filter" className="block font-semibold">
          {t('query.filter')}
        </label>
        <ExpressionInput
          id="query-filter"
          value={filter}
          onChange={(value) => update({ filter: value })}
          suggestions={suggestions}
          columns={[]}
          placeholder={placeholder}
          multiline
          invalid={Boolean(error)}
          describedBy={error ? 'query-filter-error' : undefined}
        />
        {error && (
          <span id="query-filter-error" className={`block text-[0.9em] ${invalid ? 'text-danger' : 'text-warning'}`}>
            {error}
          </span>
        )}
      </div>
      <div className="space-y-1.5">
        <label htmlFor="query-sort" className="block font-semibold">
          {t('query.sort')}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <select id="query-sort" className="field min-w-40 flex-1 font-canvas" value={spec.sortPath ?? ''} onChange={(e) => update({ sortPath: e.target.value || undefined })}>
            <option value="">{t('query.noSort')}</option>
            {filterPaths
              .filter((p) => p.field.type !== 'object' && p.field.type !== 'array')
              .map((p) => (
                <option key={p.path} value={p.path}>
                  {p.path}
                </option>
              ))}
          </select>
          {spec.sortPath && (
            <SegmentedControl<'1' | '-1'>
              label={t('query.direction')}
              value={spec.sortOrder === -1 ? '-1' : '1'}
              onChange={(v) => update({ sortOrder: v === '-1' ? -1 : 1 })}
              options={[
                { value: '1', label: t('query.asc') },
                { value: '-1', label: t('query.desc') },
              ]}
            />
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="query-skip" className="block font-semibold">
            {t('query.skip')}
          </label>
          <input id="query-skip" type="number" min={0} className="field" value={spec.skip ?? 0} onChange={(e) => update({ skip: toCount(e.target.value) })} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="query-limit" className="block font-semibold">
            {t('query.limit')}
          </label>
          <input id="query-limit" type="number" min={0} className="field" value={spec.limit} aria-describedby="query-limit-hint" onChange={(e) => update({ limit: toCount(e.target.value) })} />
          <span id="query-limit-hint" className="block text-[0.9em] text-muted">
            {t('query.limitHint')}
          </span>
        </div>
      </div>
    </div>
  );
};

export default QueryBuilderOptions;
