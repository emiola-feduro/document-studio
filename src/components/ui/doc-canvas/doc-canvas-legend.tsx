import useHoverDismiss from '../../../hooks/ui/use-hover-dismiss';
import useT from '../../../hooks/ui/use-t';

const DocCanvasLegend = () => {
  const t = useT();
  const disclosure = useHoverDismiss<HTMLDetailsElement>();
  const rows: [string, string][] = [
    ['UQ', t('legend.unique')],
    ['IX', t('legend.indexed')],
    ['?', t('legend.nullable')],
    ['||', t('legend.exactlyOne')],
    ['o|', t('legend.zeroOrOne')],
    ['o<', t('legend.zeroOrMany')],
    ['◆', t('legend.embed')],
    ['- -', t('legend.subcollection')],
  ];

  return (
    <details
      {...disclosure}
      className="absolute bottom-3 left-14 z-10 rounded-theme border-(length:--bw) border-line bg-surface/95 text-[12px] shadow-theme backdrop-blur-sm"
    >
      <summary className="cursor-pointer px-3 py-1.5 font-medium select-none">{t('legend.title')}</summary>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 px-3 pb-2.5">
        <dt className="font-bold">{t('legend.boldSample')}</dt>
        <dd>{t('legend.required')}</dd>
        <dt className="font-semibold text-fk">{t('legend.refSample')}</dt>
        <dd>{t('legend.reference')}</dd>
        <dt>
          <span aria-hidden className="inline-block h-3.5 w-0.5 bg-accent align-middle" />
        </dt>
        <dd>{t('legend.embedded')}</dd>
        {rows.map(([symbol, label]) => (
          <div key={symbol} className="contents">
            <dt className="font-semibold">{symbol}</dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
};

export default DocCanvasLegend;
