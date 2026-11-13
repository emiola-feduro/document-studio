import PanelsFloatingBar from '../../layout/panels-menu/panels-floating-bar';
import DocCanvas from '../../ui/doc-canvas/doc-canvas';

/** Center area once the project is loaded. */
const Workspace = () => (
  <main className="relative min-h-0 min-w-0">
    <DocCanvas />
    <PanelsFloatingBar />
  </main>
);

export default Workspace;
