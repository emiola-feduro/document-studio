import useT from '../../../hooks/ui/use-t';
import { addCollection } from '../../../lib/actions';
import useUiStore from '../../../stores/use-ui-store';
import Button from '../button/button';

const DocCanvasEmpty = () => {
  const t = useT();
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
      <div className="pointer-events-auto max-w-sm rounded-theme border-(length:--bw) border-line bg-surface p-6 text-center shadow-theme">
        <h2 className="text-[1.2em] font-semibold">{t('canvas.empty')}</h2>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={() => addCollection({ x: 0, y: 0 })}>
            {t('canvas.newCollection')}
          </Button>
          <Button onClick={() => useUiStore.getState().openImport('documents')}>{t('canvas.importDocuments')}</Button>
          <Button onClick={() => useUiStore.getState().setNewProjectOpen(true, 'random')}>{t('canvas.randomModel')}</Button>
        </div>
      </div>
    </div>
  );
};

export default DocCanvasEmpty;
