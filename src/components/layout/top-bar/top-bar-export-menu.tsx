import useT from '../../../hooks/ui/use-t';
import useImportProject from '../../../hooks/data/use-import-project';
import type { Project } from '../../../domain/types';
import { downloadText, serializeProject, slug } from '../../../lib/project-file';
import useProjectStore from '../../../stores/use-project-store';
import Button from '../../ui/button/button';
import Menu from '../../ui/menu/menu';

const withProject = (fn: (project: Project) => void) => () => {
  const project = useProjectStore.getState().project;
  if (project) fn(project);
};

const TopBarExportMenu = () => {
  const t = useT();
  const importProject = useImportProject();

  return (
    <Menu
      trigger={({ open, toggle }) => (
        <Button size="sm" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
          {t('export.button')}
        </Button>
      )}
      items={[
        {
          label: t('export.projectJson'),
          onSelect: withProject((p) => downloadText(`${slug(p.name)}.ds.json`, serializeProject(p), 'application/json')),
        },
        { label: t('export.importJson'), onSelect: importProject },
      ]}
    />
  );
};

export default TopBarExportMenu;
