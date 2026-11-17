import type { QueryBuilderState } from '../../../hooks/data/use-query-builder';
import type { JoinMode } from '../../../domain/query-builder';
import useT from '../../../hooks/ui/use-t';
import Checkbox from '../checkbox/checkbox';

/** References to resolve, from the base collection and from the documents already joined. */
const QueryBuilderJoins = ({ builder }: { builder: QueryBuilderState }) => {
  const t = useT();
  const { project, root, options, spec, toggleJoin, setMode, setAlias } = builder;
  if (!root || !project) return null;

  return (
    <fieldset className="space-y-2">
      <legend className="mb-1.5 font-semibold">{t('query.joins')}</legend>
      {options.length === 0 && <p className="text-muted">{t('query.noJoins', { collection: root.name })}</p>}
      <ul className="space-y-2">
        {options.map((o) => {
          const on = spec.joins.includes(o.id);
          const depth = o.id.split('/').length - 1;
          return (
            <li key={o.id} className="space-y-1.5" style={{ paddingLeft: `${depth * 1.25}rem` }}>
              <Checkbox label={t('query.joinLabel', { path: o.parentId ? `${o.as.split('.').slice(0, -1).join('.')}.${o.path}` : o.path, collection: o.target.name })} checked={on} onChange={(v) => toggleJoin(o.id, v)} />
              {on && project.engine === 'mongodb' && (
                <div className="space-y-1 pl-6">
                  <label htmlFor={`query-alias-${o.id}`} className="block text-muted">
                    {t('query.alias')}
                  </label>
                  <input
                    id={`query-alias-${o.id}`}
                    className="field field-sm font-canvas"
                    value={spec.aliases?.[o.id] ?? o.as.split('.').pop()}
                    placeholder={o.defaultAs}
                    spellCheck={false}
                    aria-invalid={o.aliasProblem ? true : undefined}
                    aria-describedby={o.aliasProblem ? `query-alias-error-${o.id}` : undefined}
                    onChange={(e) => setAlias(o.id, e.target.value)}
                  />
                  {o.aliasProblem && (
                    <span id={`query-alias-error-${o.id}`} className="block text-[0.9em] text-warning">
                      {t(`query.aliasProblem.${o.aliasProblem}` as 'query.aliasProblem.dot', { name: o.defaultAs })}
                    </span>
                  )}
                </div>
              )}
              {on && !o.many && project.engine !== 'couchdb' && (
                <div className="pl-6">
                  <label htmlFor={`query-mode-${o.id}`} className="sr-only">
                    {t('query.modeLabel', { name: o.as })}
                  </label>
                  <select id={`query-mode-${o.id}`} className="field field-sm" value={spec.modes?.[o.id] ?? 'left'} onChange={(e) => setMode(o.id, e.target.value as JoinMode)}>
                    <option value="left">{t('query.modeLeft')}</option>
                    <option value="inner">{t('query.modeInner')}</option>
                  </select>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
};

export default QueryBuilderJoins;
