import { useReactFlow } from '@xyflow/react';
import { useMemo } from 'react';
import type { MenuItem } from '../../components/ui/menu/menu-list';
import { ENGINES } from '../../domain/engines';
import { addCollection, addField, addRandomDocuments, duplicateCollection } from '../../lib/actions';
import useProjectStore from '../../stores/use-project-store';
import useUiStore, { type ContextMenuState } from '../../stores/use-ui-store';
import usePanels from '../ui/use-panels';
import useT from '../ui/use-t';
import useAutoLayout from './use-auto-layout';
import useExportImage from './use-export-image';

const RANDOM_DOCS = 10;

/** Items of the canvas right-click menu: one set for a collection, another for the empty canvas. */
const useCanvasContextMenu = (menu: ContextMenuState | null) => {
  const collection = useProjectStore((s) => (menu?.collectionId ? s.project?.collections.find((c) => c.id === menu.collectionId) : undefined));
  const engine = useProjectStore((s) => s.project?.engine ?? 'mongodb');
  const { setVisible, isVisible, focusMode, setFocusMode } = usePanels();
  const autoLayout = useAutoLayout();
  const t = useT();
  const exportImage = useExportImage();
  const { fitView } = useReactFlow();

  return useMemo((): { label: string; items: MenuItem[] } | null => {
    if (!menu) return null;
    const ui = useUiStore.getState();
    const edit = () => {
      if (!collection) return;
      ui.select({ kind: 'collection', id: collection.id });
      if (!isVisible('inspector')) setVisible('inspector', true);
    };

    if (menu.collectionId) {
      if (!collection) return null;
      const { id, name } = collection;
      return {
        label: t('canvas.collectionActions', { name }),
        items: [
          { label: t('canvas.edit'), onSelect: edit },
          {
            label: t('inspector.addField'),
            onSelect: () => {
              edit();
              addField(id);
            },
          },
          ...(ENGINES[engine].subcollections ? [{ label: t('canvas.addSubcollection'), onSelect: () => addCollection(undefined, id) }] : []),
          { label: t('canvas.embedIn'), onSelect: () => ui.openRelationshipDialog({ fromId: id, kind: 'embed' }), separatorBefore: true },
          { label: t('canvas.referenceTo'), onSelect: () => ui.openRelationshipDialog({ fromId: id, kind: 'reference' }) },
          { label: t('canvas.viewDocuments'), onSelect: () => ui.showDocuments(id), separatorBefore: true },
          {
            label: t('canvas.generateDocuments', { count: RANDOM_DOCS }),
            onSelect: () => {
              const added = addRandomDocuments(id, RANDOM_DOCS);
              ui.notify(t('docs.generated', { count: added, name }));
            },
          },
          { label: t('agentExport.contextMenu'), onSelect: () => ui.openAgentExport(id) },
          { label: t('common.duplicate'), onSelect: () => duplicateCollection(id), separatorBefore: true },
          { label: t('common.delete'), danger: true, hint: t('inspector.shortcut.deleteKey'), onSelect: () => ui.requestDeleteCollection(id) },
        ],
      };
    }

    return {
      label: t('canvas.diagramActions'),
      items: [
        { label: t('canvas.newCollectionHere'), hint: 'E', onSelect: () => addCollection(menu.flowPosition) },
        { label: t('canvas.newRelationship'), onSelect: () => ui.openRelationshipDialog() },
        { label: t('canvas.arrange'), onSelect: autoLayout, separatorBefore: true },
        { label: t('canvas.fitView'), onSelect: () => void fitView({ padding: 0.15, duration: 250, maxZoom: 1 }) },
        { label: t('export.copyPng'), onSelect: () => void exportImage('copy-png') },
        { label: t('panels.focus'), hint: 'F', checked: focusMode, onSelect: () => setFocusMode(!focusMode), separatorBefore: true },
      ],
    };
  }, [menu, collection, engine, isVisible, setVisible, focusMode, setFocusMode, autoLayout, fitView, exportImage, t]);
};

export default useCanvasContextMenu;
