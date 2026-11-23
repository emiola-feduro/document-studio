import { displayType } from '../outputs/json-schema';
import { walkFields, toMongoPath } from '../paths';
import type { Collection, Field, Project } from '../types';

/**
 * Autocomplete for SQL written against a document model, from the text before the cursor:
 * SELECT or WITH at the start; collections after FROM and JOIN (the ones the SELECT already uses,
 * with their alias, first; after JOIN, the related ones); the ON condition built from the model's
 * references; the paths of a collection after `alias.`, nested ones included; operators that fit the
 * field type after a field in WHERE, positive and negative; AND, OR and the next clauses after a
 * complete condition. Nothing after AS, nor inside text or comments.
 */

export type SqlItemKind = 'keyword' | 'collection' | 'field' | 'function' | 'join' | 'operator';

export type SqlItem = { label: string; insert: string; kind: SqlItemKind; detail?: string; meaning?: string };

export type SqlCompletionResult = { from: number; to: number; items: SqlItem[] };

const MAX = 40;

const KEYWORDS = new Set('SELECT FROM WHERE AND OR NOT IN IS NULL AS ON JOIN LEFT INNER GROUP BY ORDER HAVING LIMIT OFFSET DISTINCT BETWEEN LIKE ILIKE ASC DESC TRUE FALSE'.split(' '));

const FUNCTIONS = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];

const NUMBERS = new Set(['int', 'long', 'double', 'decimal', 'number']);

/** What an aggregate returns, to offer its operators in HAVING. */
const NUMBER: Field = { id: 'aggregate', name: 'aggregate', type: 'long', required: true, nullable: false };

type Col = { collection: Collection; alias?: string };

export type Column = { path: string; field: Field };

export const columnsOf = (collection: Collection): Column[] => [
  ...(collection.fields.some((f) => f.name === '_id') ? [] : [{ path: '_id', field: { id: '_id', name: '_id', type: 'string' as const, required: true, nullable: false } }]),
  ...walkFields(collection.fields).map((e) => ({ path: toMongoPath(e.path), field: e.field })),
];

const ident = (name: string) => (/^[A-Za-z_][\w$]*$/.test(name) && !KEYWORDS.has(name.toUpperCase()) ? name : `"${name}"`);

/** Hides strings and comments (same length) so the context reads only code. */
const codeOf = (text: string) =>
  text
    .replace(/'(?:[^']|'')*'?/g, (m) => ' '.repeat(m.length))
    .replace(/--[^\n]*/g, (m) => ' '.repeat(m.length))
    .replace(/\/\*[\s\S]*?(?:\*\/|$)/g, (m) => ' '.repeat(m.length));

const insideStringOrComment = (before: string) => {
  let quote = false;
  for (let i = 0; i < before.length; i += 1) {
    const c = before[i];
    if (quote) {
      if (c === "'") quote = false;
      continue;
    }
    if (c === "'") quote = true;
    else if (c === '-' && before[i + 1] === '-') {
      const end = before.indexOf('\n', i);
      if (end < 0) return true;
      i = end;
    } else if (c === '/' && before[i + 1] === '*') {
      const end = before.indexOf('*/', i + 2);
      if (end < 0) return true;
      i = end + 1;
    }
  }
  return quote;
};

const NOT_ALIAS = 'ON|WHERE|JOIN|LEFT|INNER|OUTER|GROUP|ORDER|HAVING|LIMIT|OFFSET|AS|FROM|SELECT|AND|OR|NOT';

/** Collections named after FROM, JOIN or a comma in FROM, with their aliases. */
export const collectionRefs = (code: string, project: Project): Col[] => {
  const refs: Col[] = [];
  // A keyword is never a collection or an alias: in "SELECT a, FROM t" the comma is not followed by a collection.
  const pattern = new RegExp(String.raw`(?:\bFROM|\bJOIN|,)\s+(?!(?:${NOT_ALIAS})\b)("[^"]+"|[A-Za-z_][\w$]*)(?:\s+(?:AS\s+)?(?!(?:${NOT_ALIAS})\b)([A-Za-z_][\w$]*))?`, 'gi');
  for (const m of code.matchAll(pattern)) {
    const name = m[1].replace(/^"(.*)"$/, '$1');
    const collection = project.collections.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (!collection) continue;
    const alias = m[2];
    if (!refs.some((r) => r.collection.id === collection.id && r.alias === alias)) refs.push({ collection, ...(alias ? { alias } : {}) });
  }
  return refs;
};

const clauseAt = (code: string) => {
  let clause = 'START';
  for (const m of code.matchAll(/\b(SELECT|FROM|JOIN|ON|WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET)\b/gi)) clause = m[1].toUpperCase().replace(/\s+/g, ' ');
  return clause;
};

const rank = (items: SqlItem[], partial: string) => {
  if (!partial) return items.slice(0, MAX);
  const p = partial.toLowerCase();
  const key = (i: SqlItem) => i.label.toLowerCase();
  const tail = (i: SqlItem) => key(i).split('.').pop()!;
  const starts = items.filter((i) => key(i).startsWith(p) || tail(i).startsWith(p));
  const contains = items.filter((i) => !starts.includes(i) && key(i).includes(p));
  return [...starts, ...contains].filter((i) => key(i) !== p).slice(0, MAX);
};

export type Operator = { op: string; meaning: string; detail?: string };

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Operators that fit a field, positive first and then negative, with a sample value of its type. */
export const sqlOperatorsFor = (field: Field, sample: string, sampleId?: string): Operator[] => {
  const holder = field.type === 'array' && field.items ? field.items : field;
  const type = holder.type;
  const ops: Operator[] = [];
  const year = new Date().getFullYear();
  if (type === 'enum') {
    const values = holder.enumValues ?? [];
    for (const v of values.slice(0, 4)) ops.push({ op: `= ${quote(v)}`, meaning: 'equals', detail: v });
    if (values[0]) ops.push({ op: `<> ${quote(values[0])}`, meaning: 'notEquals', detail: values[0] });
    if (values.length > 1) ops.push({ op: `IN (${values.slice(0, 2).map(quote).join(', ')})`, meaning: 'oneOf' }, { op: `NOT IN (${quote(values[0])})`, meaning: 'notOneOf' });
  } else if (type === 'bool') {
    ops.push({ op: '= TRUE', meaning: 'isTrue' }, { op: '= FALSE', meaning: 'isFalse' });
  } else if (NUMBERS.has(type)) {
    ops.push(
      { op: '= 1', meaning: 'equals', detail: '1' },
      { op: '> 0', meaning: 'greater' },
      { op: 'BETWEEN 1 AND 100', meaning: 'range' },
      { op: 'IN (1, 2, 3)', meaning: 'oneOf' },
      { op: '<> 0', meaning: 'notEquals', detail: '0' },
      { op: 'NOT BETWEEN 1 AND 100', meaning: 'outsideRange' },
    );
  } else if (type === 'date' || type === 'timestamp') {
    ops.push(
      { op: `>= DATE '${year}-01-01'`, meaning: 'dateFrom' },
      { op: `BETWEEN DATE '${year}-01-01' AND DATE '${year}-12-31'`, meaning: 'dateRange' },
      { op: `< DATE '${year}-01-01'`, meaning: 'before' },
    );
  } else if (type === 'objectId' || type === 'reference') {
    const id = sampleId ?? '000000000000000000000000';
    const literal = type === 'objectId' ? `ObjectId(${quote(id)})` : quote(id);
    ops.push({ op: `= ${literal}`, meaning: 'id' }, { op: `<> ${literal}`, meaning: 'notEquals', detail: id }, { op: `IN (${literal})`, meaning: 'oneOf' });
  } else if (type === 'string' || type === 'uuid') {
    ops.push(
      { op: `= ${quote(sample)}`, meaning: 'equals', detail: sample },
      { op: `LIKE ${quote(`${sample}%`)}`, meaning: 'startsWith' },
      { op: `LIKE ${quote(`%${sample}%`)}`, meaning: 'contains' },
      { op: `IN (${quote(sample)}, ${quote(`${sample}2`)})`, meaning: 'oneOf' },
      { op: `<> ${quote(sample)}`, meaning: 'notEquals', detail: sample },
      { op: `NOT LIKE ${quote(`%${sample}%`)}`, meaning: 'notContains' },
    );
  }
  if (!field.required || field.nullable || type === 'object') ops.push({ op: 'IS NULL', meaning: 'isNull' }, { op: 'IS NOT NULL', meaning: 'notNull' });
  return ops;
};

/** Id of a real sample document of the collection a reference points at, for the suggested values. */
const sampleIdFor = (project: Project, field: Field) => {
  const holder = field.type === 'array' ? field.items : field;
  const target = holder?.reference?.collectionId;
  const doc = target ? project.documents?.[target]?.[0] : undefined;
  if (!doc) return undefined;
  try {
    const id = (JSON.parse(doc.json) as { _id?: unknown })._id;
    return typeof id === 'string' ? id : id && typeof id === 'object' && '$oid' in id ? String((id as { $oid: unknown }).$oid) : undefined;
  } catch {
    return undefined;
  }
};

/** Reference pairs of the model: holder collection, its path, and the collection it points at. */
const references = (project: Project) =>
  project.collections.flatMap((c) =>
    columnsOf(c).flatMap(({ path, field }) => {
      const target = (field.type === 'array' ? field.items : field)?.reference?.collectionId;
      return target ? [{ holder: c, path, target }] : [];
    }),
  );

export const sqlCompletions = (text: string, caret: number, project: Project, sample: string): SqlCompletionResult => {
  const before = text.slice(0, caret);
  const none = { from: caret, to: caret, items: [] };
  if (insideStringOrComment(before)) return none;
  const code = codeOf(text);
  const codeBefore = code.slice(0, caret);
  const refs = collectionRefs(code, project);
  const byName = (n: string) => refs.find((r) => (r.alias ?? r.collection.name).toLowerCase() === n.toLowerCase()) ?? refs.find((r) => r.collection.name.toLowerCase() === n.toLowerCase());

  // The word being typed, maybe a dotted path after an alias.
  const m = /((?:[A-Za-z_$][\w$]*\.)*)([A-Za-z_$][\w$]*)?$/.exec(codeBefore)!;
  const segments = m[1].split('.').filter(Boolean);
  const partial = m[2] ?? '';
  const qualifierRef = segments.length ? byName(segments[0]) ?? (project.collections.find((c) => c.name.toLowerCase() === segments[0].toLowerCase()) ? { collection: project.collections.find((c) => c.name.toLowerCase() === segments[0].toLowerCase())! } : undefined) : undefined;
  const qualifier = qualifierRef ? segments[0] : undefined;
  const pathPrefix = (qualifier ? segments.slice(1) : segments).join('.');
  const from = caret - partial.length - (pathPrefix ? pathPrefix.length + 1 : 0);
  // Accepting in the middle of a word replaces it whole; at its start, the word stays.
  const to = /[\w$.]$/.test(before) ? caret + (/^[\w$]*/.exec(text.slice(caret))?.[0].length ?? 0) : caret;
  const wordStart = from - (qualifier ? qualifier.length + 1 : 0);
  const head = codeBefore.slice(0, wordStart);
  const prev = /([A-Za-z_][\w$]*|[,(=<>!]+)\s*$/.exec(head)?.[1]?.toUpperCase() ?? '';
  const result = (items: SqlItem[]) => ({ from, to, items: rank(items, partial) });
  const keyword = (label: string): SqlItem => ({ label, insert: `${label} `, kind: 'keyword' });
  const clause = clauseAt(codeBefore);

  if (prev === 'AS') return none;

  // Fields already in the SELECT list, so they are not offered twice.
  const rest = `${code.slice(0, wordStart)} ${code.slice(to)}`;
  const selectStart = [...codeBefore.matchAll(/\bSELECT\b/gi)].pop()?.index;
  const used = new Set<string>();
  if (selectStart !== undefined) {
    const fromAfter = /\bFROM\b/i.exec(code.slice(selectStart));
    const end = fromAfter ? selectStart + fromAfter.index : code.length;
    const list = `${code.slice(selectStart + 6, Math.max(selectStart + 6, wordStart))} ${code.slice(Math.min(to, end), end)}`;
    for (const x of list.matchAll(/\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\b(?!\s*\()/g)) used.add(x[1].toLowerCase());
  }
  const inSelect = clause === 'SELECT';
  const fieldItems = (ref: Col, qualify: boolean, prefix = ''): SqlItem[] =>
    columnsOf(ref.collection)
      .filter(({ path }) => !prefix || path.startsWith(`${prefix}.`))
      .filter(({ path }) => {
        if (!inSelect) return true;
        const name = qualify ? `${ref.alias ?? ref.collection.name}.${path}` : path;
        return !used.has(name.toLowerCase()) && !used.has(path.toLowerCase());
      })
      .map(({ path, field }) => {
        const shown = qualify ? `${ref.alias ?? ref.collection.name}.${path}` : path;
        return { label: shown, insert: qualify ? `${ident(ref.alias ?? ref.collection.name)}.${path}` : path, kind: 'field', detail: displayType(project.engine, field) };
      });
  const queryFields = () => {
    const qualify = refs.length > 1 || refs.some((r) => r.alias);
    return refs.flatMap((r) => fieldItems(r, qualify));
  };
  const functions = (): SqlItem[] => FUNCTIONS.map((f) => ({ label: `${f}()`, insert: `${f}(`, kind: 'function' }));
  /** Names given with AS in the SELECT list, which HAVING and ORDER BY can use. */
  const selectAliases = (): SqlItem[] => {
    const list = /\bSELECT\b([\s\S]*?)\bFROM\b/i.exec(code)?.[1] ?? '';
    return [...new Set([...list.matchAll(/\bAS\s+([A-Za-z_][\w$]*)/gi)].map((x) => x[1]))].map((name) => ({ label: name, insert: `${name} `, kind: 'field' as const, detail: 'AS' }));
  };

  /** "x.field" pairs already written, to guess the collection of an alias not declared yet. */
  const qualified = new Map<string, Set<string>>();
  for (const x of rest.matchAll(/\b([A-Za-z_][\w$]*)\.([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)*)/g)) {
    const k = x[1].toLowerCase();
    if (!qualified.has(k)) qualified.set(k, new Set());
    qualified.get(k)!.add(x[2]);
  }
  const declared = new Set(refs.map((r) => (r.alias ?? r.collection.name).toLowerCase()));
  const wanted: Col[] = [];
  for (const [name, paths] of qualified) {
    if (declared.has(name)) continue;
    const exact = project.collections.find((c) => c.name.toLowerCase() === name);
    if (exact) {
      wanted.push({ collection: exact });
      continue;
    }
    const fits = project.collections.filter((c) => [...paths].every((p) => columnsOf(c).some((col) => col.path === p)));
    const best = fits.find((c) => c.name.toLowerCase().startsWith(name)) ?? fits.find((c) => c.name.toLowerCase()[0] === name[0]) ?? fits[0];
    if (best) wanted.push({ collection: best, alias: name });
  }

  const collections = (joining: boolean): SqlItem[] => {
    const items: SqlItem[] = [];
    const seen = new Set<string>();
    const add = (c: Collection, alias?: string, detail?: string) => {
      const key = `${c.id}:${alias ?? ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push({ label: alias ? `${c.name} ${alias}` : c.name, insert: `${ident(c.name)}${alias ? ` ${alias}` : ''} `, kind: 'collection', detail });
    };
    const inQuery = new Set(refs.map((r) => r.collection.id));
    for (const w of wanted) if (!inQuery.has(w.collection.id)) add(w.collection, w.alias);
    if (joining) {
      for (const ref of references(project)) {
        if (inQuery.has(ref.holder.id) && !inQuery.has(ref.target)) add(project.collections.find((c) => c.id === ref.target)!);
        if (inQuery.has(ref.target) && !inQuery.has(ref.holder.id)) add(ref.holder);
      }
    }
    const withAlias = new Set(items.map((i) => i.label.split(' ')[0]));
    for (const c of project.collections) if (!inQuery.has(c.id) && !withAlias.has(c.name)) add(c);
    for (const c of project.collections) if (inQuery.has(c.id)) add(c);
    return items;
  };

  // "alias." or "alias.path.": that collection's paths.
  if (qualifierRef) return result(fieldItems(qualifierRef as Col, false, pathPrefix));

  // "c.nom" in a SELECT before FROM: c is an alias still to declare; the fields keep it.
  if (segments.length === 1 && !refs.length && clause === 'SELECT') {
    const alias = segments[0];
    const order = [...project.collections].sort((a, b) => Number(!a.name.toLowerCase().startsWith(alias.toLowerCase())) - Number(!b.name.toLowerCase().startsWith(alias.toLowerCase())));
    const items = order.flatMap((c) =>
      columnsOf(c)
        .filter(({ path }) => !used.has(`${alias}.${path}`.toLowerCase()))
        .map(({ path, field }) => ({ label: `${alias}.${path}`, insert: `${alias}.${path}`, kind: 'field' as const, detail: `${c.name}, ${displayType(project.engine, field)}` })),
    );
    const seen = new Set<string>();
    return { from: wordStart, to, items: rank(items.filter((i) => (seen.has(i.label) ? false : (seen.add(i.label), true))), partial) };
  }

  if (prev === 'FROM' || prev === 'JOIN' || (prev === ',' && clause === 'FROM')) return result(collections(prev !== 'FROM'));

  // Right after "JOIN coll [alias]" or ON: the conditions from the model's references.
  const joined = /\bJOIN\s+("[^"]+"|[A-Za-z_][\w$]*)(?:\s+(?:AS\s+)?(?!ON\b)([A-Za-z_][\w$]*))?\s+(ON\s+)?$/i.exec(head);
  if (joined || prev === 'ON') {
    const target = joined ? refs.find((r) => r.collection.name.toLowerCase() === joined[1].replace(/"/g, '').toLowerCase()) : refs[refs.length - 1];
    const conditions: SqlItem[] = [];
    if (target) {
      const name = (r: Col) => r.alias ?? ident(r.collection.name);
      for (const other of refs) {
        if (other === target) continue;
        for (const ref of references(project)) {
          const pair = ref.holder.id === target.collection.id && ref.target === other.collection.id ? [target, other] : ref.holder.id === other.collection.id && ref.target === target.collection.id ? [other, target] : null;
          if (!pair) continue;
          const condition = `${name(pair[0])}.${ref.path} = ${name(pair[1])}._id`;
          const text = joined && !joined[3] ? `ON ${condition}` : condition;
          conditions.push({ label: text, insert: `${text} `, kind: 'join' });
        }
      }
    }
    if (joined && !joined[3]) return result([...conditions, keyword('ON')]);
    return result([...conditions, ...queryFields()]);
  }

  // After a field in WHERE, HAVING or ON: operators of its type, filtered by what is typed (L for LIKE, I for IN).
  // In HAVING, after COUNT(*) or the alias given to an aggregate: the operators of a number.
  if (clause === 'HAVING' && !qualifier && !pathPrefix) {
    const aliases = new Set([...code.matchAll(/\b(?:COUNT|SUM|AVG|MIN|MAX)\s*\([^()]*\)\s+AS\s+([A-Za-z_][\w$]*)/gi)].map((x) => x[1].toLowerCase()));
    const aggregate = /(?:\b(?:COUNT|SUM|AVG|MIN|MAX)\s*\([^()]*\)|\b([A-Za-z_][\w$]*))\s+(NOT\s+)?$/i.exec(head);
    if (aggregate && (!aggregate[1] || aliases.has(aggregate[1].toLowerCase()))) {
      let ops = sqlOperatorsFor(NUMBER, sample);
      if (aggregate[2]) ops = ops.filter((o) => /^(IN|BETWEEN)\b/.test(o.op));
      const fitting = ops.filter((o) => o.op.toUpperCase().startsWith(partial.toUpperCase()));
      if (fitting.length) return { from, to, items: fitting.map((o) => ({ label: o.op, insert: `${o.op} `, kind: 'operator' as const, meaning: o.meaning, detail: o.detail })) };
    }
  }

  // A field on the right of a comparison (p.clienteId = c._id) completes the condition.
  const rightSide = /[=<>!]\s*(?:[A-Za-z_][\w$]*\.)?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s+$/.test(head);
  if (['WHERE', 'ON', 'HAVING'].includes(clause) && !qualifier && !pathPrefix && !rightSide) {
    const last = /(?:([A-Za-z_][\w$]*)\.)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s+(NOT\s+)?$/i.exec(head);
    if (last && !KEYWORDS.has(last[2].toUpperCase())) {
      const fullPath = last[1] && !byName(last[1]) ? `${last[1]}.${last[2]}` : last[2];
      const owner = last[1] && byName(last[1]) ? byName(last[1]) : refs.find((r) => columnsOf(r.collection).some((c) => c.path === fullPath));
      const column = owner ? columnsOf(owner.collection).find((c) => c.path === fullPath) : undefined;
      if (column) {
        let ops = sqlOperatorsFor(column.field, sample, sampleIdFor(project, column.field));
        // After "campo NOT" only the operators that take NOT.
        if (last[3]) ops = ops.filter((o) => /^(IN|LIKE|BETWEEN)\b/.test(o.op));
        else ops.push({ op: 'NOT', meaning: 'not' });
        const typed = partial.toUpperCase();
        const fitting = ops.filter((o) => o.op.toUpperCase().startsWith(typed));
        if (fitting.length) return { from, to, items: fitting.map((o) => ({ label: o.op, insert: `${o.op} `, kind: 'operator' as const, meaning: o.meaning, detail: o.detail })) };
      }
    }
  }

  switch (clause) {
    case 'START':
      return result([keyword('SELECT')]);
    case 'SELECT': {
      // FROM only when the query does not have it yet after the cursor.
      const items = [...queryFields(), ...functions(), keyword('DISTINCT'), ...(/\bFROM\b/i.test(code.slice(to)) ? [] : [keyword('FROM')]), keyword('AS')];
      if (!refs.length) {
        // No FROM yet: every collection's fields, those already used in the list first.
        const order = [...wanted, ...project.collections.filter((c) => !wanted.some((w) => w.collection.id === c.id)).map((c) => ({ collection: c }))];
        items.unshift(...order.flatMap((c) => fieldItems(c, true)));
      }
      if (!partial && /SELECT\s*$/i.test(head)) items.unshift({ label: '*', insert: '* ', kind: 'field' });
      return result(items);
    }
    case 'FROM':
    case 'JOIN':
      return result(['JOIN', 'LEFT JOIN', 'WHERE', 'GROUP BY', 'ORDER BY', 'LIMIT', 'AS'].map(keyword));
    case 'WHERE':
    case 'ON':
    case 'HAVING': {
      const complete = rightSide || /('(?:[^']|'')*'|\b\d+(?:\.\d+)?|\)|\bNULL|\bTRUE|\bFALSE)\s+$/i.test(before.slice(0, before.length - partial.length));
      // GROUP BY cannot come after HAVING, and after ON the query may go on with another JOIN or WHERE.
      const next = clause === 'HAVING' ? ['AND', 'OR', 'ORDER BY', 'LIMIT'] : clause === 'ON' ? ['AND', 'OR', 'JOIN', 'LEFT JOIN', 'WHERE', 'GROUP BY', 'ORDER BY', 'LIMIT'] : ['AND', 'OR', 'GROUP BY', 'ORDER BY', 'LIMIT'];
      if (complete) return result([...next.map(keyword), ...queryFields()]);
      return result([...(clause === 'HAVING' ? [...selectAliases(), ...functions()] : []), ...queryFields(), ...['NOT', '('].map((k) => ({ label: k, insert: k === '(' ? '(' : `${k} `, kind: 'keyword' as const }))]);
    }
    case 'GROUP BY':
      return result([...queryFields(), ...['HAVING', 'ORDER BY', 'LIMIT'].map(keyword)]);
    case 'ORDER BY':
      return result([...selectAliases(), ...queryFields(), ...functions(), ...['ASC', 'DESC', 'LIMIT', 'OFFSET'].map(keyword)]);
    case 'LIMIT':
      return result([keyword('OFFSET')]);
    default:
      return result([]);
  }
};
