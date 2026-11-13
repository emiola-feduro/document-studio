import useT from '../../../hooks/ui/use-t';
import useCollectionTree from '../../../hooks/model/use-collection-tree';
import useProjectStore from '../../../stores/use-project-store';
import useUiStore from '../../../stores/use-ui-store';
import SidebarModelItem from './sidebar-model-item';
import SidebarModelSection from './sidebar-model-section';

type SidebarModelListProps = {
  collections: boolean;
  relationships: boolean;
  bordered: boolean;
};

const SidebarModelList = ({ collections: showCollections, relationships: showRelationships, bordered }: SidebarModelListProps) => {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const selection = useUiStore((s) => s.selection);
  const select = useUiStore((s) => s.select);
  const tree = useCollectionTree();

  if (!project) return null;
  const { collections, relationships } = project;
  const nameOf = (id: string) => collections.find((c) => c.id === id)?.name || t('common.unnamed');

  return (
    <div className={`relative min-h-0 flex-1 overflow-y-auto px-2 py-3 ${bordered ? 'border-t border-line' : ''}`}>
      {showCollections && (
        <SidebarModelSection title={t('sidebar.collections')} panel="collections" empty={collections.length === 0}>
          {tree.map(({ collection, depth }) => (
            <SidebarModelItem
              key={collection.id}
              depth={depth}
              label={collection.name || t('common.unnamed')}
              meta={
                collection.parentId
                  ? t('sidebar.subcollection', { parent: nameOf(collection.parentId) })
                  : t('sidebar.fieldsCount', { count: collection.fields.length })
              }
              issues={0}
              active={selection?.id === collection.id}
              onSelect={() => select({ kind: 'collection', id: collection.id })}
            />
          ))}
        </SidebarModelSection>
      )}
      {showRelationships && (
        <SidebarModelSection title={t('sidebar.relationships')} panel="relationships" empty={relationships.length === 0}>
          {relationships.map((rel) => (
            <SidebarModelItem
              key={rel.id}
              label={rel.name?.trim() || `${nameOf(rel.from.collectionId)}.${rel.from.fieldPath}`}
              meta={`${t(rel.kind === 'embed' ? 'sidebar.embed' : 'sidebar.reference')}, ${nameOf(rel.to.collectionId)}, ${rel.cardinality}`}
              issues={0}
              active={selection?.id === rel.id}
              onSelect={() => select({ kind: 'relationship', id: rel.id })}
            />
          ))}
        </SidebarModelSection>
      )}
    </div>
  );
};

export default SidebarModelList;
