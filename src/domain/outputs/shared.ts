import { isIdentifier } from '../naming';
import type { Collection, Project } from '../types';

export type OutputResult = { code: string; warnings: string[] };

/** Parses a default value written as JSON; plain text becomes a string. */
export const parseLiteral = (text: string | undefined): unknown => {
  if (text === undefined || text.trim() === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/** JavaScript object literal with unquoted keys where possible, the way people write mongosh scripts. */
export const jsLiteral = (value: unknown, indent = 0, step = 2): string => {
  const pad = ' '.repeat(indent + step);
  const end = ' '.repeat(indent);
  if (value instanceof RawJs) return value.code;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const simple = value.every((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v));
    if (simple) {
      const inline = `[${value.map((v) => jsLiteral(v)).join(', ')}]`;
      if (inline.length <= 80) return inline;
    }
    return `[\n${value.map((v) => pad + jsLiteral(v, indent + step, step)).join(',\n')}\n${end}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return '{}';
    return `{\n${entries.map(([k, v]) => `${pad}${isIdentifier(k) ? k : JSON.stringify(k)}: ${jsLiteral(v, indent + step, step)}`).join(',\n')}\n${end}}`;
  }
  return JSON.stringify(value);
};

/** Code inserted as is by `jsLiteral`, such as `ObjectId("...")`. */
export class RawJs {
  constructor(readonly code: string) {}
}

export const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export const rootCollections = (project: Project) => project.collections.filter((c) => c.kind !== 'subcollection' || !c.parentId);

export const childrenOf = (project: Project, collection: Collection) =>
  project.collections.filter((c) => c.kind === 'subcollection' && c.parentId === collection.id);

export const databaseName = (project: Project) => project.databaseName?.trim() || 'app';
