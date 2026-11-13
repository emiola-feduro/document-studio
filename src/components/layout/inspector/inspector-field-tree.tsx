import { ENGINES } from '../../../domain/engines';
import { camelCase, snakeCase } from '../../../domain/naming';
import { walkFields } from '../../../domain/paths';
import type { Collection, EngineId, Field } from '../../../domain/types';
import useT from '../../../hooks/ui/use-t';
import { addField, convertFieldNames } from '../../../lib/actions';
import useUiStore from '../../../stores/use-ui-store';
import Button from '../../ui/button/button';
import Menu from '../../ui/menu/menu';
import InspectorFieldRow from './inspector-field-row';
import InspectorSection from './inspector-section';

type InspectorFieldTreeProps = {
  collection: Collection;
  engine: EngineId;
};

/** The collection's fields as an editable tree. */
const InspectorFieldTree = ({ collection, engine }: InspectorFieldTreeProps) => {
  const t = useT();
  const focus = useUiStore((s) => s.fieldFocus);
  const collapsed = useUiStore((s) => s.collapsedFields);
  const system = new Set(ENGINES[engine].systemFields.map((f) => f.name));
  const entries = walkFields(collection.fields);
  const collapsedPaths = entries.filter((e) => collapsed[e.field.id]).map((e) => e.path);
  const isHidden = (path: string) => collapsedPaths.some((p) => path.startsWith(`${p}.`) || path.startsWith(`${p}[]`));
  const siblingsOf = (parentPath: string): Field[] => entries.filter((e) => e.parentPath === parentPath).map((e) => e.field);

  return (
    <InspectorSection
      title={t('inspector.fields')}
      action={
        <div className="flex items-center gap-1">
          <Menu
            trigger={({ open, toggle }) => (
              <Button size="sm" variant="ghost" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
                {t('inspector.names')}
              </Button>
            )}
            items={[
              { label: t('inspector.toCamel'), onSelect: () => convertFieldNames(collection.id, camelCase) },
              { label: t('inspector.toSnake'), onSelect: () => convertFieldNames(collection.id, snakeCase) },
            ]}
          />
          <Button size="sm" onClick={() => addField(collection.id)}>
            {t('inspector.addField')}
          </Button>
        </div>
      }
    >
      {entries.length === 0 ? (
        <p className="text-muted">{t('inspector.noFields')}</p>
      ) : (
        <ul className="space-y-0.5">
          {entries
            .filter((e) => !isHidden(e.path))
            .map((entry) => {
              const siblings = siblingsOf(entry.parentPath);
              const index = siblings.indexOf(entry.field);
              return (
                <InspectorFieldRow
                  key={entry.field.id}
                  collectionId={collection.id}
                  engine={engine}
                  entry={entry}
                  system={entry.depth === 0 && system.has(entry.field.name)}
                  focused={focus?.fieldId === entry.field.id}
                  collapsed={Boolean(collapsed[entry.field.id])}
                  first={index === 0}
                  last={index === siblings.length - 1}
                />
              );
            })}
        </ul>
      )}
    </InspectorSection>
  );
};

export default InspectorFieldTree;
