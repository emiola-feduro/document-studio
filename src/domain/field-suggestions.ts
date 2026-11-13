import { t } from '../i18n';
import type { Field } from './types';

/** Default values that fit a field type, written as JSON or as a known expression. */
export const defaultSuggestions = (field: Field): { value: string; label?: string }[] => {
  switch (field.type) {
    case 'string':
      return [{ value: '""', label: t('suggest.emptyText') }];
    case 'enum':
      return (field.enumValues ?? []).map((v) => ({ value: JSON.stringify(v) }));
    case 'int':
    case 'long':
    case 'double':
    case 'decimal':
    case 'number':
      return [{ value: '0' }, { value: '1' }];
    case 'bool':
      return [{ value: 'false' }, { value: 'true' }];
    case 'date':
    case 'timestamp':
      return [{ value: 'now()', label: t('suggest.now') }];
    case 'uuid':
      return [{ value: 'uuid()', label: t('suggest.newUuid') }];
    case 'objectId':
      return [{ value: 'ObjectId()', label: t('suggest.newObjectId') }];
    case 'array':
      return [{ value: '[]', label: t('suggest.emptyArray') }];
    case 'object':
      return [{ value: '{}', label: t('suggest.emptyObject') }];
    case 'null':
      return [{ value: 'null' }];
    default:
      return [];
  }
};

/** Regular expressions offered for text fields. */
export const PATTERN_PRESETS = (): { value: string; label: string }[] => [
  { value: '^[^@\\s]+@[^@\\s]+\\.[a-z]{2,}$', label: t('suggest.email') },
  { value: '^\\+?[0-9 ]{7,15}$', label: t('suggest.phone') },
  { value: '^[0-9]+$', label: t('suggest.digits') },
  { value: '^[A-Z]{3}-[0-9]{4}$', label: t('suggest.code') },
  { value: '^[a-z0-9]+(-[a-z0-9]+)*$', label: t('suggest.slug') },
  { value: '^https?://\\S+$', label: t('suggest.url') },
  { value: '^[0-9]{5}$', label: t('suggest.zip') },
  { value: '^#[0-9a-fA-F]{6}$', label: t('suggest.color') },
];

/** Partial filter expressions for an index, built from the collection's paths. */
export const filterSuggestions = (paths: { path: string; field: Field }[]): { value: string; label?: string }[] => {
  const out: { value: string; label?: string }[] = [];
  for (const { path, field } of paths.slice(0, 12)) {
    const p = path.replace(/\[\]/g, '');
    out.push({ value: `{ "${p}": { "$exists": true } }`, label: t('suggest.exists') });
    if (field.type === 'enum' && field.enumValues?.[0]) out.push({ value: `{ "${p}": ${JSON.stringify(field.enumValues[0])} }`, label: t('suggest.equals', { value: field.enumValues[0] }) });
    if (['int', 'long', 'double', 'decimal', 'number'].includes(field.type)) out.push({ value: `{ "${p}": { "$gt": 0 } }`, label: t('suggest.positive') });
    if (field.type === 'bool') out.push({ value: `{ "${p}": true }`, label: t('suggest.onlyTrue') });
    if (field.nullable) out.push({ value: `{ "${p}": { "$type": "${field.type === 'date' ? 'date' : 'string'}" } }`, label: t('suggest.notNull') });
  }
  return out;
};
