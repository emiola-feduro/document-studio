import useT from '../../../hooks/ui/use-t';
import { addCollection } from '../../../lib/actions';
import Button from '../button/button';

const DocCanvasEmpty = () => {
  const t = useT();
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
      <div className="pointer-events-auto max-w-sm rounded-theme border-(length:--bw) border-line bg-surface p-6 text-center shadow-theme">
        <h2 className="text-[1.2em] font-semibold">{t('canvas.empty')}</h2>
        <Button variant="primary" className="mt-4" onClick={() => addCollection({ x: 0, y: 0 })}>
          {t('canvas.newCollection')}
        </Button>
      </div>
    </div>
  );
};

export default DocCanvasEmpty;
