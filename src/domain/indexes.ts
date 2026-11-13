import { toMongoPath } from './paths';
import type { DocIndex } from './types';

/** MongoDB's own naming: `email_1`, `clienteId_1_fecha_-1`, `$**_1`. */
export const suggestIndexName = (keys: DocIndex['keys'], wildcard = false) => {
  if (wildcard) return keys.length && keys[0].path ? `${toMongoPath(keys[0].path)}.$**_1` : '$**_1';
  return keys.filter((k) => k.path).map((k) => `${toMongoPath(k.path)}_${k.order}`).join('_') || 'index';
};

export const indexName = (index: DocIndex) => (index.nameIsCustom && index.name.trim() ? index.name : suggestIndexName(index.keys, index.wildcard));

/** Key document as MongoDB writes it. */
export const mongoKeys = (index: DocIndex): Record<string, number | string> => {
  if (index.wildcard) {
    const base = index.keys[0]?.path ? `${toMongoPath(index.keys[0].path)}.$**` : '$**';
    return { [base]: 1 };
  }
  return Object.fromEntries(index.keys.filter((k) => k.path).map((k) => [toMongoPath(k.path), k.order]));
};
