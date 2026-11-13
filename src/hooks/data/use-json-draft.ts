import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import { uid } from '../../domain/model';
import type { SampleDocument } from '../../domain/types';
import { setDocuments } from '../../lib/actions';

const toText = (docs: SampleDocument[]) => {
  const values = docs.map((d) => {
    try {
      return JSON.parse(d.json) as unknown;
    } catch {
      return d.json;
    }
  });
  return JSON.stringify(values, null, 2);
};

/**
 * Text of a collection's documents as one JSON array. Valid edits are saved as they are typed;
 * while the text does not parse, the draft stays local and the error is shown.
 */
const useJsonDraft = (collectionId: string, docs: SampleDocument[]) => {
  const [text, setText] = useState(() => toText(docs));
  const [error, setError] = useState<string | null>(null);
  const own = useRef(false);

  // Changes from elsewhere (generation, table edits, undo) replace the draft.
  useEffect(() => {
    if (own.current) {
      own.current = false;
      return;
    }
    setText(toText(docs));
    setError(null);
  }, [docs]);

  const onChange = (value: string) => {
    setText(value);
    let parsed: unknown;
    try {
      parsed = JSON.parse(value || '[]');
    } catch (e) {
      setError(t('docs.err.json', { detail: e instanceof Error ? e.message : String(e) }));
      return;
    }
    if (!Array.isArray(parsed) || parsed.some((d) => !d || typeof d !== 'object' || Array.isArray(d))) {
      setError(t('docs.err.notArray'));
      return;
    }
    setError(null);
    own.current = true;
    setDocuments(
      collectionId,
      parsed.map((value, i) => ({ id: docs[i]?.id ?? uid(), json: JSON.stringify(value, null, 2) })),
      `docs-json:${collectionId}`,
    );
  };

  return { text, error, onChange };
};

export default useJsonDraft;
