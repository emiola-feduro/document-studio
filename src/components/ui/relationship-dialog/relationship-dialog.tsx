import type { Cardinality, Relationship } from '../../../domain/types';
import useRelationshipForm from '../../../hooks/model/use-relationship-form';
import useT from '../../../hooks/ui/use-t';
import Button from '../button/button';
import Checkbox from '../checkbox/checkbox';
import Modal from '../modal/modal';
import SegmentedControl from '../segmented-control/segmented-control';
import SuggestionInput from '../suggestion-input/suggestion-input';

/** New embedded or referenced relationship between two collections. */
const RelationshipDialog = () => {
  const t = useT();
  const { open, close, collections, fields, embed, suggestion, submit } = useRelationshipForm();
  const { fromId, setFromId, toId, setToId, kind, setKind, cardinality, setCardinality, storage, setStorage, fieldName, setFieldName, twoWay, setTwoWay } = fields;
  const enough = collections.length > 0;

  return (
    <Modal title={t('relDialog.title')} open={open} onClose={close} width="max-w-lg">
      {!enough ? (
        <p>{t('relDialog.needCollections')}</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <span className="block font-medium">{t('inspector.relationshipKind')}</span>
            <SegmentedControl<Relationship['kind']>
              label={t('inspector.relationshipKind')}
              value={kind}
              onChange={setKind}
              options={[
                { value: 'reference', label: t('rel.reference') },
                { value: 'embed', label: t('rel.embed') },
              ]}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="rel-from" className="block font-medium">
                {kind === 'embed' ? t('relDialog.container') : t('relDialog.holder')}
              </label>
              <select id="rel-from" className="field" value={fromId} onChange={(e) => setFromId(e.target.value)}>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="rel-to" className="block font-medium">
                {kind === 'embed' ? t('relDialog.embedded') : t('relDialog.target')}
              </label>
              <select id="rel-to" className="field" value={toId} onChange={(e) => setToId(e.target.value)}>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="rel-cardinality" className="block font-medium">
                {t('inspector.cardinality')}
              </label>
              <select id="rel-cardinality" className="field" value={cardinality} onChange={(e) => setCardinality(e.target.value as Cardinality)}>
                <option value="1:1">{t('rel.oneToOne')}</option>
                <option value="1:N">{t('rel.oneToMany')}</option>
                <option value="N:M">{t('rel.manyToMany')}</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="rel-storage" className="block font-medium">
                {t('inspector.storage')}
              </label>
              <select id="rel-storage" className="field" value={storage} onChange={(e) => setStorage(e.target.value as Relationship['storage'])}>
                <option value="single">{kind === 'embed' ? t('rel.singleEmbed') : t('rel.singleRef')}</option>
                <option value="array">{kind === 'embed' ? t('rel.arrayEmbed') : t('rel.arrayRef')}</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="rel-field" className="block font-medium">
              {t('relDialog.fieldName')}
            </label>
            <SuggestionInput id="rel-field" className="field font-canvas" value={fieldName} suggestion={suggestion} spellCheck={false} onChange={setFieldName} />
          </div>
          {kind === 'reference' && cardinality === 'N:M' && fromId !== toId && (
            <Checkbox label={t('inspector.twoWay', { name: collections.find((c) => c.id === toId)?.name ?? '' })} checked={twoWay} onChange={setTwoWay} />
          )}
          {kind === 'embed' && embed.targetFields.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="font-medium">{t('relDialog.embedFields')}</legend>
              <div className="grid max-h-40 grid-cols-1 gap-x-4 gap-y-1.5 overflow-y-auto sm:grid-cols-2">
                {embed.targetFields.map((f) => (
                  <Checkbox key={f.id} label={f.name} checked={embed.selected.includes(f.id)} onChange={(on) => embed.toggle(f.id, on)} />
                ))}
              </div>
            </fieldset>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={close}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary" disabled={!fromId || !toId}>
              {t('relDialog.create')}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};

export default RelationshipDialog;
