import { useMemo } from 'react';
import { ENGINES } from '../../../domain/engines';
import { descendantsOf } from '../../../domain/model';
import { estimateSize, formatBytes } from '../../../domain/advisor';
import type { Collection } from '../../../domain/types';
import useAdvisor from '../../../hooks/data/use-advisor';
import useT from '../../../hooks/ui/use-t';
import { renameCollection, updateCollection } from '../../../lib/actions';
import useProjectStore from '../../../stores/use-project-store';
import useUiStore from '../../../stores/use-ui-store';
import Button from '../../ui/button/button';
import PanelHideButton from '../../ui/panel-hide-button/panel-hide-button';
import InspectorCollectionOptions from './inspector-collection-options';
import InspectorFieldDetails from './inspector-field-details';
import InspectorFieldTree from './inspector-field-tree';
import InspectorIndexList from './inspector-index-list';
import InspectorIssueList from './inspector-issue-list';
import InspectorSection from './inspector-section';

const COLORS = ['', '#cfe0ff', '#d6f5e3', '#ffe8c7', '#f9d6e0', '#e6dcff', '#d9f2f7', '#f0f0c8'];

const InspectorCollection = ({ collection }: { collection: Collection }) => {
  const t = useT();
  const project = useProjectStore((s) => s.project)!;
  const issues = useAdvisor();
  const own = issues.filter((i) => i.collectionId === collection.id);
  const engine = ENGINES[project.engine];
  const { id, name, color, notes } = collection;
  const size = useMemo(() => estimateSize(collection.fields), [collection.fields]);
  const parents = project.collections.filter((c) => c.id !== id && !descendantsOf(project, id).some((d) => d.id === c.id));
  const docs = project.documents?.[id]?.length ?? 0;

  return (
    <>
      <div className="space-y-3 border-b border-line px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[1.15em] font-semibold">{collection.kind === 'subcollection' ? t('inspector.subcollection') : t('inspector.collection')}</h2>
          <PanelHideButton panel="inspector" />
        </div>
        <div className="space-y-1">
          <label htmlFor={`collection-name-${id}`} className="block font-medium">
            {t('common.name')}
          </label>
          <input id={`collection-name-${id}`} className="field font-canvas" value={name} spellCheck={false} onChange={(e) => renameCollection(id, e.target.value)} />
        </div>
        {engine.subcollections && (
          <div className="space-y-1">
            <label htmlFor={`collection-parent-${id}`} className="block font-medium">
              {t('inspector.parent')}
            </label>
            <select
              id={`collection-parent-${id}`}
              className="field field-sm"
              value={collection.parentId ?? ''}
              onChange={(e) =>
                updateCollection(id, (c) => {
                  if (e.target.value) {
                    c.kind = 'subcollection';
                    c.parentId = e.target.value;
                  } else {
                    c.kind = 'collection';
                    delete c.parentId;
                  }
                })
              }
            >
              <option value="">{t('inspector.rootCollection')}</option>
              {parents.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <fieldset>
          <legend className="mb-1 font-medium">{t('inspector.color')}</legend>
          <div className="flex flex-wrap gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c || 'none'}
                type="button"
                aria-label={c ? t('inspector.colorValue', { color: c }) : t('inspector.noColor')}
                aria-pressed={(color ?? '') === c}
                onClick={() => updateCollection(id, (x) => (c ? (x.color = c) : delete x.color))}
                className={`size-7 rounded-full border-(length:--bw) ${(color ?? '') === c ? 'outline-2 outline-offset-2 outline-accent' : 'border-line'}`}
                style={{ background: c || 'var(--c-node-header)' }}
              />
            ))}
          </div>
        </fieldset>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
          <dt className="text-muted">{t('inspector.estimatedSize')}</dt>
          <dd className="text-right font-semibold tabular-nums">
            {formatBytes(size.bytes)}
            {size.unbounded ? '+' : ''}
          </dd>
          <dt className="text-muted">{t('inspector.sampleDocuments')}</dt>
          <dd className="text-right">
            <Button size="sm" variant="ghost" aria-label={t('inspector.viewDocuments', { count: docs })} onClick={() => useUiStore.getState().showDocuments(id)}>
              {docs}
            </Button>
          </dd>
        </dl>
      </div>
      <InspectorFieldTree collection={collection} engine={project.engine} />
      <InspectorFieldDetails collection={collection} engine={project.engine} />
      <InspectorIndexList collection={collection} engine={project.engine} />
      <InspectorCollectionOptions collection={collection} engine={project.engine} />
      <InspectorSection title={t('inspector.notes')}>
        <label htmlFor={`notes-${id}`} className="sr-only">
          {t('inspector.notes')}
        </label>
        <textarea id={`notes-${id}`} className="field min-h-16 resize-y" value={notes ?? ''} onChange={(e) => updateCollection(id, (c) => (e.target.value ? (c.notes = e.target.value) : delete c.notes), `notes:${id}`)} />
      </InspectorSection>
      <InspectorSection title={own.length ? t('common.warningsTitle', { count: own.length }) : t('common.warnings')}>
        <InspectorIssueList issues={own} />
      </InspectorSection>
    </>
  );
};

export default InspectorCollection;
