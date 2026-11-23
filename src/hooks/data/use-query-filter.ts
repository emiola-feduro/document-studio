import { useCallback, useMemo } from 'react';
import { filterKeys, parseFilter, type QueryPath } from '../../domain/query-builder';
import { filterCompletions, NEGATIVE_MEANINGS, sampleIdOf } from '../../domain/query-filter';
import type { EngineId, Project } from '../../domain/types';
import type { MessageKey } from '../../i18n';
import useT from '../ui/use-t';

/** Suggestions that follow what is typed in a JSON filter, and the problems to show under it. */
type FilterOptions = {
  /** For ids taken from real sample documents. */
  project?: Project | null;
  rootId?: string;
  /** A partial index filter (partialFilterExpression) has no negative conditions. */
  positiveOnly?: boolean;
};

const useQueryFilter = (engine: EngineId | undefined, paths: QueryPath[], text: string, { project, rootId, positiveOnly = false }: FilterOptions = {}) => {
  const t = useT();
  const sample = t('query.sample');
  // Ids come from real sample documents, so a condition on a reference finds something.
  const idOf = useMemo(() => (project ? sampleIdOf(project, rootId) : undefined), [project, rootId]);

  // Worked out from the text before the cursor, so conditions can be added anywhere.
  const suggestions = useCallback(
    (before: string, after: string) =>
      engine
        ? filterCompletions(engine, paths, before, after, sample, idOf)
            .filter((c) => !positiveOnly || !NEGATIVE_MEANINGS.has(c.meaning))
            .map((c) => ({
            value: c.value,
            display: c.display,
            label: t(`query.meaning.${c.meaning}` as MessageKey, { value: c.detail ?? '' }),
          }))
        : [],
    [engine, paths, sample, idOf, positiveOnly, t],
  );
  const placeholder = useMemo(() => suggestions('', '')[0]?.value ?? '', [suggestions]);

  const parsed = useMemo(() => parseFilter(text), [text]);
  const unknown = useMemo(() => {
    if (!parsed.value) return [];
    const known = new Set(paths.map((p) => p.path));
    // A path inside a subdocument or an array element is fine as long as it starts with a known path.
    return [...new Set(filterKeys(parsed.value))].filter((k) => !known.has(k) && ![...known].some((p) => k.startsWith(`${p}.`)));
  }, [parsed, paths]);
  const error = parsed.error ?? (unknown.length ? t('query.unknown', { names: unknown.join(', ') }) : undefined);

  return { suggestions, placeholder, error, invalid: Boolean(parsed.error) };
};

export default useQueryFilter;
