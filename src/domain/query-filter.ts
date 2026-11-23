import type { QueryPath } from './query-builder';
import type { EngineId, Field, Project } from './types';

/**
 * Suggestions for a filter written as MongoDB JSON (also used for Mango and translated for
 * Firestore). What fits depends on where the cursor is: a field path where a key goes, values and
 * operators for the type after `"path":`, operators inside the object of a field, and after a
 * complete condition the next condition, another alternative of $or, or closing the brackets.
 * Every suggestion is the new text before the cursor, so the result is always valid JSON once closed.
 * $and and $or open on a line of their own, and each engine gets the negative conditions it has:
 * $ne, $nin, $not, $exists: false and null in MongoDB and Mango, != and not-in in Firestore.
 */

export type FilterMeaning =
  | 'equals'
  | 'oneOf'
  | 'greater'
  | 'range'
  | 'containsCi'
  | 'startsWith'
  | 'emailDomain'
  | 'exists'
  | 'isNull'
  | 'isTrue'
  | 'isFalse'
  | 'dateFrom'
  | 'dateRange'
  | 'before'
  | 'size'
  | 'all'
  | 'elemMatch'
  | 'containsValue'
  | 'id'
  | 'sampleId'
  | 'notEquals'
  | 'notOneOf'
  | 'notContains'
  | 'outsideRange'
  | 'notExists'
  | 'missing'
  | 'not'
  | 'enumValue'
  | 'number'
  | 'text'
  | 'date'
  | 'nextValue'
  | 'field'
  | 'and'
  | 'or'
  | 'next'
  | 'nextAlternative'
  | 'close';

/** Suggestions that negate; a partial index filter leaves them out because MongoDB does not accept them there. */
export const NEGATIVE_MEANINGS = new Set<FilterMeaning>(['notEquals', 'notOneOf', 'notContains', 'outsideRange', 'notExists', 'missing', 'not']);

export type FilterCompletion = { value: string; display: string; meaning: FilterMeaning; detail?: string };

type Operand = { text: string; meaning: FilterMeaning; detail?: string; op?: string };

const NUMBERS: Field['type'][] = ['int', 'long', 'double', 'decimal', 'number'];

const year = () => new Date().getFullYear();

const dateText = (engine: EngineId, y: number) => (engine === 'couchdb' ? `"${y}-01-01"` : `{ "$date": "${y}-01-01T00:00:00Z" }`);

/** An id value; with the id of a real sample document when there is one. */
const idOperand = (engine: EngineId, field: Field, id: string | undefined): Operand => {
  const text = engine === 'mongodb' && field.type === 'objectId' ? `{ "$oid": "${id ?? '000000000000000000000000'}" }` : `"${id ?? '<id>'}"`;
  return id ? { text, meaning: 'sampleId', detail: id } : { text, meaning: 'id' };
};

/** Plain values of a field's type, for the right side of a comparison: $eq, $ne, $gt, inside $in. */
export const valuesFor = (engine: EngineId, field: Field, sample: string, id?: string): Operand[] => {
  const type = field.type;
  if (type === 'enum') return (field.enumValues ?? []).slice(0, 6).map((v) => ({ text: JSON.stringify(v), meaning: 'enumValue', detail: v }));
  if (type === 'bool') return [{ text: 'true', meaning: 'isTrue' }, { text: 'false', meaning: 'isFalse' }];
  if (NUMBERS.includes(type)) return [{ text: '1', meaning: 'number' }, { text: '0', meaning: 'number' }];
  if (type === 'string' || type === 'uuid') return [{ text: JSON.stringify(sample), meaning: 'text' }];
  if (type === 'date' || type === 'timestamp') return [{ text: dateText(engine, year()), meaning: 'date' }];
  if (type === 'objectId' || type === 'reference') return [idOperand(engine, field, id)];
  if (type === 'array' && field.items && field.items.type !== 'object' && field.items.type !== 'array') return valuesFor(engine, field.items, sample, id);
  return [];
};

/** Values and operator objects that fit a field, most useful first: the positive ones, then the negative ones. */
export const operandsFor = (engine: EngineId, field: Field, sample: string, name = field.name, id?: string): Operand[] => {
  const firestore = engine === 'firestore';
  const ops: Operand[] = [];
  const type = field.type;
  const values = field.enumValues ?? [];
  if (type === 'enum') {
    for (const v of values.slice(0, 4)) ops.push({ text: JSON.stringify(v), meaning: 'equals', detail: v });
    if (values.length > 1) ops.push({ text: `{ "$in": ${JSON.stringify(values.slice(0, 2))} }`, meaning: 'oneOf', op: '$in' });
  } else if (type === 'bool') {
    ops.push({ text: 'true', meaning: 'isTrue' }, { text: 'false', meaning: 'isFalse' });
  } else if (NUMBERS.includes(type)) {
    ops.push(
      { text: '1', meaning: 'equals', detail: '1' },
      { text: '{ "$gt": 0 }', meaning: 'greater', op: '$gt' },
      { text: '{ "$gte": 1, "$lte": 100 }', meaning: 'range', op: '$gte' },
      { text: '{ "$in": [1, 2, 3] }', meaning: 'oneOf', op: '$in' },
    );
  } else if (type === 'string' || type === 'uuid') {
    ops.push({ text: JSON.stringify(sample), meaning: 'equals', detail: sample });
    if (!firestore) {
      if (/mail|correo|courriel/i.test(name)) ops.push({ text: '{ "$regex": "@example\\\\.com$" }', meaning: 'emailDomain', op: '$regex' });
      ops.push({ text: engine === 'couchdb' ? `{ "$regex": "(?i)${sample}" }` : `{ "$regex": "${sample}", "$options": "i" }`, meaning: 'containsCi', op: '$regex' });
      ops.push({ text: `{ "$regex": "^${sample}" }`, meaning: 'startsWith', op: '$regex' });
    }
    ops.push({ text: `{ "$in": ["${sample}", "${sample}2"] }`, meaning: 'oneOf', op: '$in' });
  } else if (type === 'date' || type === 'timestamp') {
    const from = dateText(engine, year());
    const to = dateText(engine, year() + 1);
    ops.push({ text: `{ "$gte": ${from} }`, meaning: 'dateFrom', op: '$gte' }, { text: `{ "$gte": ${from}, "$lt": ${to} }`, meaning: 'dateRange', op: '$gte' });
    ops.push({ text: `{ "$lt": ${from} }`, meaning: 'before', op: '$lt' });
  } else if (type === 'objectId' || type === 'reference') {
    ops.push(idOperand(engine, field, id));
  } else if (type === 'array') {
    const item = field.items;
    if (item?.type === 'object' && item.children?.length) {
      if (!firestore) {
        const child = item.children[0];
        const first = operandsFor(engine, child, sample)[0];
        if (first) ops.push({ text: `{ "$elemMatch": { "${child.name}": ${first.text} } }`, meaning: 'elemMatch', op: '$elemMatch' });
      }
    } else if (item) {
      const first = operandsFor(engine, item, sample, name, id)[0];
      if (first && !first.text.startsWith('{ "$')) ops.push({ text: first.text, meaning: 'containsValue', detail: first.detail });
      if (first && !firestore) ops.push({ text: `{ "$all": [${first.text}] }`, meaning: 'all', op: '$all' });
      if (first && firestore) ops.push({ text: `{ "$in": [${first.text}] }`, meaning: 'oneOf', op: '$in' });
      // In MongoDB $ne on an array means that no element is that value. Mango and Firestore compare the whole array.
      if (first && engine === 'mongodb') ops.push({ text: `{ "$ne": ${first.text} }`, meaning: 'notContains', detail: first.detail, op: '$ne' });
    }
    if (!firestore) ops.push({ text: '{ "$size": 0 }', meaning: 'size', op: '$size' });
  }

  // Negative conditions. Firestore has only != and not-in.
  const scalar = type !== 'array' && type !== 'object' && type !== 'bool' ? valuesFor(engine, field, sample, id)[0] : undefined;
  if (scalar) {
    ops.push({ text: `{ "$ne": ${scalar.text} }`, meaning: 'notEquals', detail: scalar.detail ?? scalar.text, op: '$ne' });
    const list =
      type === 'enum' ? (values.length > 1 ? JSON.stringify(values.slice(0, 2)) : undefined) : NUMBERS.includes(type) ? '[1, 2, 3]' : type === 'string' || type === 'uuid' ? `["${sample}", "${sample}2"]` : undefined;
    if (list) ops.push({ text: `{ "$nin": ${list} }`, meaning: 'notOneOf', op: '$nin' });
  }
  if ((type === 'string' || type === 'uuid') && !firestore) {
    const regex = engine === 'couchdb' ? `{ "$regex": "(?i)${sample}" }` : `{ "$regex": "${sample}", "$options": "i" }`;
    ops.push({ text: `{ "$not": ${regex} }`, meaning: 'notContains', detail: sample, op: '$not' });
  }

  if (!field.required || field.nullable || type === 'object') ops.push({ text: '{ "$exists": true }', meaning: 'exists', op: '$exists' });
  if (!field.required && !firestore) ops.push({ text: '{ "$exists": false }', meaning: 'notExists', op: '$exists' });
  if (field.nullable) ops.push({ text: 'null', meaning: 'isNull' });
  // In MongoDB { field: null } also finds the documents without the field.
  else if (!field.required && engine === 'mongodb') ops.push({ text: 'null', meaning: 'missing' });
  return ops;
};

/** Values after an operator: a list for $in and $nin, true or false for $exists, the type's values for the rest. */
const valuesAfter = (engine: EngineId, op: string, field: Field, sample: string, id?: string): Operand[] => {
  if (op === '$in' || op === '$nin' || op === '$all') {
    const items = valuesFor(engine, field, sample, id).slice(0, 2);
    const meaning: FilterMeaning = op === '$nin' ? 'notOneOf' : op === '$all' ? 'all' : 'oneOf';
    return items.length ? [{ text: `[${items.map((v) => v.text).join(', ')}]`, meaning }] : [];
  }
  if (op === '$exists') return [{ text: 'true', meaning: 'exists' }, { text: 'false', meaning: 'notExists' }];
  if (op === '$size') return [{ text: '0', meaning: 'size' }, { text: '1', meaning: 'number' }];
  if (op === '$regex') return [{ text: JSON.stringify(sample), meaning: 'containsCi' }, { text: JSON.stringify(`^${sample}`), meaning: 'startsWith' }];
  if (op === '$options') return [{ text: '"i"', meaning: 'containsCi' }];
  if (op === '$not' || op === '$elemMatch') return [];
  return valuesFor(engine, field, sample, id);
};

/** Out of a range is two conditions: below the low end or above the high end. */
const outsideRange = (engine: EngineId, path: string, field: Field): Operand | undefined => {
  if (engine === 'firestore') return undefined;
  const bounds = NUMBERS.includes(field.type) ? ['1', '100'] : field.type === 'date' || field.type === 'timestamp' ? [dateText(engine, year()), dateText(engine, year() + 1)] : undefined;
  if (!bounds) return undefined;
  return { text: `"$or": [{ "${path}": { "$lt": ${bounds[0]} } }, { "${path}": { "$gt": ${bounds[1]} } }]`, meaning: 'outsideRange' };
};

/** Operators that can go inside $not: the positive ones. */
const NEGATABLE = new Set(['$regex', '$gt', '$gte', '$lt', '$lte', '$in', '$eq', '$size', '$all', '$elemMatch']);

/** Id of the first sample document of a collection, as text. */
export const firstDocumentId = (project: Project, collectionId: string | undefined) => {
  const doc = collectionId ? project.documents?.[collectionId]?.[0] : undefined;
  try {
    const id = doc ? (JSON.parse(doc.json) as { _id?: unknown })._id : undefined;
    return typeof id === 'string' ? id : id && typeof id === 'object' && '$oid' in id ? String((id as { $oid: unknown }).$oid) : undefined;
  } catch {
    return undefined;
  }
};

/** The id to suggest for a path: a sample document of the collection it references, or of the base collection for _id. */
export const sampleIdOf = (project: Project, rootId: string | undefined) => (path: string, field: Field) => {
  const target = (field.type === 'array' ? field.items : field)?.reference?.collectionId;
  if (target) return firstDocumentId(project, target);
  return path === '_id' ? firstDocumentId(project, rootId) : undefined;
};

/** `at` is where the bracket opened, to tell whether its content spans several lines. */
type Frame = { bracket: '{' | '['; owner: string | null; at: number };

type Scan = {
  stack: Frame[];
  /** What the next token is: a key, a colon, a value, or something after a complete value. */
  state: 'key' | 'colon' | 'value' | 'after';
  inString: boolean;
  stringIsKey: boolean;
  partial: string;
  /** Key of the pair being written. */
  key: string | null;
  /** The cursor is in a key written without quotes. */
  bare: boolean;
};

/** Inside an array the elements belong to the key that opened it ($or, $in). */
const arrayOwner = (stack: Frame[]) => (stack.at(-1)?.bracket === '[' ? stack.at(-1)!.owner : null);

/** Reads the JSON before the cursor far enough to know what can come next. */
const scan = (text: string): Scan => {
  const s: Scan = { stack: [], state: 'value', inString: false, stringIsKey: false, partial: '', key: null, bare: false };
  let escape = false;
  let quote = '"';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (s.inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === quote) {
        s.inString = false;
        if (s.stringIsKey) {
          s.key = s.partial;
          s.state = 'colon';
        } else s.state = 'after';
        continue;
      }
      if (!escape || ch === '\\') s.partial += ch;
      continue;
    }
    // A key without quotes, as JavaScript allows: { estado: "pagado" }.
    if (s.state === 'key' && /[A-Za-z_$]/.test(ch)) {
      const word = /^[\w$.]*/.exec(text.slice(i))![0];
      const rest = text.slice(i + word.length);
      if (!rest.trim()) {
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
    if (ch === '"' || ch === "'") {
      s.inString = true;
      quote = ch;
      s.stringIsKey = s.state === 'key';
      s.partial = '';
    } else if (ch === '{') {
      s.stack.push({ bracket: '{', owner: s.state === 'value' ? s.key : null, at: i });
      s.state = 'key';
    } else if (ch === '[') {
      s.stack.push({ bracket: '[', owner: s.key, at: i });
      s.state = 'value';
    } else if (ch === '}' || ch === ']') {
      s.stack.pop();
      s.state = 'after';
      s.key = arrayOwner(s.stack);
    } else if (ch === ':') s.state = 'value';
    else if (ch === ',') {
      s.state = s.stack.at(-1)?.bracket === '{' ? 'key' : 'value';
      s.key = arrayOwner(s.stack);
    } else if (ch === '(' || ch === ')') {
      // ObjectId("...") and ISODate("...") are values.
      if (ch === ')') s.state = 'after';
    } else if (!/\s/.test(ch)) s.state = 'after';
    if (!s.inString && s.state === 'key') s.key = null;
  }
  return s;
};

const LOGICAL = new Set(['$and', '$or', '$nor']);

const indent = (depth: number) => '  '.repeat(depth);

/** Closes every open bracket; a bracket whose content spans lines closes on a line of its own. */
const closing = (stack: Frame[], text: string) =>
  stack
    .map((f, depth) => {
      const multiline = text.slice(f.at).includes('\n');
      if (f.bracket === '{') return multiline ? `\n${indent(depth)}}` : ' }';
      return multiline ? `\n${indent(depth)}]` : ']';
    })
    .reverse()
    .join('');

/** The text without the key being written and its colon, to put a whole condition in its place. */
const withoutKey = (text: string) => text.trimEnd().replace(/(?:"[^"]*"|'[^']*'|[\w$.]+)\s*(?::\s*)?$/, '');

const matches = (path: string, partial: string) => {
  if (!partial) return true;
  const lower = partial.toLowerCase();
  const p = path.toLowerCase();
  return p !== lower && (p.startsWith(lower) || p.split('.').pop()!.startsWith(lower));
};

/** Id of a sample document for a path, so id values are real ones. */
export type SampleIdOf = (path: string, field: Field) => string | undefined;

export const filterCompletions = (engine: EngineId, paths: QueryPath[], before: string, after: string, sample: string, idOf?: SampleIdOf): FilterCompletion[] => {
  let byPath = new Map(paths.map((p) => [p.path, p]));
  const operandsOf = (path: string) => {
    const entry = byPath.get(path);
    return entry ? operandsFor(engine, entry.field, sample, entry.field.name, idOf?.(path, entry.field)) : [];
  };
  /** Operand items for the value of a path, with "out of range" as a whole condition in place of the pair. */
  const valueItems = (path: string, head: string, display: (o: Operand) => string): FilterCompletion[] => {
    const items: FilterCompletion[] = operandsOf(path).map((o) => ({ value: `${head}${o.text}`, display: display(o), meaning: o.meaning, detail: o.detail }));
    const entry = byPath.get(path);
    const range = entry && outsideRange(engine, path, entry.field);
    if (range) items.push({ value: `${withoutKey(head)}${range.text}`, display: range.text, meaning: range.meaning });
    return items;
  };

  // Empty field: one typical condition per path, and $or with two of them.
  if (!before.trim()) {
    if (after.trim()) return [];
    const items: FilterCompletion[] = [];
    // _id is rarely what a filter starts with, so it stays for when it is typed.
    const starters = paths.filter((p) => p.path !== '_id');
    for (const p of starters) {
      const first = operandsOf(p.path)[0];
      if (first) items.push({ value: `{ "${p.path}": ${first.text} }`, display: `{ "${p.path}": ${first.text} }`, meaning: first.meaning, detail: first.detail });
    }
    const two = starters.filter((p) => operandsOf(p.path).length).slice(0, 2);
    if (two.length === 2) {
      const [a, b] = two.map((p) => `{ "${p.path}": ${operandsOf(p.path)[0].text} }`);
      items.splice(1, 0, { value: `{\n  "$or": [\n    ${a},\n    ${b}\n  ]\n}`, display: '$or', meaning: 'or' });
    }
    return items;
  }

  const s = scan(before);
  // Inside "items": { "$elemMatch": { ... } } the paths are the ones of an element of items.
  let elem = -1;
  s.stack.forEach((f, i) => {
    if (f.owner === '$elemMatch') elem = i;
  });
  const arrayPath = elem > 0 ? s.stack[elem - 1].owner : null;
  if (arrayPath && !arrayPath.startsWith('$')) {
    const prefix = `${arrayPath}.`;
    paths = paths.filter((p) => p.path.startsWith(prefix)).map((p) => ({ ...p, path: p.path.slice(prefix.length) }));
    byPath = new Map(paths.map((p) => [p.path, p]));
    const outer = idOf;
    idOf = outer && ((path, field) => outer(prefix + path, field));
  }
  const top = s.stack.at(-1);
  const owner = top?.owner ?? null;
  // Inside "$not": { ... } the operators belong to the field that owns the $not.
  const negated = owner === '$not';
  const holder = negated ? (s.stack.at(-2)?.owner ?? null) : owner;
  const fieldOwner = holder && !holder.startsWith('$') ? holder : null;
  const fieldOf = (path: string | null) => (path ? byPath.get(path)?.field : undefined);

  // Writing a key: field paths, or the operators of the field that owns this object.
  if ((s.inString && s.stringIsKey) || s.state === 'key' || s.bare) {
    const partial = s.inString || s.bare ? s.partial : '';
    const head = s.bare ? before.slice(0, before.length - partial.length) : s.inString ? before.slice(0, before.length - partial.length - 1) : before.replace(/\s*$/, ' ');
    if (fieldOwner) {
      const items: FilterCompletion[] = operandsOf(fieldOwner)
        .filter((o) => o.op && matches(o.op, partial) && (!negated || NEGATABLE.has(o.op)))
        .map((o) => {
          const inner = o.text.replace(/^\{\s*/, '').replace(/\s*\}$/, '');
          return { value: `${head}${inner}`, display: inner, meaning: negated ? 'not' : o.meaning, detail: negated ? inner : o.detail };
        });
      // $not negates the operator written inside it; Firestore has no $not.
      const type = fieldOf(fieldOwner)?.type;
      if (!negated && engine !== 'firestore' && type !== 'bool' && type !== 'object' && matches('$not', partial)) {
        items.push({ value: `${head}"$not": { "`, display: '$not: { ... }', meaning: 'not' });
      }
      return items;
    }
    const fields: FilterCompletion[] = paths.filter((p) => matches(p.path, partial)).map((p) => ({ value: `${head}"${p.path}": `, display: p.path, meaning: 'field' as const }));
    // $or and $and go first: the list is short and a long model would push them out of sight.
    // They open on a line of their own, with each alternative on the next one.
    const line = `${head.trimEnd()}\n${indent(s.stack.length)}`;
    const logical: FilterCompletion[] = [
      { value: `${line}"$or": [\n${indent(s.stack.length + 1)}{ "`, display: '$or', meaning: 'or' as const },
      { value: `${line}"$and": [\n${indent(s.stack.length + 1)}{ "`, display: '$and', meaning: 'and' as const },
    ].filter((o) => o.display.startsWith(partial) || !partial);
    return [...logical, ...fields];
  }

  // Right after a key: a colon and the values that fit.
  if (s.state === 'colon' && s.key) {
    const head = before.trimEnd();
    if (LOGICAL.has(s.key)) return [{ value: `${head}: [\n${indent(s.stack.length + 1)}{ "`, display: `${s.key}: [`, meaning: s.key === '$and' ? 'and' : 'or' }];
    const key = s.key;
    if (key.startsWith('$') && fieldOwner) {
      const field = fieldOf(fieldOwner)!;
      return valuesAfter(engine, key, field, sample, idOf?.(fieldOwner, field)).map((o) => ({ value: `${head}: ${o.text}`, display: `${key}: ${o.text}`, meaning: o.meaning, detail: o.detail ?? o.text }));
    }
    return valueItems(key, `${head}: `, (o) => `"${key}": ${o.text}`);
  }

  if (s.state === 'value' && !s.inString) {
    const head = before.replace(/\s*$/, ' ');
    // An element of $or or $and: a condition object.
    if (top?.bracket === '[' && owner && LOGICAL.has(owner)) {
      return paths.map((p) => ({ value: `${head}{ "${p.path}": `, display: `{ "${p.path}": ...`, meaning: 'field' as const }));
    }
    if (s.key && !s.key.startsWith('$')) return valueItems(s.key, head, (o) => o.text);
    // After an operator, values of the field's type: "$ne": "pagado", "$gt": 1, "$in": [...].
    if (s.key && fieldOwner && top?.bracket === '{') {
      const field = fieldOf(fieldOwner)!;
      return valuesAfter(engine, s.key, field, sample, idOf?.(fieldOwner, field)).map((o) => ({ value: `${head}${o.text}`, display: o.text, meaning: o.meaning, detail: o.detail ?? o.text }));
    }
    // An element of $in, $nin or $all: one value of the field's type.
    const listField = top?.bracket === '[' && owner && !LOGICAL.has(owner) ? s.stack.at(-2)?.owner : undefined;
    const field = listField ? fieldOf(listField) : undefined;
    if (field && listField) {
      const start = before.trimEnd().endsWith('[') ? before.trimEnd() : head;
      return valuesFor(engine, field, sample, idOf?.(listField, field)).map((o) => ({ value: `${start}${o.text}`, display: o.text, meaning: o.meaning, detail: o.detail ?? o.text }));
    }
    return [];
  }

  // After a complete value: the next condition, another alternative, or closing everything.
  if (s.state === 'after' && !s.inString && s.stack.length) {
    const head = before.trimEnd();
    const items: FilterCompletion[] = [];
    if (top?.bracket === '{') items.push({ value: `${head}, "`, display: ', "...', meaning: 'next' });
    if (top?.bracket === '[' && top.owner && !LOGICAL.has(top.owner)) items.push({ value: `${head}, `, display: ', ...', meaning: 'nextValue' });
    const parent = s.stack.at(-2);
    if (top?.bracket === '{' && parent?.bracket === '[' && parent.owner && LOGICAL.has(parent.owner)) {
      // On a line of its own when the alternatives already are, as $or and $and open them.
      const gap = before.slice(parent.at).includes('\n') ? `\n${indent(s.stack.length - 1)}` : ' ';
      items.push({ value: `${head} },${gap}{ "`, display: '}, { ...', meaning: 'nextAlternative' });
    }
    const close = closing(s.stack, before);
    if (!after.trim()) items.push({ value: `${head}${close}`, display: close.replace(/\s+/g, ' ').trim(), meaning: 'close' });
    return items;
  }
  return [];
};
