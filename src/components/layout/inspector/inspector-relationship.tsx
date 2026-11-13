import { useState } from 'react';
import { PATTERNS, recommendRelationship } from '../../../domain/advisor';
import { defaultStorage } from '../../../domain/relationships';
import type { Cardinality, Relationship } from '../../../domain/types';
import useAdvisor from '../../../hooks/data/use-advisor';
import useT from '../../../hooks/ui/use-t';
import { deleteRelationship, updateRelationship } from '../../../lib/actions';
import useProjectStore from '../../../stores/use-project-store';
import useUiStore from '../../../stores/use-ui-store';
import Button from '../../ui/button/button';
import Checkbox from '../../ui/checkbox/checkbox';
import ConfirmDialog from '../../ui/confirm-dialog/confirm-dialog';
import PanelHideButton from '../../ui/panel-hide-button/panel-hide-button';
import SegmentedControl from '../../ui/segmented-control/segmented-control';
import InspectorIssueList from './inspector-issue-list';
import InspectorSection from './inspector-section';

const InspectorRelationship = ({ relationship }: { relationship: Relationship }) => {
  const t = useT();
  const project = useProjectStore((s) => s.project)!;
  const issues = useAdvisor().filter((i) => i.relationshipId === relationship.id);
  const [confirming, setConfirming] = useState(false);
  const [removeField, setRemoveField] = useState(true);
  const { id, kind, cardinality, storage, from, to } = relationship;
  const nameOf = (cid: string) => project.collections.find((c) => c.id === cid)?.name ?? '?';
  const rec = recommendRelationship(project, relationship);
  const pattern = rec.pattern ? PATTERNS.find((p) => p.text === rec.pattern) : undefined;
  const select = useUiStore((s) => s.select);

  return (
    <>
      <div className="space-y-3 border-b border-line px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[1.15em] font-semibold">{t('inspector.relationship')}</h2>
          <PanelHideButton panel="inspector" />
        </div>
        <p>
          <button type="button" className="font-semibold text-accent hover:underline" onClick={() => select({ kind: 'collection', id: from.collectionId })}>
            {nameOf(from.collectionId)}
          </button>
          <span className="font-canvas">.{from.fieldPath}</span>
          <span className="text-muted"> {kind === 'embed' ? t('inspector.embeds') : t('inspector.references')} </span>
          <button type="button" className="font-semibold text-accent hover:underline" onClick={() => select({ kind: 'collection', id: to.collectionId })}>
            {nameOf(to.collectionId)}
          </button>
        </p>
        <div className="space-y-1">
          <label htmlFor={`rel-name-${id}`} className="block font-medium">
            {t('inspector.relationshipName')}
          </label>
          <input id={`rel-name-${id}`} className="field field-sm" value={relationship.name ?? ''} onChange={(e) => updateRelationship(id, (r) => (e.target.value ? (r.name = e.target.value) : delete r.name))} />
        </div>
        <div className="space-y-1">
          <span className="block font-medium">{t('inspector.relationshipKind')}</span>
          <SegmentedControl<Relationship['kind']>
            label={t('inspector.relationshipKind')}
            value={kind}
            onChange={(v) => updateRelationship(id, (r) => ((r.kind = v), (r.storage = defaultStorage(v, r.cardinality))), true)}
            options={[
              { value: 'reference', label: t('rel.reference') },
              { value: 'embed', label: t('rel.embed') },
            ]}
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="min-w-28 flex-1 space-y-1">
            <label htmlFor={`rel-card-${id}`} className="block font-medium">
              {t('inspector.cardinality')}
            </label>
            <select id={`rel-card-${id}`} className="field field-sm" value={cardinality} onChange={(e) => updateRelationship(id, (r) => ((r.cardinality = e.target.value as Cardinality), (r.storage = defaultStorage(r.kind, r.cardinality))), true)}>
              <option value="1:1">{t('rel.oneToOne')}</option>
              <option value="1:N">{t('rel.oneToMany')}</option>
              <option value="N:M">{t('rel.manyToMany')}</option>
            </select>
          </div>
          <div className="min-w-28 flex-1 space-y-1">
            <label htmlFor={`rel-storage-${id}`} className="block font-medium">
              {t('inspector.storage')}
            </label>
            <select id={`rel-storage-${id}`} className="field field-sm" value={storage} onChange={(e) => updateRelationship(id, (r) => void (r.storage = e.target.value as 'single'), true)}>
              <option value="single">{kind === 'embed' ? t('rel.singleEmbed') : t('rel.singleRef')}</option>
              <option value="array">{kind === 'embed' ? t('rel.arrayEmbed') : t('rel.arrayRef')}</option>
            </select>
          </div>
        </div>
        {kind === 'reference' && cardinality === 'N:M' && from.collectionId !== to.collectionId && (
          <Checkbox label={t('inspector.twoWay', { name: nameOf(to.collectionId) })} checked={Boolean(relationship.twoWay)} onChange={(v) => updateRelationship(id, (r) => (v ? (r.twoWay = true) : delete r.twoWay), true)} />
        )}
      </div>
      <InspectorSection title={t('inspector.advice')}>
        <div className={`space-y-2 rounded-theme p-3 ${rec.kind === kind ? 'bg-surface-2' : 'bg-warning-soft'}`}>
          <p className="font-semibold">{rec.kind === 'embed' ? t('advisor.recommendEmbed') : t('advisor.recommendReference')}</p>
          <p>{t(rec.reason)}</p>
          {pattern && (
            <p>
              <span className="font-semibold">{t(pattern.name)}: </span>
              {t(pattern.text)}
            </p>
          )}
        </div>
      </InspectorSection>
      <InspectorSection title={issues.length ? t('common.warningsTitle', { count: issues.length }) : t('common.warnings')}>
        <InspectorIssueList issues={issues} />
      </InspectorSection>
      <div className="px-4 py-4">
        <Button variant="danger" onClick={() => setConfirming(true)}>
          {t('inspector.deleteRelationship')}
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        title={t('inspector.deleteRelationship')}
        message={t('inspector.deleteRelationshipMessage', { path: `${nameOf(from.collectionId)}.${from.fieldPath}` })}
        confirmLabel={t('inspector.deleteRelationship')}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          deleteRelationship(id, removeField);
        }}
      >
        <Checkbox label={t('inspector.removeFieldToo', { path: from.fieldPath })} checked={removeField} onChange={setRemoveField} />
      </ConfirmDialog>
    </>
  );
};

export default InspectorRelationship;
