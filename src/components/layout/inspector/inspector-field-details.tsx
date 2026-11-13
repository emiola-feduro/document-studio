import { X } from 'lucide-react';
import { ENGINES } from '../../../domain/engines';
import { defaultSuggestions, PATTERN_PRESETS } from '../../../domain/field-suggestions';
import { locateField } from '../../../domain/paths';
import type { Collection, EngineId, Field } from '../../../domain/types';
import useT from '../../../hooks/ui/use-t';
import { updateField } from '../../../lib/actions';
import useProjectStore from '../../../stores/use-project-store';
import useUiStore from '../../../stores/use-ui-store';
import Checkbox from '../../ui/checkbox/checkbox';
import ExpressionInput from '../../ui/expression-input/expression-input';
import IconButton from '../../ui/icon-button/icon-button';
import InspectorEnumValues from './inspector-enum-values';
import InspectorNumberField from './inspector-number-field';
import InspectorSection from './inspector-section';

type InspectorFieldDetailsProps = {
  collection: Collection;
  engine: EngineId;
};

const NUMERIC = ['int', 'long', 'double', 'decimal', 'number'];

/** Constraints of the field chosen in the tree, depending on its type. */
const InspectorFieldDetails = ({ collection, engine }: InspectorFieldDetailsProps) => {
  const t = useT();
  const focus = useUiStore((s) => s.fieldFocus);
  const setFieldFocus = useUiStore((s) => s.setFieldFocus);
  const collections = useProjectStore((s) => s.project?.collections ?? []);
  const loc = focus?.collectionId === collection.id ? locateField(collection.fields, focus.fieldId) : undefined;
  if (!loc) return null;
  const { field, path } = loc;
  const id = field.id;
  const set = (change: (f: Field) => void) => updateField(collection.id, id, change);
  const system = loc.depth === 0 && ENGINES[engine].systemFields.some((s) => s.name === field.name);
  const holder = field.type === 'array' ? field.items : field;
  const canReference = holder && ['objectId', 'reference', 'string', 'uuid'].includes(holder.type);

  return (
    <InspectorSection
      title={t('inspector.fieldDetails', { path })}
      action={
        <IconButton size="sm" label={t('common.close')} onClick={() => setFieldFocus(null)}>
          <X size={15} />
        </IconButton>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <Checkbox label={t('inspector.required')} checked={field.required} disabled={system} onChange={(v) => set((f) => void (f.required = v))} />
          <Checkbox label={t('inspector.nullable')} checked={field.nullable} onChange={(v) => set((f) => void (f.nullable = v))} />
        </div>
        {field.type === 'enum' && <InspectorEnumValues id={`enum-${id}`} values={field.enumValues ?? []} onChange={(values) => set((f) => void (f.enumValues = values))} />}
        {field.type === 'array' && field.items?.type === 'enum' && (
          <InspectorEnumValues id={`enum-items-${id}`} values={field.items.enumValues ?? []} onChange={(values) => set((f) => void (f.items!.enumValues = values))} />
        )}
        {!['object', 'array'].includes(field.type) && (
          <div className="space-y-1">
            <label htmlFor={`default-${id}`} className="block font-medium">
              {t('inspector.default')}
            </label>
            <ExpressionInput
              id={`default-${id}`}
              value={field.defaultValue ?? ''}
              onChange={(v) => set((f) => (v ? (f.defaultValue = v) : delete f.defaultValue))}
              suggestions={defaultSuggestions(field)}
              columns={[]}
            />
          </div>
        )}
        {field.type === 'string' && (
          <>
            <div className="flex flex-wrap gap-3">
              <InspectorNumberField id={`minlen-${id}`} label={t('inspector.minLength')} min={0} step={1} value={field.minLength} onChange={(v) => set((f) => void (f.minLength = v))} />
              <InspectorNumberField id={`maxlen-${id}`} label={t('inspector.maxLength')} min={0} step={1} value={field.maxLength} onChange={(v) => set((f) => void (f.maxLength = v))} />
            </div>
            <div className="space-y-1">
              <label htmlFor={`pattern-${id}`} className="block font-medium">
                {t('inspector.pattern')}
              </label>
              <ExpressionInput
                id={`pattern-${id}`}
                value={field.pattern ?? ''}
                onChange={(v) => set((f) => (v ? (f.pattern = v) : delete f.pattern))}
                suggestions={PATTERN_PRESETS()}
                columns={[]}
                placeholder="^[A-Z]{3}-[0-9]{4}$"
                invalid={(() => {
                  try {
                    if (field.pattern) new RegExp(field.pattern);
                    return false;
                  } catch {
                    return true;
                  }
                })()}
              />
            </div>
          </>
        )}
        {NUMERIC.includes(field.type) && (
          <div className="flex flex-wrap items-end gap-3">
            <InspectorNumberField id={`min-${id}`} label={t('inspector.minimum')} value={field.minimum} onChange={(v) => set((f) => void (f.minimum = v))} />
            <InspectorNumberField id={`max-${id}`} label={t('inspector.maximum')} value={field.maximum} onChange={(v) => set((f) => void (f.maximum = v))} />
            <span className="pb-1.5">
              <Checkbox label={t('inspector.exclusiveMin')} checked={Boolean(field.exclusiveMin)} onChange={(v) => set((f) => (v ? (f.exclusiveMin = true) : delete f.exclusiveMin))} />
            </span>
          </div>
        )}
        {field.type === 'array' && (
          <div className="flex flex-wrap items-end gap-3">
            <InspectorNumberField id={`minitems-${id}`} label={t('inspector.minItems')} min={0} step={1} value={field.minItems} onChange={(v) => set((f) => void (f.minItems = v))} />
            <InspectorNumberField id={`maxitems-${id}`} label={t('inspector.maxItems')} min={0} step={1} value={field.maxItems} onChange={(v) => set((f) => void (f.maxItems = v))} />
            <span className="pb-1.5">
              <Checkbox label={t('inspector.uniqueItems')} checked={Boolean(field.uniqueItems)} onChange={(v) => set((f) => (v ? (f.uniqueItems = true) : delete f.uniqueItems))} />
            </span>
          </div>
        )}
        {canReference && !system && (
          <div className="space-y-1">
            <label htmlFor={`ref-${id}`} className="block font-medium">
              {t('inspector.referencesTo')}
            </label>
            <select
              id={`ref-${id}`}
              className="field field-sm"
              value={holder!.reference?.collectionId ?? ''}
              onChange={(e) =>
                set((f) => {
                  const h = f.type === 'array' ? f.items! : f;
                  if (!e.target.value) delete h.reference;
                  else h.reference = { collectionId: e.target.value, fieldPath: engine === 'firestore' ? '__name__' : '_id' };
                })
              }
            >
              <option value="">{t('inspector.noReference')}</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="space-y-1">
          <label htmlFor={`desc-${id}`} className="block font-medium">
            {t('inspector.description')}
          </label>
          <textarea
            id={`desc-${id}`}
            className="field field-sm min-h-14 resize-y"
            value={field.description ?? ''}
            onChange={(e) => set((f) => (e.target.value ? (f.description = e.target.value) : delete f.description))}
          />
        </div>
      </div>
    </InspectorSection>
  );
};

export default InspectorFieldDetails;
