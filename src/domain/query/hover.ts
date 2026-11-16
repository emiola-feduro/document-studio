import { t } from '../../i18n';
import { displayType } from '../outputs/json-schema';
import type { Collection, Field, Project } from '../types';
import { scanJs } from './native-completion';
import { collectionRefs, columnsOf } from './sql-completion';

/**
 * What the editor shows over a name: for a collection, how many fields it has; for a field, its
 * type, whether it is required, its description, its enum values and what it references. Also the
 * one-line help for the call or stage the cursor is in (COUNT(, $lookup: {, where(...).
 */

export type HoverInfo = { title: string; lines: string[]; start: number; end: number };

const fieldInfo = (project: Project, collection: Collection, path: string, field: Field, start: number, end: number): HoverInfo => {
  const lines = [`${displayType(project.engine, field)}, ${field.required ? t('hover.required') : t('hover.optional')}${field.nullable ? `, ${t('hover.nullable')}` : ''}`];
  if (field.description) lines.push(field.description);
  const holder = field.type === 'array' ? field.items : field;
  if (holder?.enumValues?.length) lines.push(t('hover.values', { values: holder.enumValues.join(', ') }));
  const target = holder?.reference?.collectionId && project.collections.find((c) => c.id === holder.reference!.collectionId);
  if (target) lines.push(t('hover.references', { collection: target.name }));
  return { title: `${collection.name}.${path}`, lines, start, end };
};

const collectionInfo = (collection: Collection, start: number, end: number): HoverInfo => ({
  title: collection.name,
  lines: [t('hover.fields', { count: columnsOf(collection).length - 1 }), ...(collection.notes ? [collection.notes] : [])],
  start,
  end,
});

/** The dotted name under an offset, with where it starts and ends. */
const nameAt = (text: string, offset: number) => {
  const isName = (c: string | undefined) => Boolean(c && /[\w$.]/.test(c));
  let start = offset;
  let end = offset;
  while (start > 0 && isName(text[start - 1])) start -= 1;
  while (isName(text[end])) end += 1;
  return { name: text.slice(start, end).replace(/^\$/, ''), start, end };
};

export const sqlHover = (project: Project, text: string, offset: number): HoverInfo | undefined => {
  const { name, start, end } = nameAt(text, offset);
  if (!name) return undefined;
  const refs = collectionRefs(text, project);
  const byName = (n: string) => refs.find((r) => (r.alias ?? r.collection.name) === n)?.collection ?? project.collections.find((c) => c.name === n);
  const direct = project.collections.find((c) => c.name === name);
  if (direct) return collectionInfo(direct, start, end);
  const [head, ...rest] = name.split('.');
  const owner = rest.length ? byName(head) : undefined;
  const path = owner ? rest.join('.') : name;
  for (const c of owner ? [owner] : [...refs.map((r) => r.collection), ...project.collections]) {
    const column = columnsOf(c).find((col) => col.path === path);
    if (column) return fieldInfo(project, c, path, column.field, start, end);
  }
  if (!rest.length && byName(name)) return collectionInfo(byName(name)!, start, end);
  return undefined;
};

export const nativeHover = (project: Project, text: string, offset: number): HoverInfo | undefined => {
  const { name, start, end } = nameAt(text, offset);
  if (!name) return undefined;
  const collection = project.collections.find((c) => c.name === name);
  if (collection) return collectionInfo(collection, start, end);
  const rootName =
    /\bdb\s*\.\s*(?:getCollection\(\s*["']([^"']+)["']\s*\)|([A-Za-z_$][\w$]*))/.exec(text) ?? /collection(?:Group)?\(\s*db\s*,\s*"([^"]+)"/.exec(text);
  let root = project.collections.find((c) => c.name === (rootName?.[1] ?? rootName?.[2]));
  if (!root && project.engine === 'couchdb') root = project.collections.find((c) => text.includes(`"${c.name}"`));
  const candidates = root ? [root, ...project.collections.filter((c) => c !== root)] : project.collections;
  for (const c of candidates) {
    const column = columnsOf(c).find((col) => col.path === name);
    if (column) return fieldInfo(project, c, name, column.field, start, end);
  }
  // A path under the alias of a $lookup.
  const [head, ...rest] = name.split('.');
  const joined = new RegExp(`from\\s*:\\s*["']([^"']+)["'][^}]*?as\\s*:\\s*["']${head}["']`).exec(text)?.[1];
  const target = joined && project.collections.find((c) => c.name === joined);
  const column = target && columnsOf(target).find((col) => col.path === rest.join('.'));
  return target && column ? fieldInfo(project, target, rest.join('.'), column.field, start, end) : undefined;
};

/** One line of help for the call or stage the cursor is in. */
export const signatureAt = (language: 'sql' | 'native', text: string, caret: number): string | undefined => {
  const before = text.slice(0, caret);
  if (language === 'sql') {
    let depth = 0;
    for (let i = before.length - 1; i >= 0; i -= 1) {
      if (before[i] === ')') depth += 1;
      else if (before[i] === '(') {
        if (depth === 0) {
          const fn = /([A-Za-z_]+)\s*$/.exec(before.slice(0, i))?.[1]?.toUpperCase();
          if (fn && ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'].includes(fn)) return t(`sig.${fn.toLowerCase()}` as 'sig.count');
          return undefined;
        }
        depth -= 1;
      }
    }
    return undefined;
  }
  const s = scanJs(before);
  for (let k = s.frames.length - 1; k >= 0; k -= 1) {
    const f = s.frames[k];
    if (f.ch === '{' && f.owner && ['$lookup', '$group', '$project', '$sort', '$match', '$unwind'].includes(f.owner)) return t(`sig.${f.owner.slice(1)}` as 'sig.lookup');
    if (f.ch === '(' && f.callee) {
      const name = f.callee.split('.').pop()!;
      if (['find', 'aggregate', 'countDocuments', 'sort', 'where', 'orderBy', 'limit', 'query', 'getAggregateFromServer'].includes(name)) return t(`sig.${name}` as 'sig.find');
    }
  }
  return undefined;
};
