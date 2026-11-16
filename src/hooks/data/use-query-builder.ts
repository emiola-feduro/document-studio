import { useMemo } from 'react';
import { buildQuery, EMPTY_QUERY, joinOptions, queryPaths, type JoinMode, type QueryPath, type QuerySpec } from '../../domain/query-builder';
import useProjectStore from '../../stores/use-project-store';
import useQueryStore from '../../stores/use-query-store';

/** State of the query builder and the code it produces. Each project keeps its own query. */
const useQueryBuilder = () => {
  const project = useProjectStore((s) => s.project);
  const projectId = project?.id ?? '';
  const stored = useQueryStore((s) => s.specs[projectId]);
  const setStored = useQueryStore((s) => s.setSpec);
  const collections = useMemo(() => project?.collections ?? [], [project]);

  // A base collection deleted since the query was built leaves the query empty.
  const spec = useMemo((): QuerySpec => {
    const base = stored ?? EMPTY_QUERY;
    return base.rootId && !collections.some((c) => c.id === base.rootId) ? EMPTY_QUERY : base;
  }, [stored, collections]);
  const setSpec = (update: (spec: QuerySpec) => QuerySpec) => projectId && setStored(projectId, update);

  const options = useMemo(() => (project ? joinOptions(project, spec) : []), [project, spec]);
  const joins = useMemo(() => options.filter((o) => spec.joins.includes(o.id)), [options, spec.joins]);
  const result = useMemo(() => (project ? buildQuery(project, spec) : undefined), [project, spec]);
  const root = collections.find((c) => c.id === spec.rootId);

  /** Paths the filter can use: the base collection, and in MongoDB the joined documents too. */
  const filterPaths = useMemo((): QueryPath[] => {
    if (!root || !project) return [];
    const own = queryPaths(root);
    if (project.engine !== 'mongodb') return own;
    return [...own, ...joins.flatMap((j) => queryPaths(j.target, j.as))];
  }, [root, project, joins]);

  const setRoot = (rootId: string) => setSpec(() => ({ ...EMPTY_QUERY, rootId: rootId || undefined }));
  const toggleJoin = (id: string, on: boolean) =>
    setSpec((s) => ({
      ...s,
      // Turning a reference off also drops the ones reached through it.
      joins: on ? [...s.joins, id] : s.joins.filter((j) => j !== id && !j.startsWith(`${id}/`)),
    }));
  const setMode = (id: string, mode: JoinMode) => setSpec((s) => ({ ...s, modes: { ...s.modes, [id]: mode } }));
  const toggleField = (key: string, all: string[], name: string, on: boolean) =>
    setSpec((s) => {
      const current = s.fields?.[key] ?? all;
      const next = on ? all.filter((f) => current.includes(f) || f === name) : current.filter((f) => f !== name);
      const fields = { ...s.fields };
      if (next.length === all.length) delete fields[key];
      else fields[key] = next;
      return { ...s, fields };
    });
  const setAllFields = (key: string, on: boolean) =>
    setSpec((s) => {
      const fields = { ...s.fields };
      if (on) delete fields[key];
      else fields[key] = [];
      return { ...s, fields };
    });
  const update = (patch: Partial<QuerySpec>) => setSpec((s) => ({ ...s, ...patch }));
  const clear = () => setSpec(() => EMPTY_QUERY);

  return { project, collections, root, spec, options, joins, result, filterPaths, setRoot, toggleJoin, setMode, toggleField, setAllFields, update, clear };
};

export type QueryBuilderState = ReturnType<typeof useQueryBuilder>;

export default useQueryBuilder;
