import type { QueryPath } from './query-builder';
import type { EngineId, Field } from './types';

/**
 * Suggestions for a filter written as MongoDB JSON (also used for Mango and translated for
 * Firestore). What fits depends on where the cursor is: a field path where a key goes, values and
 * operators for the type after `"path":`, operators inside the object of a field, and after a
 * complete condition the next condition, another alternative of $or, or closing the brackets.
 * Every suggestion is the new text before the cursor, so the result is always valid JSON once closed.
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
  | 'size'
  | 'all'
  | 'elemMatch'
  | 'containsValue'
  | 'id'
  | 'field'
  | 'and'
  | 'or'
  | 'next'
  | 'nextAlternative'
  | 'close';

export type FilterCompletion = { value: string; display: string; meaning: FilterMeaning; detail?: string };

type Operand = { text: string; meaning: FilterMeaning; detail?: string; op?: string };

const NUMBERS: Field['type'][] = ['int', 'long', 'double', 'decimal', 'number'];

const year = () => new Date().getFullYear();

/** Values and operator objects that fit a field, most useful first. */
export const operandsFor = (engine: EngineId, field: Field, sample: string, name = field.name): Operand[] => {
  const firestore = engine === 'firestore';
  const ops: Operand[] = [];
  const type = field.type;
  if (type === 'enum') {
    const values = field.enumValues ?? [];
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
    const from = engine === 'couchdb' ? `"${year()}-01-01"` : `{ "$date": "${year()}-01-01T00:00:00Z" }`;
    const to = engine === 'couchdb' ? `"${year() + 1}-01-01"` : `{ "$date": "${year() + 1}-01-01T00:00:00Z" }`;
    ops.push({ text: `{ "$gte": ${from} }`, meaning: 'dateFrom', op: '$gte' }, { text: `{ "$gte": ${from}, "$lt": ${to} }`, meaning: 'dateRange', op: '$gte' });
  } else if (type === 'objectId' || type === 'reference') {
    ops.push({ text: engine === 'mongodb' && type === 'objectId' ? '{ "$oid": "000000000000000000000000" }' : '"<id>"', meaning: 'id' });
  } else if (type === 'array') {
    const item = field.items;
    if (item?.type === 'object' && item.children?.length) {
      if (!firestore) {
        const child = item.children[0];
        const first = operandsFor(engine, child, sample)[0];
        if (first) ops.push({ text: `{ "$elemMatch": { "${child.name}": ${first.text} } }`, meaning: 'elemMatch', op: '$elemMatch' });
      }
    } else if (item) {
      const first = operandsFor(engine, item, sample, name)[0];
      if (first && !first.text.startsWith('{ "$')) ops.push({ text: first.text, meaning: 'containsValue', detail: first.detail });
      if (first && !firestore) ops.push({ text: `{ "$all": [${first.text}] }`, meaning: 'all', op: '$all' });
      if (first && firestore) ops.push({ text: `{ "$in": [${first.text}] }`, meaning: 'oneOf', op: '$in' });
    }
    if (!firestore) ops.push({ text: '{ "$size": 0 }', meaning: 'size', op: '$size' });
  }
  if (!field.required || field.nullable || type === 'object') ops.push({ text: '{ "$exists": true }', meaning: 'exists', op: '$exists' });
  if (field.nullable) ops.push({ text: 'null', meaning: 'isNull' });
  return ops;
};

type Frame = { bracket: '{' | '['; owner: string | null };

type Scan = {
  stack: Frame[];
  /** What the next token is: a key, a colon, a value, or something after a complete value. */
  state: 'key' | 'colon' | 'value' | 'after';
  inString: boolean;
  stringIsKey: boolean;
  partial: string;
  /** Key of the pair being written. */
  key: string | null;
};

/** Inside an array the elements belong to the key that opened it ($or, $in). */
const arrayOwner = (stack: Frame[]) => (stack.at(-1)?.bracket === '[' ? stack.at(-1)!.owner : null);

/** Reads the JSON before the cursor far enough to know what can come next. */
const scan = (text: string): Scan => {
  const s: Scan = { stack: [], state: 'value', inString: false, stringIsKey: false, partial: '', key: null };
  let escape = false;
  for (const ch of text) {
    if (s.inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') {
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
    if (ch === '"') {
      s.inString = true;
      s.stringIsKey = s.state === 'key';
      s.partial = '';
    } else if (ch === '{') {
      s.stack.push({ bracket: '{', owner: s.state === 'value' ? s.key : null });
      s.state = 'key';
    } else if (ch === '[') {
      s.stack.push({ bracket: '[', owner: s.key });
      s.state = 'value';
    } else if (ch === '}' || ch === ']') {
      s.stack.pop();
      s.state = 'after';
      s.key = arrayOwner(s.stack);
    } else if (ch === ':') s.state = 'value';
    else if (ch === ',') {
      s.state = s.stack.at(-1)?.bracket === '{' ? 'key' : 'value';
      s.key = arrayOwner(s.stack);
    }
    else if (!/\s/.test(ch)) s.state = 'after';
    if (!s.inString && s.state === 'key') s.key = null;
  }
  return s;
};

const LOGICAL = new Set(['$and', '$or', '$nor']);

const closing = (stack: Frame[]) =>
  stack
    .slice()
    .reverse()
    .map((f) => (f.bracket === '{' ? ' }' : ']'))
    .join('');

const matches = (path: string, partial: string) => {
  if (!partial) return true;
  const lower = partial.toLowerCase();
  const p = path.toLowerCase();
  return p !== lower && (p.startsWith(lower) || p.split('.').pop()!.startsWith(lower));
};

export const filterCompletions = (engine: EngineId, paths: QueryPath[], before: string, after: string, sample: string): FilterCompletion[] => {
  const byPath = new Map(paths.map((p) => [p.path, p]));
  const operandsOf = (path: string) => {
    const entry = byPath.get(path);
    return entry ? operandsFor(engine, entry.field, sample) : [];
  };

  // Empty field: one typical condition per path, and $or with two of them.
  if (!before.trim()) {
    if (after.trim()) return [];
    const items: FilterCompletion[] = [];
    for (const p of paths) {
      const first = operandsOf(p.path)[0];
      if (first) items.push({ value: `{ "${p.path}": ${first.text} }`, display: `{ "${p.path}": ${first.text} }`, meaning: first.meaning, detail: first.detail });
    }
    const two = paths.filter((p) => operandsOf(p.path).length).slice(0, 2);
    if (two.length === 2) {
      const [a, b] = two.map((p) => `{ "${p.path}": ${operandsOf(p.path)[0].text} }`);
      items.splice(1, 0, { value: `{ "$or": [${a}, ${b}] }`, display: '$or', meaning: 'or' });
    }
    return items;
  }

  const s = scan(before);
  const top = s.stack.at(-1);
  const owner = top?.owner ?? null;
  const fieldOwner = owner && !owner.startsWith('$') ? owner : null;

  // Writing a key: field paths, or the operators of the field that owns this object.
  if ((s.inString && s.stringIsKey) || s.state === 'key') {
    const partial = s.inString ? s.partial : '';
    const head = s.inString ? before.slice(0, before.length - partial.length - 1) : before.replace(/\s*$/, ' ');
    if (fieldOwner) {
      return operandsOf(fieldOwner)
        .filter((o) => o.op && matches(o.op, partial.replace(/^\$/, '$')))
        .map((o) => {
          const inner = o.text.replace(/^\{\s*/, '').replace(/\s*\}$/, '');
          return { value: `${head}${inner}`, display: inner, meaning: o.meaning, detail: o.detail };
        });
    }
    const fields: FilterCompletion[] = paths.filter((p) => matches(p.path, partial)).map((p) => ({ value: `${head}"${p.path}": `, display: p.path, meaning: 'field' as const }));
    // $or and $and go first: the list is short and a long model would push them out of sight.
    const logical: FilterCompletion[] = [
      { value: `${head}"$or": [{ "`, display: '$or', meaning: 'or' as const },
      { value: `${head}"$and": [{ "`, display: '$and', meaning: 'and' as const },
    ].filter((o) => o.display.startsWith(partial) || !partial);
    return [...logical, ...fields];
  }

  // Right after a key: a colon and the values that fit.
  if (s.state === 'colon' && s.key) {
    const head = before.trimEnd();
    if (LOGICAL.has(s.key)) return [{ value: `${head}: [{ "`, display: `${s.key}: [`, meaning: s.key === '$and' ? 'and' : 'or' }];
    return operandsOf(s.key).map((o) => ({ value: `${head}: ${o.text}`, display: `"${s.key}": ${o.text}`, meaning: o.meaning, detail: o.detail }));
  }

  if (s.state === 'value' && !s.inString) {
    const head = before.replace(/\s*$/, ' ');
    // An element of $or or $and: a condition object.
    if (top?.bracket === '[' && owner && LOGICAL.has(owner)) {
      return paths.map((p) => ({ value: `${head}{ "${p.path}": `, display: `{ "${p.path}": ...`, meaning: 'field' as const }));
    }
    if (s.key && !s.key.startsWith('$')) return operandsOf(s.key).map((o) => ({ value: `${head}${o.text}`, display: o.text, meaning: o.meaning, detail: o.detail }));
    return [];
  }

  // After a complete value: the next condition, another alternative, or closing everything.
  if (s.state === 'after' && !s.inString && s.stack.length) {
    const head = before.trimEnd();
    const items: FilterCompletion[] = [];
    if (top?.bracket === '{') items.push({ value: `${head}, "`, display: ', "...', meaning: 'next' });
    const parent = s.stack.at(-2);
    if (top?.bracket === '{' && parent?.bracket === '[' && parent.owner && LOGICAL.has(parent.owner)) {
      items.push({ value: `${head} }, { "`, display: '}, { ...', meaning: 'nextAlternative' });
    }
    if (!after.trim()) items.push({ value: `${head}${closing(s.stack)}`, display: closing(s.stack).trim(), meaning: 'close' });
    return items;
  }
  return [];
};
