import { t } from '../i18n';
import { isEngine } from '../domain/engines';
import { uid } from '../domain/model';
import type { Project } from '../domain/types';

const FORMAT = 'document-studio';
const VERSION = 1;

export const serializeProject = (project: Project) =>
  JSON.stringify({ format: FORMAT, version: VERSION, project }, null, 2);

/** Parses an exported file. Always returns a project with a fresh id so imports never overwrite. */
export const parseProjectFile = (text: string): Project => {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(t('file.invalidJson'));
  }
  const wrapper = data as { format?: string; project?: Project };
  const project = wrapper?.format === FORMAT ? wrapper.project : (data as Project);
  if (
    !project ||
    typeof project.name !== 'string' ||
    !Array.isArray(project.collections) ||
    !Array.isArray(project.relationships) ||
    !isEngine(project.engine)
  ) {
    throw new Error(t('file.notAProject'));
  }
  const now = Date.now();
  const imported: Project = {
    ...project,
    id: uid(),
    createdAt: now,
    updatedAt: now,
    collections: project.collections.map((c) => ({ ...c, fields: c.fields ?? [], indexes: c.indexes ?? [], options: c.options ?? {} })),
    documents: project.documents && typeof project.documents === 'object' ? project.documents : {},
  };
  return imported;
};

export const downloadText = (filename: string, text: string, mime: string) => {
  const blob = new Blob([text], { type: mime });
  downloadBlob(filename, blob);
};

export const downloadBlob = (filename: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const downloadDataUrl = (filename: string, dataUrl: string) => {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
};

export const slug = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'project';
