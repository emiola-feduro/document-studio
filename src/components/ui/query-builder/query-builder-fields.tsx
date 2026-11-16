import type { QueryBuilderState } from '../../../hooks/data/use-query-builder';
import useT from '../../../hooks/ui/use-t';
import Checkbox from '../checkbox/checkbox';

/** First level fields to return, for the base collection and each joined collection. */
const QueryBuilderFields = ({ builder }: { builder: QueryBuilderState }) => {
  const t = useT();
  const { root, joins, spec, toggleField, setAllFields } = builder;
  if (!root) return null;
  const groups = [{ key: '', title: root.name, collection: root }, ...joins.map((j) => ({ key: j.id, title: `${j.as} (${j.target.name})`, collection: j.target }))];

  return (
    <div className="space-y-3">
      <h3 className="font-semibold">{t('query.fields')}</h3>
      {groups.map(({ key, title, collection }) => {
        const all = collection.fields.map((f) => f.name).filter(Boolean);
        const chosen = spec.fields?.[key];
        return (
          <fieldset key={key || 'root'} className="space-y-1.5">
            <legend className="mb-1 font-medium">{title}</legend>
            <Checkbox label={t('query.allFields')} checked={!chosen} onChange={(on) => setAllFields(key, on)} />
            <div className="grid grid-cols-1 gap-x-3 gap-y-1 pl-6 sm:grid-cols-2">
              {all.map((name) => (
                <Checkbox key={name} label={name} checked={!chosen || chosen.includes(name)} onChange={(on) => toggleField(key, all, name, on)} />
              ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
};

export default QueryBuilderFields;
