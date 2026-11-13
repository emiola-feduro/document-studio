import { strToU8, zipSync } from 'fflate';
import { useCallback } from 'react';
import { couchBulkDocs, documentsEjson, documentsJson, documentsNdjson, firestoreImport, mongoshInsertMany, type DocExportFormat } from '../../domain/documents';
import { t } from '../../i18n';
import { downloadBlob, downloadText, slug } from '../../lib/project-file';
import useProjectStore from '../../stores/use-project-store';
import useUiStore from '../../stores/use-ui-store';

/** Downloads the sample documents in the format each engine imports. */
const useDocumentsExport = () =>
  useCallback((format: DocExportFormat) => {
    const current = useProjectStore.getState().project;
    const { notify } = useUiStore.getState();
    if (!current) return;
    const project = current;
    const total = Object.values(project.documents ?? {}).reduce((n, d) => n + d.length, 0);
    if (total === 0) {
      notify(t('docs.nothingToExport'), 'error');
      return;
    }
    const base = slug(project.name);
    const zip = (files: Record<string, string>, name: string) => {
      const data = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]));
      downloadBlob(name, new Blob([zipSync(data)], { type: 'application/zip' }));
    };
    const perCollection = (render: (c: (typeof project.collections)[number]) => string, ext: string) =>
      Object.fromEntries(project.collections.filter((c) => project.documents?.[c.id]?.length).map((c) => [`${slug(c.name)}.${ext}`, render(c)]));
    switch (format) {
      case 'json':
        zip(perCollection((c) => documentsJson(project, c), 'json'), `${base}-documents-json.zip`);
        break;
      case 'ndjson':
        zip(perCollection((c) => documentsNdjson(project, c, project.engine === 'mongodb'), 'ndjson'), `${base}-documents-ndjson.zip`);
        break;
      case 'ejson':
        zip(perCollection((c) => documentsEjson(project, c), 'json'), `${base}-documents-ejson.zip`);
        break;
      case 'mongosh':
        downloadText(`${base}-insert.mongodb.js`, mongoshInsertMany(project), 'text/javascript');
        break;
      case 'bulkDocs':
        downloadText(`${base}-bulk-docs.json`, couchBulkDocs(project), 'application/json');
        break;
      case 'firestore':
        zip(firestoreImport(project), `${base}-firestore-import.zip`);
        break;
    }
    notify(t('docs.exported'));
  }, []);

export default useDocumentsExport;
