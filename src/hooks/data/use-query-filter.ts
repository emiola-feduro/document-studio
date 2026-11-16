import { useCallback, useMemo } from 'react';
import { filterKeys, parseFilter, type QueryPath } from '../../domain/query-builder';
import { filterCompletions } from '../../domain/query-filter';
import type { EngineId } from '../../domain/types';
import type { MessageKey } from '../../i18n';
import useT from '../ui/use-t';

/** Suggestions that follow what is typed in a JSON filter, and the problems to show under it. */
const useQueryFilter = (engine: EngineId | undefined, paths: QueryPath[], text: string) => {
  const t = useT();
  const sample = t('query.sample');

  // Worked out from the text before the cursor, so conditions can be added anywhere.
  const suggestions = useCallback(
    (before: string, after: string) =>
      engine
        ? filterCompletions(engine, paths, before, after, sample).map((c) => ({
            value: c.value,
            display: c.display,
            label: t(`query.meaning.${c.meaning}` as MessageKey, { value: c.detail ?? '' }),
          }))
        : [],
    [engine, paths, sample, t],
  );
  const placeholder = useMemo(() => suggestions('', '')[0]?.value ?? '', [suggestions]);

  const parsed = useMemo(() => parseFilter(text), [text]);
  const unknown = useMemo(() => {
    if (!parsed.value) return [];
    const known = new Set(paths.map((p) => p.path));
    // A path inside a subdocument or an array element is fine as long as it starts with a known path.
    return [...new Set(filterKeys(parsed.value))].filter((k) => !known.has(k) && ![...known].some((p) => k.startsWith(`${p}.`)));
  }, [parsed, paths]);
  const error = parsed.error ? t('query.filterInvalid', { error: parsed.error }) : unknown.length ? t('query.unknown', { names: unknown.join(', ') }) : undefined;

  return { suggestions, placeholder, error, invalid: Boolean(parsed.error) };
};

export default useQueryFilter;
