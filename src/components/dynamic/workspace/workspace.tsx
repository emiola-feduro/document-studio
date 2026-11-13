import useUiStore from '../../../stores/use-ui-store';
import PanelsFloatingBar from '../../layout/panels-menu/panels-floating-bar';
import DocCanvas from '../../ui/doc-canvas/doc-canvas';
import DocumentsView from '../../ui/documents-view/documents-view';
import SchemaView from '../../ui/schema-view/schema-view';

/** Center area once the project is loaded: diagram, engine output or sample documents. */
const Workspace = () => {
  const view = useUiStore((s) => s.view);

  return (
    <main className="relative min-h-0 min-w-0">
      {/* The canvas stays mounted so image export and fit keep working from other views. */}
      <div className={view === 'diagram' ? 'h-full' : 'hidden'}>
        <DocCanvas />
      </div>
      {view === 'schema' && <SchemaView />}
      {view === 'documents' && <DocumentsView />}
      {view === 'diagram' && <PanelsFloatingBar />}
    </main>
  );
};

export default Workspace;
