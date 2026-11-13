import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { defaultStorage, suggestFieldName } from '../../domain/relationships';
import type { Cardinality, Relationship } from '../../domain/types';
import { addRelationship } from '../../lib/actions';
import useProjectStore from '../../stores/use-project-store';
import useUiStore from '../../stores/use-ui-store';

/** State of the new relationship dialog: ends, kind, cardinality, storage, field name and embedded fields. */
const useRelationshipForm = () => {
  const project = useProjectStore((s) => s.project);
  const dialog = useUiStore((s) => s.relationshipDialog);
  const close = useUiStore((s) => s.closeRelationshipDialog);
  const collections = useMemo(() => project?.collections ?? [], [project]);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [kind, setKind] = useState<Relationship['kind']>('reference');
  const [cardinality, setCardinality] = useState<Cardinality>('1:N');
  const [storage, setStorage] = useState<Relationship['storage']>('single');
  const [fieldName, setFieldName] = useState('');
  const [twoWay, setTwoWay] = useState(false);
  const [embedFieldIds, setEmbedFieldIds] = useState<string[] | null>(null);

  useEffect(() => {
    if (!dialog.open) return;
    setFromId(dialog.fromId ?? collections[0]?.id ?? '');
    setToId(dialog.toId ?? collections.find((c) => c.id !== dialog.fromId)?.id ?? collections[0]?.id ?? '');
    setKind(dialog.kind ?? 'reference');
    setCardinality('1:N');
    setStorage(defaultStorage(dialog.kind ?? 'reference', '1:N'));
    setFieldName('');
    setTwoWay(false);
    setEmbedFieldIds(null);
  }, [dialog]); // eslint-disable-line react-hooks/exhaustive-deps

  const target = collections.find((c) => c.id === toId);
  const targetFields = (target?.fields ?? []).filter((f) => f.name !== '_rev');
  const suggestion = project && toId ? suggestFieldName(project, { kind, toId, cardinality, storage }) : '';

  const changeKind = (next: Relationship['kind']) => {
    setKind(next);
    setStorage(defaultStorage(next, cardinality));
  };
  const changeCardinality = (next: Cardinality) => {
    setCardinality(next);
    setStorage(defaultStorage(kind, next));
  };
  const changeTarget = (id: string) => {
    setToId(id);
    setEmbedFieldIds(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!fromId || !toId) return;
    addRelationship({
      kind,
      fromId,
      toId,
      cardinality,
      storage,
      fieldName: fieldName.trim() || suggestion,
      twoWay: kind === 'reference' && cardinality === 'N:M' && twoWay,
      embedFieldIds: kind === 'embed' && embedFieldIds ? embedFieldIds : undefined,
    });
    close();
  };

  return {
    open: dialog.open,
    close,
    collections,
    fields: { fromId, setFromId, toId, setToId: changeTarget, kind, setKind: changeKind, cardinality, setCardinality: changeCardinality, storage, setStorage, fieldName, setFieldName, twoWay, setTwoWay },
    embed: {
      targetFields,
      selected: embedFieldIds ?? targetFields.filter((f) => f.name !== '_id').map((f) => f.id),
      toggle: (id: string, on: boolean) => {
        const current = embedFieldIds ?? targetFields.filter((f) => f.name !== '_id').map((f) => f.id);
        setEmbedFieldIds(on ? [...current, id] : current.filter((x) => x !== id));
      },
    },
    suggestion,
    submit,
  };
};

export default useRelationshipForm;
