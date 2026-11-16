import type { RefObject } from 'react';
import type { Diagnostic } from '../../../domain/query/ir';
import useT from '../../../hooks/ui/use-t';
import Button from '../button/button';
import Pill from '../pill/pill';

type QueryEditorProblemsProps = {
  diagnostics: Diagnostic[];
  /** The text the positions refer to. */
  text: string;
  areaRef: RefObject<HTMLTextAreaElement>;
  onFix: (d: Diagnostic) => void;
};

const tone = { error: 'danger', warning: 'warning', info: 'neutral' } as const;
const label = { error: 'common.error', warning: 'common.warning', info: 'common.tip' } as const;

const lineCol = (text: string, offset: number) => {
  const before = text.slice(0, offset);
  return { line: before.split('\n').length, column: offset - before.lastIndexOf('\n') };
};

/** Problems of the query with their line and column; a click puts the cursor there, a fix replaces the name. */
const QueryEditorProblems = ({ diagnostics, text, areaRef, onFix }: QueryEditorProblemsProps) => {
  const t = useT();
  const goTo = (d: Diagnostic) => {
    const area = areaRef.current;
    if (!area || !d.pos) return;
    area.focus();
    area.setSelectionRange(d.pos.start, d.pos.end);
  };

  return (
    <section className="max-h-48 shrink-0 overflow-y-auto border-t border-line bg-surface px-4 py-2" aria-label={t('queryEditor.problems')}>
      <h3 className="mb-1 font-semibold">{diagnostics.length ? t('queryEditor.problemsCount', { count: diagnostics.length }) : t('queryEditor.problems')}</h3>
      {diagnostics.length === 0 && <p className="text-success">{t('queryEditor.noProblems')}</p>}
      <ul className="space-y-1">
        {diagnostics.map((d, i) => {
          const at = d.pos ? lineCol(text, d.pos.start) : undefined;
          return (
            <li key={`${d.message}-${i}`} className="flex flex-wrap items-start gap-2">
              <Pill tone={tone[d.severity]}>{t(label[d.severity])}</Pill>
              <span className="min-w-48 flex-1">{d.message}</span>
              {at && (
                <Button size="sm" variant="ghost" onClick={() => goTo(d)}>
                  {t('queryEditor.lineCol', at)}
                </Button>
              )}
              {d.fix && (
                <Button size="sm" onClick={() => onFix(d)}>
                  {d.fix.label}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default QueryEditorProblems;
