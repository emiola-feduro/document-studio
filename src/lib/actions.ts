import { t } from '../i18n';
import { createCollection, nextName, removeCollection } from '../domain/model';
import useProjectStore from '../stores/use-project-store';
import useUiStore from '../stores/use-ui-store';

/** Adds a collection with a free default name and selects it. */
export const addCollection = (position?: { x: number; y: number }) => {
  const { project, mutate } = useProjectStore.getState();
  if (!project) return;
  const name = nextName(t('collection.defaultName'), project.collections.map((c) => c.name));
  const offset = project.collections.length * 32;
  const collection = createCollection(project.engine, name, position ?? { x: 80 + offset, y: 80 + offset });
  mutate((draft) => {
    draft.collections.push(collection);
  });
  useUiStore.getState().select({ kind: 'collection', id: collection.id });
};

/** Deletes a collection once the person has confirmed it. */
export const deleteCollection = (id: string) => {
  useProjectStore.getState().mutate((draft) => removeCollection(draft, id));
  const ui = useUiStore.getState();
  if (ui.selection?.id === id) ui.select(null);
};

/** Delete key: collections ask first, relationships go right away (Undo brings them back). */
export const deleteSelection = () => {
  const ui = useUiStore.getState();
  const selection = ui.selection;
  if (!selection) return;
  if (selection.kind === 'collection') {
    ui.requestDeleteCollection(selection.id);
    return;
  }
  useProjectStore.getState().mutate((draft) => {
    draft.relationships = draft.relationships.filter((r) => r.id !== selection.id);
  });
  ui.select(null);
};

export const moveCollections = (moves: { id: string; position: { x: number; y: number } }[]) =>
  useProjectStore.getState().mutate((draft) => {
    for (const { id, position } of moves) {
      const collection = draft.collections.find((c) => c.id === id);
      if (collection) collection.position = { x: Math.round(position.x), y: Math.round(position.y) };
    }
  });
