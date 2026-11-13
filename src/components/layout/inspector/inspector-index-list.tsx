import type { Collection, EngineId } from '../../../domain/types';
import useT from '../../../hooks/ui/use-t';
import { addIndex } from '../../../lib/actions';
import Button from '../../ui/button/button';
import InspectorIndexItem from './inspector-index-item';
import InspectorSection from './inspector-section';

const InspectorIndexList = ({ collection, engine }: { collection: Collection; engine: EngineId }) => {
  const t = useT();
  return (
    <InspectorSection
      title={t('inspector.indexes')}
      action={
        <Button size="sm" onClick={() => addIndex(collection.id)}>
          {t('inspector.addIndex')}
        </Button>
      }
    >
      {collection.indexes.length === 0 ? (
        <p className="text-muted">{t('inspector.noIndexes')}</p>
      ) : (
        <ul className="space-y-2">
          {collection.indexes.map((index, i) => (
            <InspectorIndexItem key={index.id} collection={collection} index={index} engine={engine} position={i + 1} />
          ))}
        </ul>
      )}
    </InspectorSection>
  );
};

export default InspectorIndexList;
