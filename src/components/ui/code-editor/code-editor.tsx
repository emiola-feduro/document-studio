import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { HoverInfo } from '../../../domain/query/hover';
import useCodeCompletion, { type CompletionSource } from '../../../hooks/ui/use-code-completion';
import useT from '../../../hooks/ui/use-t';
import { TOKEN_CLASS, tokenizeJs, tokenizeSql, type CodeToken } from '../../../lib/code-highlight';

export type EditorMark = { start: number; end: number; severity: 'error' | 'warning' | 'info' };

type CodeEditorProps = {
  id: string;
  label: string;
  value: string;
  onChange?: (value: string) => void;
  language: 'sql' | 'js' | 'json' | 'ts';
  readOnly?: boolean;
  placeholder?: string;
  /** What fits at the cursor; without it there is no autocomplete. */
  complete?: CompletionSource;
  /** Ranges underlined with a wavy line. */
  marks?: EditorMark[];
  /** Information about the name at an offset, shown on hover and with Ctrl+K Ctrl+I. */
  hover?: (offset: number) => HoverInfo | undefined;
  /** One line of help for the call the cursor is in. */
  signature?: (text: string, caret: number) => string | undefined;
  areaRef?: RefObject<HTMLTextAreaElement>;
};

// Same box for the text area and the colored copy under it, so the letters line up.
const BOX = 'p-4 font-code text-[13px] leading-relaxed whitespace-pre [tab-size:2]';

const MARK_CLASS: Record<EditorMark['severity'], string> = {
  error: 'underline decoration-wavy decoration-danger underline-offset-4',
  warning: 'underline decoration-wavy decoration-warning underline-offset-4',
  info: 'underline decoration-dotted decoration-muted underline-offset-4',
};

type Segment = { text: string; kind: CodeToken['kind']; mark?: EditorMark['severity'] };

/** Tokens cut where the marks start and end, so each piece knows whether it is underlined. */
const segments = (tokens: CodeToken[], marks: EditorMark[], length: number): Segment[] => {
  // An empty range (something missing at the end) underlines the character before it.
  const ranges = marks.map((m) => (m.start === m.end ? { ...m, start: Math.max(0, m.start - 1), end: Math.max(1, m.end) } : m)).map((m) => ({ ...m, end: Math.min(m.end, length) }));
  const cuts = new Set<number>();
  for (const r of ranges) {
    cuts.add(r.start);
    cuts.add(r.end);
  }
  const out: Segment[] = [];
  let offset = 0;
  for (const token of tokens) {
    let start = 0;
    const points = [...cuts].filter((c) => c > offset && c < offset + token.text.length).sort((a, b) => a - b);
    for (const point of [...points, offset + token.text.length]) {
      const text = token.text.slice(start, point - offset);
      const at = offset + start;
      const mark = ranges.filter((r) => r.start <= at && at < r.end).sort((a, b) => (a.severity === 'error' ? -1 : b.severity === 'error' ? 1 : 0))[0];
      if (text) out.push({ text, kind: token.kind, mark: mark?.severity });
      start = point - offset;
    }
    offset += token.text.length;
  }
  return out;
};

let canvas: HTMLCanvasElement | undefined;

/** Text offset under a point of the text area (the text never wraps). */
const offsetAt = (area: HTMLTextAreaElement, x: number, y: number) => {
  const style = getComputedStyle(area);
  const rect = area.getBoundingClientRect();
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.6;
  const lines = area.value.split('\n');
  const line = Math.floor((y - rect.top - parseFloat(style.paddingTop) + area.scrollTop) / lineHeight);
  if (line < 0 || line >= lines.length) return undefined;
  canvas ??= document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const target = x - rect.left - parseFloat(style.paddingLeft) + area.scrollLeft;
  const text = lines[line];
  let col = 0;
  while (col < text.length && context.measureText(text.slice(0, col + 1)).width <= target) col += 1;
  if (col >= text.length && context.measureText(text).width < target) return undefined;
  return lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0) + col;
};

/** Screen point of a text offset, for the hover opened from the keyboard. */
const pointOf = (area: HTMLTextAreaElement, offset: number) => {
  const style = getComputedStyle(area);
  const rect = area.getBoundingClientRect();
  const before = area.value.slice(0, offset);
  const lineIndex = before.split('\n').length - 1;
  canvas ??= document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (context) context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const width = context?.measureText(before.slice(before.lastIndexOf('\n') + 1)).width ?? 0;
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.6;
  return { x: rect.left + parseFloat(style.paddingLeft) + width - area.scrollLeft, y: rect.top + parseFloat(style.paddingTop) + (lineIndex + 1) * lineHeight - area.scrollTop };
};

/**
 * Code text area with highlighting, autocomplete, wavy underlines for problems, information over
 * names and one line of help for the current call. The typed text is transparent and a colored copy
 * sits underneath, scrolled together; caret, selection and keys are the browser's own.
 */
const CodeEditor = ({ id, label, value, onChange, language, readOnly = false, placeholder, complete, marks = [], hover, signature, areaRef: externalRef }: CodeEditorProps) => {
  const t = useT();
  const backdropRef = useRef<HTMLPreElement>(null);
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const areaRef = externalRef ?? ownRef;
  const listRef = useRef<HTMLUListElement>(null);
  const [tip, setTip] = useState<{ info: HoverInfo; x: number; y: number } | null>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const chord = useRef(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const tokens = useMemo(() => (language === 'sql' ? tokenizeSql(value) : tokenizeJs(value)), [value, language]);
  const pieces = useMemo(() => segments(tokens, marks, value.length), [tokens, marks, value.length]);
  const completion = useCodeCompletion(areaRef, listRef, value, (v) => onChange?.(v), readOnly ? undefined : complete);
  const listId = `${id}-suggestions`;
  const help = caret !== null && signature ? signature(value, caret) : undefined;

  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  const showAt = (offset: number, x: number, y: number) => {
    const info = hover?.(offset);
    setTip(info ? { info, x, y } : null);
  };

  return (
    <div className="relative h-full min-h-40 overflow-hidden bg-bg focus-within:ring-2 focus-within:ring-accent focus-within:ring-inset">
      <pre ref={backdropRef} aria-hidden className={`pointer-events-none absolute inset-0 m-0 overflow-hidden ${BOX}`}>
        <code className="font-[inherit]">
          {pieces.map((p, index) => (
            <span key={index} className={`${TOKEN_CLASS[p.kind]} ${p.mark ? MARK_CLASS[p.mark] : ''}`}>
              {p.text}
            </span>
          ))}
          {'\n '}
        </code>
      </pre>
      <textarea
        ref={areaRef}
        id={id}
        aria-label={label}
        readOnly={readOnly}
        role={complete && !readOnly ? 'combobox' : undefined}
        aria-autocomplete={complete && !readOnly ? 'list' : undefined}
        aria-expanded={complete && !readOnly ? completion.open : undefined}
        aria-controls={complete && !readOnly ? listId : undefined}
        aria-activedescendant={completion.open ? `${listId}-${completion.active}` : undefined}
        className={`absolute inset-0 h-full w-full resize-none overflow-auto border-0 bg-transparent text-transparent caret-fg outline-none selection:bg-accent/25 placeholder:text-muted ${BOX}`}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        wrap="off"
        onChange={(e) => {
          if (readOnly) return;
          const native = e.nativeEvent as InputEvent;
          onChange?.(e.target.value);
          setCaret(e.target.selectionStart);
          completion.onInput(e.target.value, e.target.selectionStart, Boolean(native.inputType?.startsWith('insert')));
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          setTip(null);
          // Ctrl+K then Ctrl+I shows the information of the name at the caret.
          if (e.ctrlKey && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            chord.current = true;
            return;
          }
          if (chord.current && e.ctrlKey && e.key.toLowerCase() === 'i') {
            e.preventDefault();
            chord.current = false;
            const offset = e.currentTarget.selectionStart;
            const point = pointOf(e.currentTarget, offset);
            showAt(offset, point.x, point.y);
            return;
          }
          chord.current = false;
          completion.onKeyDown(e);
        }}
        onBlur={() => {
          completion.close();
          setCaret(null);
        }}
        onClick={completion.close}
        onMouseMove={(e) => {
          if (!hover) return;
          clearTimeout(hoverTimer.current);
          const area = e.currentTarget;
          const { clientX, clientY } = e;
          hoverTimer.current = setTimeout(() => {
            const offset = offsetAt(area, clientX, clientY);
            if (offset === undefined) setTip(null);
            else showAt(offset, clientX, clientY + 16);
          }, 350);
        }}
        onMouseLeave={() => {
          clearTimeout(hoverTimer.current);
          setTip(null);
        }}
        onScroll={(e) => {
          const backdrop = backdropRef.current;
          if (backdrop) {
            backdrop.scrollTop = e.currentTarget.scrollTop;
            backdrop.scrollLeft = e.currentTarget.scrollLeft;
          }
          if (completion.open) completion.onScroll();
        }}
      />
      {help && !completion.open && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 truncate border-t border-line bg-surface px-3 py-1 font-code text-[12px] text-muted" role="status">
          {help}
        </div>
      )}
      {tip &&
        createPortal(
          <div
            role="tooltip"
            style={{ top: Math.min(tip.y, window.innerHeight - 120), left: Math.min(tip.x, window.innerWidth - 340) }}
            className="pointer-events-none fixed z-50 max-w-80 rounded-[calc(var(--radius)*0.75)] border-(length:--bw) border-line bg-surface px-3 py-2 text-[0.92em] text-fg shadow-theme"
          >
            <p className="font-code font-semibold">{tip.info.title}</p>
            {tip.info.lines.map((line) => (
              <p key={line} className="text-muted">
                {line}
              </p>
            ))}
          </div>,
          document.body,
        )}
      {completion.open &&
        createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={t('expr.suggestions')}
            style={{
              top: completion.position?.top ?? 0,
              left: completion.position?.left ?? 0,
              maxHeight: completion.position?.maxHeight ?? 280,
              visibility: completion.position ? 'visible' : 'hidden',
            }}
            className="fixed z-50 max-w-[min(36rem,calc(100vw-1rem))] min-w-56 overflow-y-auto rounded-[calc(var(--radius)*0.75)] border-(length:--bw) border-line bg-surface py-1 font-ui text-fg shadow-theme"
          >
            {completion.items.map((item, i) => (
              <li
                key={`${item.label}-${i}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === completion.active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  completion.accept(i);
                }}
                onMouseEnter={() => completion.setActive(i)}
                className={`flex cursor-pointer items-baseline justify-between gap-4 px-2.5 py-1 ${i === completion.active ? 'bg-accent-soft' : ''}`}
              >
                <span className="min-w-0 truncate font-code text-[0.92em]">{item.label}</span>
                {item.detail && <span className="shrink-0 text-[0.82em] text-muted">{item.detail}</span>}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
};

export default CodeEditor;
