import { useMemo } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { suggestIndexName } from '../../../domain/indexes';
import { allPaths } from '../../../domain/paths';
import { queryPaths } from '../../../domain/query-builder';
import useQueryFilter from '../../../hooks/data/use-query-filter';
import type { Collection, DocIndex, EngineId, IndexOrder } from '../../../domain/types';
import useT from '../../../hooks/ui/use-t';
import { deleteIndex, updateIndex } from '../../../lib/actions';
import Checkbox from '../../ui/checkbox/checkbox';
import ExpressionInput from '../../ui/expression-input/expression-input';
import IconButton from '../../ui/icon-button/icon-button';
import SuggestionInput from '../../ui/suggestion-input/suggestion-input';

type InspectorIndexItemProps = {
  collection: Collection;
  index: DocIndex;
  engine: EngineId;
  position: number;
};

const ORDERS: Record<EngineId, IndexOrder[]> = {
  mongodb: [1, -1, 'text', '2dsphere', 'hashed'],
  firestore: [1, -1],
  couchdb: [1, -1],
};

const InspectorIndexItem = ({ collection, index, engine, position }: InspectorIndexItemProps) => {
  const t = useT();
  const { id } = index;
  const set = (change: (i: DocIndex) => void) => updateIndex(collection.id, id, change, `index:${id}`);
  const paths = allPaths(collection);
  // partialFilterExpression takes the same JSON as a query filter, on paths outside arrays.
  const filterPaths = useMemo(() => queryPaths(collection).filter((p) => !p.inArray), [collection]);
  const partial = useQueryFilter(engine, filterPaths, index.partialFilter ?? '');
  const listId = `paths-${collection.id}`;
  const suggestion = suggestIndexName(index.keys, index.wildcard);

  return (
    <li className="space-y-2.5 rounded-theme border-(length:--bw) border-line p-3">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <label htmlFor={`index-name-${id}`} className="block font-medium">
            {t('inspector.indexName', { n: position })}
          </label>
          <SuggestionInput
            id={`index-name-${id}`}
            className="field field-sm font-canvas"
            value={index.nameIsCustom ? index.name : ''}
            suggestion={suggestion}
            spellCheck={false}
            onChange={(v) =>
              set((i) => {
                i.name = v;
                i.nameIsCustom = v.trim() !== '';
              })
            }
          />
        </div>
        <IconButton tone="danger" label={t('inspector.deleteIndex', { name: index.nameIsCustom ? index.name : suggestion })} onClick={() => deleteIndex(collection.id, id)}>
          <Trash2 size={16} />
        </IconButton>
      </div>
      <datalist id={listId}>
        {paths.map((p) => (
          <option key={p.path} value={p.path} />
        ))}
      </datalist>
      <ul className="space-y-1.5">
        {index.keys.map((key, k) => (
          <li key={k} className="flex flex-wrap items-center gap-1.5">
            <label htmlFor={`index-${id}-key-${k}`} className="sr-only">
              {t('inspector.indexKey', { n: k + 1 })}
            </label>
            <input
              id={`index-${id}-key-${k}`}
              list={listId}
              className="field field-sm min-w-32 flex-1 font-canvas"
              value={key.path}
              spellCheck={false}
              placeholder={paths[1]?.path ?? 'campo'}
              onChange={(e) => set((i) => void (i.keys[k].path = e.target.value))}
            />
            <label htmlFor={`index-${id}-order-${k}`} className="sr-only">
              {t('inspector.indexOrder', { n: k + 1 })}
            </label>
            <select
              id={`index-${id}-order-${k}`}
              className="field field-sm w-auto"
              value={String(key.order)}
              onChange={(e) => set((i) => void (i.keys[k].order = (/^-?1$/.test(e.target.value) ? Number(e.target.value) : e.target.value) as IndexOrder))}
            >
              {ORDERS[engine].map((o) => (
                <option key={String(o)} value={String(o)}>
                  {o === 1 ? t('inspector.asc') : o === -1 ? t('inspector.desc') : o}
                </option>
              ))}
            </select>
            {index.keys.length > 1 && (
              <IconButton size="sm" label={t('inspector.removeKey', { n: k + 1 })} onClick={() => set((i) => void i.keys.splice(k, 1))}>
                <X size={14} />
              </IconButton>
            )}
          </li>
        ))}
      </ul>
      {!index.wildcard && (
        <button type="button" className="inline-flex items-center gap-1 text-accent hover:underline" onClick={() => set((i) => void i.keys.push({ path: '', order: 1 }))}>
          <Plus size={14} aria-hidden />
          {t('inspector.addKey')}
        </button>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <Checkbox label={t('inspector.unique')} checked={Boolean(index.unique)} onChange={(v) => set((i) => (v ? (i.unique = true) : delete i.unique))} />
        {engine === 'mongodb' && <Checkbox label="sparse" checked={Boolean(index.sparse)} onChange={(v) => set((i) => (v ? (i.sparse = true) : delete i.sparse))} />}
        <Checkbox
          label={engine === 'firestore' ? t('inspector.exemption') : t('inspector.wildcard')}
          checked={Boolean(index.wildcard)}
          onChange={(v) => set((i) => (v ? ((i.wildcard = true), (i.keys = i.keys.slice(0, 1))) : delete i.wildcard))}
        />
      </div>
      {engine === 'firestore' && (
        <div className="space-y-1">
          <label htmlFor={`index-scope-${id}`} className="block font-medium">
            {t('inspector.scope')}
          </label>
          <select id={`index-scope-${id}`} className="field field-sm" value={index.scope ?? 'collection'} onChange={(e) => set((i) => void (i.scope = e.target.value as 'collection'))}>
            <option value="collection">{t('inspector.scopeCollection')}</option>
            <option value="collectionGroup">{t('inspector.scopeGroup')}</option>
          </select>
        </div>
      )}
      {engine !== 'firestore' && (
        <div className="space-y-1">
          <label htmlFor={`index-filter-${id}`} className="block font-medium">
            {t('inspector.partialFilter')}
          </label>
          <ExpressionInput
            id={`index-filter-${id}`}
            value={index.partialFilter ?? ''}
            onChange={(v) => set((i) => (v ? (i.partialFilter = v) : delete i.partialFilter))}
            suggestions={partial.suggestions}
            columns={[]}
            placeholder={partial.placeholder}
            invalid={Boolean(partial.error)}
            describedBy={partial.error ? `index-filter-error-${id}` : undefined}
          />
          {partial.error && (
            <span id={`index-filter-error-${id}`} className={`block text-[0.9em] ${partial.invalid ? 'text-danger' : 'text-warning'}`}>
              {partial.error}
            </span>
          )}
        </div>
      )}
      {engine === 'mongodb' && (
        <div className="space-y-1">
          <label htmlFor={`index-collation-${id}`} className="block font-medium">
            {t('inspector.collation')}
          </label>
          <input id={`index-collation-${id}`} list="collation-locales" className="field field-sm font-canvas" value={index.collation ?? ''} placeholder="es" onChange={(e) => set((i) => (e.target.value ? (i.collation = e.target.value) : delete i.collation))} />
          <datalist id="collation-locales">
            {['es', 'en', 'fr', 'pt', 'de', 'simple'].map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </div>
      )}
    </li>
  );
};

export default InspectorIndexItem;
