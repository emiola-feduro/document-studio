import { useCallback, useState } from 'react';
import { MAX_ROWS, runCall, sampleData, type Prepared, type RunResult } from '../../domain/query/run';
import useProjectStore from '../../stores/use-project-store';

export type RunSource = 'generated' | 'sql' | 'native';

export type RunState = {
  status: 'idle' | 'loading' | 'done' | 'error';
  result?: RunResult;
  error?: string;
  warnings: string[];
  from?: RunSource;
  /** What was run: the query text and the documents at that moment, to tell when it is out of date. */
  key?: string;
};

/** Runs a query on a copy of the sample documents; mingo loads the first time it is needed. */
const useQueryRun = () => {
  const project = useProjectStore((s) => s.project);
  const [state, setState] = useState<RunState>({ status: 'idle', warnings: [] });

  const run = useCallback(
    async (prepare: () => Prepared, from: RunSource, key: string) => {
      if (!project) return;
      setState((s) => ({ ...s, status: 'loading', from }));
      try {
        const mingo = await import('mingo');
        const prepared = prepare();
        if (prepared.error || !prepared.call) {
          setState({ status: 'error', error: prepared.error, warnings: prepared.warnings, from, key });
          return;
        }
        const result = runCall(mingo, prepared.call, sampleData(project));
        setState({ status: 'done', result, warnings: prepared.warnings, from, key });
      } catch (e) {
        setState({ status: 'error', error: e instanceof Error ? e.message : String(e), warnings: [], from, key });
      }
    },
    [project],
  );

  return { state, run, documentsKey: JSON.stringify(project?.documents ?? {}).length + ':' + (project?.updatedAt ?? 0), maxRows: MAX_ROWS };
};

export default useQueryRun;
