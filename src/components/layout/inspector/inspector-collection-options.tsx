import { allPaths } from '../../../domain/paths';
import type { Collection, EngineId } from '../../../domain/types';
import useT from '../../../hooks/ui/use-t';
import { setCollectionOptions } from '../../../lib/actions';
import Checkbox from '../../ui/checkbox/checkbox';
import InspectorNumberField from './inspector-number-field';
import InspectorSection from './inspector-section';

type InspectorCollectionOptionsProps = {
  collection: Collection;
  engine: EngineId;
};

/** Validation settings, TTL, and the MongoDB capped and time series options; CouchDB's type field. */
const InspectorCollectionOptions = ({ collection, engine }: InspectorCollectionOptionsProps) => {
  const t = useT();
  const { id, options } = collection;
  const set = (change: (o: Collection['options']) => void) => setCollectionOptions(id, change, `options:${id}`);
  const datePaths = allPaths(collection).filter((e) => ['date', 'timestamp'].includes(e.field.type) && !e.inArray).map((e) => e.path);
  const paths = allPaths(collection).filter((e) => !e.inArray).map((e) => e.path);
  const mongo = engine === 'mongodb';

  return (
    <InspectorSection title={t('inspector.options')}>
      <div className="space-y-3">
        <Checkbox
          label={t('inspector.noExtraFields')}
          checked={options.additionalProperties === false}
          onChange={(v) => set((o) => (v ? (o.additionalProperties = false) : delete o.additionalProperties))}
        />
        {mongo && (
          <div className="flex flex-wrap gap-3">
            <div className="min-w-32 flex-1 space-y-1">
              <label htmlFor={`vlevel-${id}`} className="block font-medium">
                {t('inspector.validationLevel')}
              </label>
              <select id={`vlevel-${id}`} className="field field-sm" value={options.validationLevel ?? ''} onChange={(e) => set((o) => (e.target.value ? (o.validationLevel = e.target.value as 'strict') : delete o.validationLevel))}>
                <option value="">{t('common.defaultOption')}</option>
                <option value="strict">strict</option>
                <option value="moderate">moderate</option>
                <option value="off">off</option>
              </select>
            </div>
            <div className="min-w-32 flex-1 space-y-1">
              <label htmlFor={`vaction-${id}`} className="block font-medium">
                {t('inspector.validationAction')}
              </label>
              <select id={`vaction-${id}`} className="field field-sm" value={options.validationAction ?? ''} onChange={(e) => set((o) => (e.target.value ? (o.validationAction = e.target.value as 'error') : delete o.validationAction))}>
                <option value="">{t('common.defaultOption')}</option>
                <option value="error">error</option>
                <option value="warn">warn</option>
              </select>
            </div>
          </div>
        )}
        <fieldset className="space-y-2">
          <legend className="font-medium">{t('inspector.ttl')}</legend>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-32 flex-1 space-y-1">
              <label htmlFor={`ttl-field-${id}`} className="block text-muted">
                {t('inspector.ttlField')}
              </label>
              <select
                id={`ttl-field-${id}`}
                className="field field-sm font-canvas"
                value={options.ttl?.field ?? ''}
                onChange={(e) => set((o) => (e.target.value ? (o.ttl = { field: e.target.value, seconds: o.ttl?.seconds ?? 86400 }) : delete o.ttl))}
              >
                <option value="">{t('inspector.noTtl')}</option>
                {datePaths.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            {options.ttl && (
              <InspectorNumberField id={`ttl-s-${id}`} label={t('inspector.ttlSeconds')} min={0} step={1} value={options.ttl.seconds} onChange={(v) => set((o) => void (o.ttl!.seconds = v ?? 0))} />
            )}
          </div>
          {datePaths.length === 0 && <p className="text-[0.9em] text-muted">{t('inspector.ttlNeedsDate')}</p>}
        </fieldset>
        {mongo && (
          <fieldset className="space-y-2">
            <legend className="font-medium">{t('inspector.timeseries')}</legend>
            <div className="flex flex-wrap gap-3">
              <div className="min-w-32 flex-1 space-y-1">
                <label htmlFor={`ts-time-${id}`} className="block text-muted">
                  {t('inspector.timeField')}
                </label>
                <select
                  id={`ts-time-${id}`}
                  className="field field-sm font-canvas"
                  value={options.timeseries?.timeField ?? ''}
                  onChange={(e) =>
                    set((o) => {
                      if (!e.target.value) delete o.timeseries;
                      else {
                        o.timeseries = { ...(o.timeseries ?? {}), timeField: e.target.value };
                        delete o.capped;
                      }
                    })
                  }
                >
                  <option value="">{t('inspector.notTimeseries')}</option>
                  {datePaths.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              {options.timeseries && (
                <>
                  <div className="min-w-32 flex-1 space-y-1">
                    <label htmlFor={`ts-meta-${id}`} className="block text-muted">
                      {t('inspector.metaField')}
                    </label>
                    <select id={`ts-meta-${id}`} className="field field-sm font-canvas" value={options.timeseries.metaField ?? ''} onChange={(e) => set((o) => void (o.timeseries!.metaField = e.target.value || undefined))}>
                      <option value="">{t('common.noneOption')}</option>
                      {paths.filter((p) => !p.includes('.')).map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="min-w-28 flex-1 space-y-1">
                    <label htmlFor={`ts-gran-${id}`} className="block text-muted">
                      {t('inspector.granularity')}
                    </label>
                    <select id={`ts-gran-${id}`} className="field field-sm" value={options.timeseries.granularity ?? ''} onChange={(e) => set((o) => void (o.timeseries!.granularity = e.target.value || undefined))}>
                      <option value="">{t('common.defaultOption')}</option>
                      <option value="seconds">seconds</option>
                      <option value="minutes">minutes</option>
                      <option value="hours">hours</option>
                    </select>
                  </div>
                </>
              )}
            </div>
          </fieldset>
        )}
        {mongo && !options.timeseries && (
          <fieldset className="space-y-2">
            <legend className="sr-only">{t('inspector.capped')}</legend>
            <Checkbox label={t('inspector.capped')} checked={Boolean(options.capped)} onChange={(v) => set((o) => (v ? (o.capped = { size: 1048576 }) : delete o.capped))} />
            {options.capped && (
              <div className="flex flex-wrap gap-3">
                <InspectorNumberField id={`cap-size-${id}`} label={t('inspector.cappedSize')} min={1} step={1} value={options.capped.size} onChange={(v) => set((o) => void (o.capped!.size = v ?? 1))} />
                <InspectorNumberField id={`cap-max-${id}`} label={t('inspector.cappedMax')} min={1} step={1} value={options.capped.max} onChange={(v) => set((o) => void (o.capped!.max = v))} />
              </div>
            )}
          </fieldset>
        )}
        {engine === 'couchdb' && (
          <fieldset className="space-y-2">
            <legend className="font-medium">{t('inspector.typeField')}</legend>
            <div className="flex flex-wrap gap-3">
              <div className="min-w-28 flex-1 space-y-1">
                <label htmlFor={`type-field-${id}`} className="block text-muted">
                  {t('inspector.typeFieldName')}
                </label>
                <input id={`type-field-${id}`} className="field field-sm font-canvas" value={options.typeDiscriminator?.field ?? 'type'} onChange={(e) => set((o) => void (o.typeDiscriminator = { field: e.target.value, value: o.typeDiscriminator?.value ?? collection.name }))} />
              </div>
              <div className="min-w-28 flex-1 space-y-1">
                <label htmlFor={`type-value-${id}`} className="block text-muted">
                  {t('inspector.typeFieldValue')}
                </label>
                <input id={`type-value-${id}`} className="field field-sm font-canvas" value={options.typeDiscriminator?.value ?? collection.name} onChange={(e) => set((o) => void (o.typeDiscriminator = { field: o.typeDiscriminator?.field ?? 'type', value: e.target.value }))} />
              </div>
            </div>
          </fieldset>
        )}
      </div>
    </InspectorSection>
  );
};

export default InspectorCollectionOptions;
