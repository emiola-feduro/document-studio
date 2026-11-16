import { LOCALES, type Locale } from '../../../i18n';
import { NAMING_CONVENTIONS, projectNaming, referenceFieldName, type NamingConvention } from '../../../domain/naming';
import useT from '../../../hooks/ui/use-t';
import { applyNamingToAllFields, setNaming } from '../../../lib/actions';
import useProjectStore from '../../../stores/use-project-store';
import Button from '../../ui/button/button';
import SegmentedControl from '../../ui/segmented-control/segmented-control';
import InspectorSection from './inspector-section';

/** Language and convention of the project names, used to name new reference and embedded fields. */
const InspectorNaming = () => {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  if (!project) return null;
  const naming = projectNaming(project);
  const sample = project.collections.find((c) => c.kind === 'collection')?.name || t('naming.sampleCollection');

  return (
    <InspectorSection title={t('naming.title')}>
      <div className="space-y-3">
        <div className="space-y-1">
          <label htmlFor="names-locale" className="block font-medium">
            {t('naming.locale')}
          </label>
          <select id="names-locale" className="field field-sm" value={naming.locale} onChange={(e) => setNaming({ namesLocale: e.target.value as Locale })}>
            {LOCALES.map(({ id, name }) => (
              <option key={id} value={id} lang={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <span className="block font-medium">{t('naming.convention')}</span>
          <SegmentedControl<NamingConvention>
            label={t('naming.convention')}
            value={naming.convention}
            onChange={(namingConvention) => setNaming({ namingConvention })}
            options={NAMING_CONVENTIONS.map((c) => ({ value: c, label: c }))}
          />
        </div>
        <p className="text-muted">
          {t('naming.example', { collection: sample, field: referenceFieldName(sample, false, naming) })}
        </p>
        <Button size="sm" onClick={applyNamingToAllFields} disabled={project.collections.length === 0}>
          {t('naming.applyAll')}
        </Button>
      </div>
    </InspectorSection>
  );
};

export default InspectorNaming;
