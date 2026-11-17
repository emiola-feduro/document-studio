import { useCallback, useMemo } from 'react';
import type { Diagnostic, QueryIR } from '../../domain/query/ir';
import { nativeHover, signatureAt, sqlHover } from '../../domain/query/hover';
import { nativeCompletions } from '../../domain/query/native-completion';
import { parseNative } from '../../domain/query/native-parse';
import { bindQuery } from '../../domain/query/resolve';
import { sqlCompletions } from '../../domain/query/sql-completion';
import { parseSql } from '../../domain/query/sql-parse';
import { NATIVE_LANGUAGE, toNative, type NativeExtra, type NativeResult } from '../../domain/query/to-native';
import { toSql } from '../../domain/query/to-sql';
import type { MessageKey } from '../../i18n';
import useProjectStore from '../../stores/use-project-store';
import useQueryStore, { type EditorSide, type EditorState } from '../../stores/use-query-store';
import type { CompletionSource } from '../ui/use-code-completion';
import useT from '../ui/use-t';

const EMPTY: EditorState = { side: 'sql', text: '' };

/** A problem found in the native text without a place: underline the first time its name appears. */
const locate = (text: string, d: Diagnostic): Diagnostic => {
  if (d.pos || !text) return d;
  const name = /^(\S+)/.exec(d.message)?.[1]?.replace(/[^\w$.]/g, '');
  if (!name) return d;
  const at = text.search(new RegExp(`(["'\\s{.])${name.replace(/[.$]/g, '\\$&')}(["'\\s:.,)])`));
  return at < 0 ? d : { ...d, pos: { start: at + 1, end: at + 1 + name.length } };
};

/**
 * The query editor: SQL or the engine's native query, whichever is being written, and its live
 * translation to the other. Problems of both steps are listed with their place; switching sides
 * makes the translation the editable text, after saying what does not survive it.
 */
const useQueryEditor = () => {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const projectId = project?.id ?? '';
  const stored = useQueryStore((s) => s.editors[projectId]) ?? EMPTY;
  const setEditor = useQueryStore((s) => s.setEditor);
  const { side, text } = stored;
  const setText = (value: string) => projectId && setEditor(projectId, { side, text: value });

  const result = useMemo(() => {
    const none = { extras: [] as NativeExtra[], missingIndex: undefined as NativeResult['missingIndex'] };
    if (!project) return { other: '', diagnostics: [] as Diagnostic[], losses: [] as string[], ir: undefined as QueryIR | undefined, ...none };
    if (side === 'sql') {
      const parsed = parseSql(text);
      if (!parsed.ir) return { other: '', diagnostics: parsed.diagnostics, losses: [], ir: undefined, ...none };
      const native = toNative(project, parsed.ir);
      const losses = native.diagnostics.filter((d) => d.severity === 'warning').map((d) => d.message);
      return { other: native.text, diagnostics: native.diagnostics, losses, ir: parsed.ir, extras: native.extras ?? [], missingIndex: native.missingIndex };
    }
    const parsed = parseNative(project, text);
    if (!parsed.ir) return { other: '', diagnostics: parsed.diagnostics, losses: [], ir: undefined, ...none };
    const bound = bindQuery(project, parsed.ir);
    const notes = (parsed.ir.untranslated ?? []).map((part) => t('qe.untranslated', { part }));
    const diagnostics = [...parsed.diagnostics, ...bound.diagnostics, ...notes.map((message) => ({ severity: 'warning' as const, message }))].map((d) => locate(text, d));
    // The engine's extras (indexes, views) come from the query as the native text says it.
    const native = toNative(project, parsed.ir);
    return { other: toSql(parsed.ir), diagnostics, losses: notes, ir: parsed.ir, extras: native.extras ?? [], missingIndex: native.missingIndex };
  }, [project, side, text, t]);

  const sample = t('query.sample');
  const sqlSource = useCallback<CompletionSource>(
    (value, caret) => {
      if (!project) return { from: caret, to: caret, items: [] };
      const r = sqlCompletions(value, caret, project, sample);
      return {
        from: r.from,
        to: r.to,
        items: r.items.map((i) => ({
          label: i.label,
          insert: i.insert,
          detail: i.kind === 'operator' && i.meaning ? t(`query.meaning.${i.meaning}` as MessageKey, { value: i.detail ?? '' }) : i.kind === 'field' ? i.detail : i.kind === 'keyword' ? undefined : t(`completion.${i.kind}` as MessageKey),
        })),
      };
    },
    [project, sample, t],
  );
  const nativeSource = useCallback<CompletionSource>(
    (value, caret) => {
      if (!project) return { from: caret, to: caret, items: [] };
      const r = nativeCompletions(project, value, caret, sample);
      return { from: r.from, to: r.to, items: r.items.map((i) => ({ label: i.label, insert: i.insert, detail: i.meaning ? t(`query.meaning.${i.meaning}` as MessageKey, { value: i.detail ?? '' }) : i.detail })) };
    },
    [project, sample, t],
  );

  const switchSide = () => projectId && setEditor(projectId, { side: side === 'sql' ? 'native' : 'sql', text: result.other });

  const applyFix = (d: Diagnostic) => {
    if (!d.pos || !d.fix) return;
    setText(text.slice(0, d.pos.start) + d.fix.text + text.slice(d.pos.end));
  };

  return {
    project,
    side,
    text,
    setText,
    other: result.other,
    diagnostics: result.diagnostics,
    losses: result.losses,
    extras: result.extras,
    missingIndex: result.missingIndex,
    switchSide,
    applyFix,
    nativeLanguage: project ? NATIVE_LANGUAGE[project.engine] : 'js',
    complete: side === 'sql' ? sqlSource : nativeSource,
    hoverFor: (which: EditorSide) => (offset: number) => (project ? (which === 'sql' ? sqlHover(project, which === side ? text : result.other, offset) : nativeHover(project, which === side ? text : result.other, offset)) : undefined),
    signature: (value: string, caret: number) => signatureAt(side === 'sql' ? 'sql' : 'native', value, caret),
  };
};

export type QueryEditorState = ReturnType<typeof useQueryEditor>;

export default useQueryEditor;
