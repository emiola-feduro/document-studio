import useExportImage from '../../../hooks/canvas/use-export-image';
import useDocumentsExport from '../../../hooks/data/use-documents-export';
import useImportProject from '../../../hooks/data/use-import-project';
import useT from '../../../hooks/ui/use-t';
import type { Project } from '../../../domain/types';
import { downloadText, serializeProject, slug } from '../../../lib/project-file';
import useProjectStore from '../../../stores/use-project-store';
import useUiStore from '../../../stores/use-ui-store';
import Button from '../../ui/button/button';
import Menu from '../../ui/menu/menu';
import type { MenuItem } from '../../ui/menu/menu-list';

const withProject = (fn: (project: Project) => void) => () => {
  const project = useProjectStore.getState().project;
  if (project) fn(project);
};

const TopBarExportMenu = () => {
  const t = useT();
  const exportImage = useExportImage();
  const importProject = useImportProject();
  const exportDocuments = useDocumentsExport();
  const engine = useProjectStore((s) => s.project?.engine ?? 'mongodb');
  const ui = useUiStore.getState;

  const documentItems: MenuItem[] = [
    { label: t('export.docsJson'), onSelect: () => exportDocuments('json'), separatorBefore: true },
    { label: t('export.docsNdjson'), onSelect: () => exportDocuments('ndjson') },
    ...(engine === 'mongodb'
      ? [
          { label: t('export.docsEjson'), onSelect: () => exportDocuments('ejson') },
          { label: t('export.docsMongosh'), onSelect: () => exportDocuments('mongosh') },
        ]
      : []),
    ...(engine === 'couchdb' ? [{ label: t('export.docsBulk'), onSelect: () => exportDocuments('bulkDocs') }] : []),
    ...(engine === 'firestore' ? [{ label: t('export.docsFirestore'), onSelect: () => exportDocuments('firestore') }] : []),
  ];

  return (
    <Menu
      trigger={({ open, toggle }) => (
        <Button size="sm" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
          {t('export.button')}
        </Button>
      )}
      items={[
        { label: t('export.png'), onSelect: () => void exportImage('png') },
        { label: t('export.svg'), onSelect: () => void exportImage('svg') },
        { label: t('export.copyPng'), onSelect: () => void exportImage('copy-png') },
        { label: t('agentExport.menu'), onSelect: () => ui().openAgentExport(), separatorBefore: true },
        { label: t('openapi.menu'), onSelect: () => ui().setOpenApiExportOpen(true) },
        ...documentItems,
        {
          label: t('export.projectJson'),
          onSelect: withProject((p) => downloadText(`${slug(p.name)}.ds.json`, serializeProject(p), 'application/json')),
          separatorBefore: true,
        },
        { label: t('export.importJson'), onSelect: importProject },
        { label: t('export.importDocuments'), onSelect: () => ui().openImport('documents') },
        { label: t('export.importSchema'), onSelect: () => ui().openImport('auto') },
        ...(engine === 'firestore' ? [{ label: t('export.importIndexes'), onSelect: () => ui().openImport('firestoreIndexes') }] : []),
      ]}
    />
  );
};

export default TopBarExportMenu;
