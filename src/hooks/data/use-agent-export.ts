import { zipSync, strToU8 } from 'fflate';
import { useEffect, useState } from 'react';
import { buildModelSpec, toAgentJson, toAgentMarkdown, type AgentExportOptions } from '../../domain/model-spec';
import { primaryOutput } from '../../domain/outputs';
import { t } from '../../i18n';
import { downloadBlob, downloadText, slug } from '../../lib/project-file';
import useProjectStore from '../../stores/use-project-store';
import useUiStore from '../../stores/use-ui-store';

export type AgentFormat = 'markdown' | 'json';
export type AgentScope = 'all' | 'collection' | 'perCollection';

/** Libraries offered as suggestions; any other text works too. */
export const TARGET_SUGGESTIONS = [
  'Mongoose (TypeScript)',
  'Prisma (MongoDB)',
  'Spring Data MongoDB',
  'Motor + Beanie',
  'ODMantic',
  'MongoDB Node.js driver + Zod',
  'Firebase Admin SDK (Node.js)',
  'Firebase JS SDK + TypeScript',
  'FlutterFire (Dart)',
  'Nano (CouchDB)',
  'PouchDB',
  'Couchbase Node.js SDK',
  'TypeScript interfaces + Zod',
  'Pydantic v2',
  'Kotlin data classes',
  'C# MongoDB.Driver',
  'Go mongo-driver',
];

const EXTENSION: Record<AgentFormat, string> = { markdown: 'md', json: 'json' };
const MIME: Record<AgentFormat, string> = { markdown: 'text/markdown', json: 'application/json' };

/** Form state and output of the "export for an AI agent" dialog. */
const useAgentExport = () => {
  const project = useProjectStore((s) => s.project);
  const { open, collectionId: preset } = useUiStore((s) => s.agentExport);
  const closeAgentExport = useUiStore((s) => s.closeAgentExport);
  const [format, setFormat] = useState<AgentFormat>('markdown');
  const [scope, setScope] = useState<AgentScope>('all');
  const [collectionId, setCollectionId] = useState('');
  const [target, setTarget] = useState('');
  const [notes, setNotes] = useState('');
  const [includeScript, setIncludeScript] = useState(false);
  const collections = project?.collections ?? [];

  useEffect(() => {
    if (!open) return;
    setScope(preset ? 'collection' : 'all');
    setCollectionId(preset ?? collections[0]?.id ?? '');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const options = (): AgentExportOptions => ({ target, notes, script: includeScript && project ? primaryOutput(project).code : undefined });
  const render = (ids?: string[]) => {
    const spec = buildModelSpec(project!, ids);
    return format === 'json' ? toAgentJson(spec, options()) : toAgentMarkdown(spec, options());
  };
  const text = () => render(scope === 'collection' ? [collectionId] : undefined);

  const download = async () => {
    if (!project) return;
    const { notify } = useUiStore.getState();
    const base = slug(project.name);
    if (scope === 'perCollection') {
      const files: Record<string, Uint8Array> = {};
      for (const c of collections) files[`${slug(c.name)}.${EXTENSION[format]}`] = strToU8(render([c.id]));
      downloadBlob(`${base}-agent.zip`, new Blob([zipSync(files)], { type: 'application/zip' }));
    } else {
      const name = scope === 'collection' ? `${base}-${slug(collections.find((c) => c.id === collectionId)?.name ?? '')}` : base;
      downloadText(`${name}-agent.${EXTENSION[format]}`, text(), MIME[format]);
    }
    notify(t('agentExport.downloaded'));
    closeAgentExport();
  };

  const copy = async () => {
    const { notify } = useUiStore.getState();
    try {
      await navigator.clipboard.writeText(text());
      notify(t('agentExport.copied'));
    } catch {
      notify(t('agentExport.copyFailed'), 'error');
    }
  };

  return {
    open,
    close: closeAgentExport,
    collections,
    fields: { format, setFormat, scope, setScope, collectionId, setCollectionId, target, setTarget, notes, setNotes, includeScript, setIncludeScript },
    canCopy: scope !== 'perCollection',
    download,
    copy,
  };
};

export default useAgentExport;
