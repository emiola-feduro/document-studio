import { formatList } from '../../../i18n';
import usePreferencesStore from '../../../stores/use-preferences-store';
import useT from '../../../hooks/ui/use-t';
import { countFields, descendantsOf } from '../../../domain/model';
import { deleteCollection } from '../../../lib/actions';
import useProjectStore from '../../../stores/use-project-store';
import useUiStore from '../../../stores/use-ui-store';
import ConfirmDialog from '../confirm-dialog/confirm-dialog';

/** Asks before deleting a collection, saying what goes with it. */
const DeleteCollectionDialog = () => {
  const t = useT();
  const collectionId = useUiStore((s) => s.collectionToDelete);
  const request = useUiStore((s) => s.requestDeleteCollection);
  const project = useProjectStore((s) => s.project);
  const locale = usePreferencesStore((s) => s.locale);
  const collection = project?.collections.find((c) => c.id === collectionId);
  if (!project || !collection) return null;

  const { id, name } = collection;
  const children = descendantsOf(project, id);
  const ids = new Set([id, ...children.map((c) => c.id)]);
  const fields = [collection, ...children].reduce((n, c) => n + countFields(c.fields), 0);
  const relationships = project.relationships.filter((r) => ids.has(r.from.collectionId) || ids.has(r.to.collectionId)).length;
  const documents = [...ids].reduce((n, cid) => n + (project.documents?.[cid]?.length ?? 0), 0);
  const parts = [
    fields > 0 && t('count.fields', { count: fields }),
    relationships > 0 && t('count.relationships', { count: relationships }),
    documents > 0 && t('count.documents', { count: documents }),
  ].filter((part): part is string => Boolean(part));
  const message = t('deleteCollection.message', {
    name: name || t('common.unnamed'),
    // Only what the collection actually has: "con 4 campos y 1 relación".
    details: parts.length ? t('deleteCollection.with', { list: formatList(parts, locale) }) : '',
  });
  const childNote = children.length ? ` ${t('deleteCollection.children', { names: formatList(children.map((c) => c.name), locale) })}` : '';

  return (
    <ConfirmDialog
      open
      title={t('deleteCollection.title')}
      message={message + childNote}
      confirmLabel={t('deleteCollection.title')}
      onCancel={() => request(null)}
      onConfirm={() => {
        request(null);
        deleteCollection(id);
      }}
    />
  );
};

export default DeleteCollectionDialog;
