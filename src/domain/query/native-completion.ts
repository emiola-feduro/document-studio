import { discriminator } from '../outputs/couchdb';
import { queryPaths, type QueryPath } from '../query-builder';
import { filterCompletions, firstDocumentId } from '../query-filter';
import type { Collection, Field, Project } from '../types';
import { columnsOf } from './sql-completion';

/**
 * Autocomplete for a native query: in mongosh, collections after `db.`, methods, pipeline stages,
 * paths as keys and `$` operators by type inside a filter, and from, localField and foreignField in
 * $lookup with the model's reference first; in Mango, the body keys and the selector; in the
 * Firestore SDK, collections, constraints, paths, operators and values that fit each field.
 */

export type NativeItem = { label: string; insert: string; detail?: string; meaning?: string };
export type NativeCompletionResult = { from: number; to: number; items: NativeItem[] };

type Frame = { ch: '{' | '[' | '('; index: number; owner: string | null; callee: string | null; commas: number };

type JsScan = {
  frames: Frame[];
  state: 'key' | 'colon' | 'value' | 'after';
  key: string | null;
  inString: boolean;
  stringStart: number;
  stringIsKey: boolean;
  partial: string;
  bare: boolean;
  comment: boolean;
};

/** Reads JavaScript or JSON before the cursor far enough to know the context. */
export const scanJs = (text: string): JsScan => {
  const s: JsScan = { frames: [], state: 'value', key: null, inString: false, stringStart: 0, stringIsKey: false, partial: '', bare: false, comment: false };
  let quote = '"';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (s.inString) {
      if (ch === '\\') {
        s.partial += text[i + 1] ?? '';
        i += 1;
      } else if (ch === quote) {
        s.inString = false;
        if (s.stringIsKey) {
          s.key = s.partial;
          s.state = 'colon';
        } else s.state = 'after';
      } else s.partial += ch;
      continue;
    }
    if (text.startsWith('//', i)) {
      const end = text.indexOf('\n', i);
      if (end < 0) {
        s.comment = true;
        return s;
      }
      i = end;
      continue;
    }
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) {
        s.comment = true;
        return s;
      }
      i = end + 1;
      continue;
    }
    const top = s.frames.at(-1);
    if (top?.ch === '{' && s.state === 'key' && /[A-Za-z_$]/.test(ch)) {
      const word = /^[\w$.]*/.exec(text.slice(i))![0];
      const rest = text.slice(i + word.length);
      if (!rest.length) {
        s.bare = true;
        s.partial = word;
        return s;
      }
      i += word.length - 1;
      if (/^\s*:/.test(rest)) {
        s.key = word;
        s.state = 'colon';
      } else s.state = 'after';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      s.inString = true;
      quote = ch;
      s.stringStart = i;
      s.stringIsKey = s.state === 'key' && top?.ch === '{';
      s.partial = '';
    } else if (ch === '{' || ch === '[') {
      s.frames.push({ ch, index: i, owner: s.state === 'value' || s.state === 'colon' ? s.key : null, callee: null, commas: 0 });
      s.state = ch === '{' ? 'key' : 'value';
      s.key = null;
    } else if (ch === '(') {
      const callee = /([A-Za-z_$][\w$.]*)\s*$/.exec(text.slice(0, i))?.[1] ?? null;
      s.frames.push({ ch, index: i, owner: null, callee, commas: 0 });
      s.state = 'value';
    } else if (ch === '}' || ch === ']' || ch === ')') {
      s.frames.pop();
      s.state = 'after';
      const parent = s.frames.at(-1);
      s.key = parent?.ch === '{' ? null : s.key;
    } else if (ch === ':') s.state = 'value';
    else if (ch === ',') {
      if (top) top.commas += 1;
      s.state = top?.ch === '{' ? 'key' : 'value';
      s.key = null;
    } else if (!/\s/.test(ch)) s.state = 'after';
  }
  return s;
};

const STAGES: { name: string; body: string }[] = [
  { name: '$match', body: '{ $match: { ' },
  { name: '$lookup', body: '{ $lookup: { from: "' },
  { name: '$unwind', body: '{ $unwind: "$' },
  { name: '$group', body: '{ $group: { _id: "$' },
  { name: '$project', body: '{ $project: { ' },
  { name: '$sort', body: '{ $sort: { ' },
  { name: '$skip', body: '{ $skip: ' },
  { name: '$limit', body: '{ $limit: ' },
  { name: '$count', body: '{ $count: "' },
];

const pathsWithJoins = (project: Project, root: Collection, text: string): QueryPath[] => {
  const paths = queryPaths(root);
  for (const m of text.matchAll(/\$lookup\s*:\s*\{[^}]*?from\s*:\s*["']([^"']+)["'][^}]*?as\s*:\s*["']([^"']+)["']/g)) {
    const joined = project.collections.find((c) => c.name === m[1]);
    if (joined) paths.push(...queryPaths(joined, m[2]));
  }
  return paths;
};

/** Mongo shell values instead of Extended JSON: ObjectId(...) and ISODate(...). */
const shellValues = (text: string, sampleId?: string) =>
  text.replace(/\{ "\$oid": "([^"]*)" \}/g, (_m, id) => `ObjectId("${sampleId ?? id}")`).replace(/\{ "\$date": "([^"]*)" \}/g, 'ISODate("$1")');

/** Every reference of the model as a ready $lookup with its $unwind. */
const lookups = (project: Project, root: Collection) =>
  columnsOf(root).flatMap(({ path, field }) => {
    const target = (field.type === 'array' ? field.items : field)?.reference?.collectionId;
    const coll = target && project.collections.find((c) => c.id === target);
    if (!coll) return [];
    const as = path.split('.').pop()!.replace(/(_ids?|Ids?)$/, '') || coll.name;
    return [{ label: `$lookup ${coll.name}`, insert: `{ $lookup: { from: "${coll.name}", localField: "${path}", foreignField: "_id", as: "${as}" } },\n  { $unwind: "$${as}" }`, detail: path }];
  });

const sampleIdFor = (project: Project, field: Field | undefined) => firstDocumentId(project, (field?.type === 'array' ? field.items : field)?.reference?.collectionId);

const filterItems = (project: Project, paths: QueryPath[], before: string, after: string, rootIndex: number, sample: string, engine: Project['engine'], from: number) => {
  const head = before.slice(0, rootIndex);
  const items = filterCompletions(engine, paths, before.slice(rootIndex), after, sample);
  return items.map((i) => {
    const field = paths.find((p) => i.value.includes(`"${p.path}"`))?.field;
    const value = engine === 'mongodb' ? shellValues(i.value, sampleIdFor(project, field)) : i.value;
    return { label: engine === 'mongodb' ? shellValues(i.display, sampleIdFor(project, field)) : i.display, insert: (head + value).slice(from), meaning: i.meaning, detail: i.detail };
  });
};

const rankByPartial = (items: NativeItem[], partial: string) => {
  if (!partial) return items.slice(0, 40);
  const p = partial.toLowerCase();
  return items.filter((i) => i.label.toLowerCase().includes(p) && i.label.toLowerCase() !== p).sort((a, b) => Number(!a.label.toLowerCase().startsWith(p)) - Number(!b.label.toLowerCase().startsWith(p))).slice(0, 40);
};

/* MongoDB */

const mongoCompletions = (project: Project, text: string, caret: number, sample: string): NativeCompletionResult => {
  const before = text.slice(0, caret);
  const after = text.slice(caret);
  const none = { from: caret, to: caret, items: [] };
  const s = scanJs(before);
  if (s.comment) return none;
  const word = /[\w$]*$/.exec(before)![0];
  const wordFrom = caret - word.length;
  const to = caret + (/^[\w$]*/.exec(after)?.[0].length ?? 0);
  const rootName = /\bdb\s*\.\s*(?:getCollection\(\s*["']([^"']+)["']\s*\)|([A-Za-z_$][\w$]*))\s*\./.exec(text);
  const root = project.collections.find((c) => c.name === (rootName?.[1] ?? rootName?.[2]));

  if (!s.frames.length && !s.inString) {
    if (/\bdb\s*\.\s*[\w$]*$/.test(before)) {
      return { from: wordFrom, to, items: rankByPartial(project.collections.map((c) => ({ label: c.name, insert: `${c.name}.`, detail: `${c.fields.length}` })), word) };
    }
    if (/\bdb\s*\.\s*(?:[\w$]+|getCollection\([^)]*\))\s*\.\s*[\w$]*$/.test(before)) {
      const methods = [
        { label: 'find()', insert: 'find({ ' },
        { label: 'aggregate([])', insert: 'aggregate([\n  ' },
        { label: 'countDocuments()', insert: 'countDocuments({ ' },
      ];
      return { from: wordFrom, to, items: rankByPartial(methods, word) };
    }
    if (/\)\s*\.\s*[\w$]*$/.test(before)) {
      const cursor = [
        { label: 'sort()', insert: 'sort({ ' },
        { label: 'skip()', insert: 'skip(' },
        { label: 'limit()', insert: 'limit(' },
      ];
      return { from: wordFrom, to, items: rankByPartial(cursor, word) };
    }
    if (!before.trim() || /^\s*db?$/.test(before)) {
      const items = project.collections.flatMap((c) => [
        { label: `db.${c.name}.find()`, insert: `db.${c.name}.find({ ` },
        { label: `db.${c.name}.aggregate()`, insert: `db.${c.name}.aggregate([\n  ` },
      ]);
      return { from: caret - before.trimStart().length, to, items: rankByPartial(items, before.trim()) };
    }
    return none;
  }
  if (!root) return none;
  const paths = pathsWithJoins(project, root, text);

  // Inside a string: collections after from, paths after localField and foreignField, "$path" in expressions.
  if (s.inString) {
    const from = s.stringStart + 1;
    const frame = s.frames.at(-1);
    const quoted = (label: string) => ({ label, insert: label });
    if (s.key === 'from' && frame?.owner === '$lookup') return { from, to: caret, items: rankByPartial(project.collections.map((c) => quoted(c.name)), s.partial) };
    if ((s.key === 'localField' || s.key === 'foreignField') && frame?.owner === '$lookup') return { from, to: caret, items: rankByPartial(paths.map((p) => quoted(p.path)), s.partial) };
    if (s.partial.startsWith('$')) return { from, to: caret, items: rankByPartial(paths.map((p) => ({ label: `$${p.path}`, insert: `$${p.path}` })), s.partial) };
    if (!s.stringIsKey) return none;
  }

  // The filter of find or $match: the filter completions, with mongosh values.
  for (let k = s.frames.length - 1; k >= 0; k -= 1) {
    const f = s.frames[k];
    const parent = s.frames[k - 1];
    const isFilter = f.ch === '{' && ((parent?.ch === '(' && /(^|\.)(find|findOne|countDocuments)$/.test(parent.callee ?? '') && parent.commas === 0) || f.owner === '$match');
    if (!isFilter) continue;
    // Only when no other object (a $lookup inside $match does not exist) sits in between.
    const from = s.inString ? s.stringStart : s.bare ? caret - s.partial.length : caret;
    const items = filterItems(project, paths, before, after, f.index, sample, 'mongodb', from);
    return { from, to: s.inString ? caret : to, items };
  }

  const frame = s.frames.at(-1)!;
  const parent = s.frames.at(-2);
  const keyFrom = s.bare ? caret - s.partial.length : s.inString ? s.stringStart : caret;
  const partial = s.bare || s.inString ? s.partial : '';
  const keyPosition = frame.ch === '{' && (s.state === 'key' || s.bare || (s.inString && s.stringIsKey));

  // A stage of the pipeline.
  if (frame.ch === '[' && parent?.ch === '(' && /aggregate$/.test(parent.callee ?? '') && s.state === 'value') {
    return { from: caret, to: caret, items: [...lookups(project, root), ...STAGES.map((st) => ({ label: st.name, insert: st.body }))] };
  }
  if (keyPosition && parent?.ch === '[' && /aggregate$/.test(s.frames.at(-3)?.callee ?? '')) {
    return { from: keyFrom, to, items: rankByPartial(STAGES.map((st) => ({ label: st.name, insert: st.body.replace(/^\{ /, '') })), partial) };
  }
  if (keyPosition && frame.owner === '$lookup') {
    const keys = ['from', 'localField', 'foreignField', 'as'].map((k) => ({ label: k, insert: `${k}: "` }));
    return { from: keyFrom, to, items: rankByPartial(keys, partial) };
  }
  if (keyPosition && frame.owner === '$group') {
    const items: NativeItem[] = [{ label: '_id', insert: '_id: "$' }, { label: 'count: { $sum: 1 }', insert: 'count: { $sum: 1 }' }];
    for (const p of paths.filter((x) => ['int', 'long', 'double', 'decimal', 'number'].includes(x.field.type))) {
      for (const acc of ['sum', 'avg', 'min', 'max']) items.push({ label: `${acc}_${p.path.replace(/\./g, '_')}: { $${acc}: "$${p.path}" }`, insert: `${acc}_${p.path.replace(/\./g, '_')}: { $${acc}: "$${p.path}" }` });
    }
    return { from: keyFrom, to, items: rankByPartial(items, partial) };
  }
  const projection = frame.ch === '{' && (frame.owner === '$project' || frame.owner === '$sort' || (parent?.ch === '(' && /(^|\.)find$/.test(parent.callee ?? '') && parent.commas === 1) || (parent?.ch === '(' && /sort$/.test(parent.callee ?? '')));
  if (keyPosition && projection) {
    return { from: keyFrom, to, items: rankByPartial(paths.map((p) => ({ label: p.path, insert: `${/^[A-Za-z_$][\w$]*$/.test(p.path) ? p.path : `"${p.path}"`}: 1` })), partial) };
  }
  return none;
};

/* CouchDB */

const couchCompletions = (project: Project, text: string, caret: number, sample: string): NativeCompletionResult => {
  const before = text.slice(0, caret);
  const after = text.slice(caret);
  const s = scanJs(before);
  const none = { from: caret, to: caret, items: [] };
  if (!s.frames.length) return before.trim() ? none : { from: caret, to: caret, items: [{ label: '{ "selector": { ... } }', insert: '{\n  "selector": {\n    "' }] };
  const typeValue = /"(\w+)"\s*:\s*"([^"]+)"/g;
  let root: Collection | undefined;
  for (const m of text.matchAll(typeValue)) root ??= project.collections.find((c) => discriminator(c).field === m[1] && discriminator(c).value === m[2]);
  const frame = s.frames.at(-1)!;
  const keyFrom = s.inString ? s.stringStart : caret;
  const keyPosition = frame.ch === '{' && (s.state === 'key' || (s.inString && s.stringIsKey));
  if (s.frames.length === 1 && keyPosition) {
    const keys = [
      { label: 'selector', insert: '"selector": {\n    "' },
      { label: 'fields', insert: '"fields": ["' },
      { label: 'sort', insert: '"sort": [{ "' },
      { label: 'limit', insert: '"limit": 25' },
      { label: 'skip', insert: '"skip": 0' },
    ];
    return { from: keyFrom, to: s.inString ? caret : caret, items: rankByPartial(keys, s.inString ? s.partial : '') };
  }
  const selector = s.frames.find((f) => f.ch === '{' && f.owner === 'selector');
  if (selector) {
    // Without a type yet, the first thing a Mango selector needs is which "collection" it reads.
    if (!root && keyPosition && s.frames.at(-1) === selector) {
      return { from: keyFrom, to: caret, items: project.collections.map((c) => ({ label: `${discriminator(c).field}: ${discriminator(c).value}`, insert: `"${discriminator(c).field}": "${discriminator(c).value}"` })) };
    }
    if (!root) return none;
    const from = s.inString ? s.stringStart : caret;
    return { from, to: s.inString ? caret : caret, items: filterItems(project, queryPaths(root), before, after, selector.index, sample, 'couchdb', from) };
  }
  if (!root) return none;
  const owner = s.frames.find((f) => f.ch === '[')?.owner;
  if (owner === 'fields') {
    const from = s.inString ? s.stringStart : caret;
    return { from, to: caret, items: rankByPartial(queryPaths(root).map((p) => ({ label: p.path, insert: `"${p.path}"` })), s.inString ? s.partial : '') };
  }
  if (owner === 'sort' && keyPosition) {
    return { from: keyFrom, to: caret, items: rankByPartial(queryPaths(root).flatMap((p) => [{ label: `${p.path} asc`, insert: `"${p.path}": "asc"` }, { label: `${p.path} desc`, insert: `"${p.path}": "desc"` }]), s.inString ? s.partial : '') };
  }
  return none;
};

/* Firestore */

const FS_OPS = ['==', '!=', '<', '<=', '>', '>=', 'in', 'not-in', 'array-contains', 'array-contains-any'];

const firestoreValues = (project: Project, field: Field | undefined, sample: string): NativeItem[] => {
  if (!field) return [];
  const holder = field.type === 'array' && field.items ? field.items : field;
  if (holder.type === 'enum') return (holder.enumValues ?? []).map((v) => ({ label: JSON.stringify(v), insert: JSON.stringify(v) }));
  if (holder.type === 'bool') return ['true', 'false'].map((v) => ({ label: v, insert: v }));
  if (['int', 'long', 'double', 'decimal', 'number'].includes(holder.type)) return [{ label: '0', insert: '0' }, { label: '1', insert: '1' }];
  if (holder.type === 'date' || holder.type === 'timestamp') {
    const v = `Timestamp.fromDate(new Date("${new Date().getFullYear()}-01-01"))`;
    return [{ label: v, insert: v }];
  }
  if (holder.type === 'reference') {
    const target = project.collections.find((c) => c.id === holder.reference?.collectionId);
    const v = `doc(db, "${target?.name ?? 'collection'}", "${sampleIdFor(project, field) ?? 'id'}")`;
    return [{ label: v, insert: v }];
  }
  return [{ label: JSON.stringify(sample), insert: JSON.stringify(sample) }, { label: 'null', insert: 'null' }];
};

const firestoreCompletions = (project: Project, text: string, caret: number, sample: string): NativeCompletionResult => {
  const before = text.slice(0, caret);
  const s = scanJs(before);
  const none = { from: caret, to: caret, items: [] };
  if (s.comment) return none;
  const start = (c: Collection) => `query(\n  ${c.kind === 'subcollection' ? 'collectionGroup' : 'collection'}(db, "${c.name}"),\n  `;
  if (!s.frames.length) return before.trim() ? none : { from: caret, to: caret, items: project.collections.map((c) => ({ label: `query(collection(db, "${c.name}"))`, insert: start(c) })) };
  const frame = s.frames.at(-1)!;
  const rootName = /collection(?:Group)?\(\s*db\s*,\s*"([^"]+)"/.exec(text)?.[1];
  const root = project.collections.find((c) => c.name === rootName);
  const paths = root ? columnsOf(root) : [];
  const from = s.inString ? s.stringStart + 1 : caret;
  const callee = frame.callee ?? '';
  if (frame.ch !== '(') return none;
  if (/^collection(Group)?$/.test(callee) && s.inString) return { from, to: caret, items: rankByPartial(project.collections.map((c) => ({ label: c.name, insert: c.name })), s.partial) };
  if ((callee === 'where' || callee === 'orderBy') && frame.commas === 0 && s.inString) {
    return { from, to: caret, items: rankByPartial(paths.map((p) => ({ label: p.path, insert: p.path, detail: p.field.type })), s.partial) };
  }
  const fieldName = /where\(\s*"([^"]+)"/.exec(before.slice(frame.index - 5))?.[1];
  const field = paths.find((p) => p.path === fieldName)?.field;
  if (callee === 'where' && frame.commas === 1) {
    const ops = field?.type === 'array' ? ['array-contains', 'array-contains-any'] : FS_OPS.filter((o) => !o.startsWith('array'));
    const items = ops.map((o) => ({ label: o, insert: s.inString ? o : `"${o}"` }));
    return { from: s.inString ? from : caret, to: caret, items: rankByPartial(items, s.inString ? s.partial : '') };
  }
  if (callee === 'where' && frame.commas === 2 && !s.inString) return { from: caret, to: caret, items: firestoreValues(project, field, sample) };
  if (callee === 'orderBy' && frame.commas === 1) return { from: s.inString ? from : caret, to: caret, items: ['asc', 'desc'].map((d) => ({ label: d, insert: s.inString ? d : `"${d}"` })) };
  if ((callee === 'query' || callee === 'and' || callee === 'or') && s.state === 'value' && !s.inString) {
    const items = callee === 'query' && frame.commas === 0 && root === undefined
      ? project.collections.map((c) => ({ label: `collection(db, "${c.name}")`, insert: `collection(db, "${c.name}"),\n  ` }))
      : [
          { label: 'where()', insert: 'where("' },
          ...(callee === 'query' ? [{ label: 'orderBy()', insert: 'orderBy("' }, { label: 'limit()', insert: 'limit(' }] : []),
          { label: 'or()', insert: 'or(\n    where("' },
          { label: 'and()', insert: 'and(\n    where("' },
        ];
    return { from: caret, to: caret, items };
  }
  return none;
};

export const nativeCompletions = (project: Project, text: string, caret: number, sample: string): NativeCompletionResult =>
  project.engine === 'mongodb' ? mongoCompletions(project, text, caret, sample) : project.engine === 'couchdb' ? couchCompletions(project, text, caret, sample) : firestoreCompletions(project, text, caret, sample);

