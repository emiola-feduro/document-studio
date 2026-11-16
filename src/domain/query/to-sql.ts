import type { Cond, QueryIR, Ref, Value } from './ir';

/**
 * Writes the query IR as readable SQL: one clause per line, AND conditions on their own lines,
 * short aliases when there are joins, and dotted paths. Parts with no SQL form go at the end as
 * comments.
 */

const RESERVED = new Set('SELECT FROM WHERE AND OR NOT IN IS NULL AS ON JOIN LEFT INNER GROUP BY ORDER HAVING LIMIT OFFSET DISTINCT BETWEEN LIKE ASC DESC TRUE FALSE DATE TIMESTAMP'.split(' '));

const ident = (name: string) => (/^[A-Za-z_][\w$]*$/.test(name) && !RESERVED.has(name.toUpperCase()) ? name : `"${name.replace(/"/g, '""')}"`);

const path = (p: string) => (p === '*' ? '*' : p.split('.').map(ident).join('.'));

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

export const valueSql = (v: Value) => {
  switch (v.kind) {
    case 'string':
      return quote(v.value);
    case 'number':
      return String(v.value);
    case 'bool':
      return v.value ? 'TRUE' : 'FALSE';
    case 'null':
      return 'NULL';
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(v.value) ? `DATE ${quote(v.value)}` : `TIMESTAMP ${quote(v.value)}`;
    case 'objectId':
      return `ObjectId(${quote(v.value)})`;
  }
};

const refSql = (r: Ref) => {
  const base = r.alias ? `${ident(r.alias)}.${path(r.path)}` : path(r.path);
  return r.agg ? `${r.agg.toUpperCase()}(${base})` : base;
};

const CMP = { '=': '=', '!=': '<>', '<': '<', '<=': '<=', '>': '>', '>=': '>=' } as const;

export const condSql = (c: Cond, nested = false): string => {
  switch (c.op) {
    case 'and':
    case 'or': {
      const text = c.items.map((i) => condSql(i, true)).join(` ${c.op.toUpperCase()} `);
      return nested ? `(${text})` : text;
    }
    case 'not':
      return `NOT ${condSql(c.item, true)}`;
    case 'cmp':
      return `${refSql(c.field)} ${CMP[c.cmp]} ${valueSql(c.value)}`;
    case 'in':
      return `${refSql(c.field)} ${c.negate ? 'NOT IN' : 'IN'} (${c.values.map(valueSql).join(', ')})`;
    case 'between':
      return `${refSql(c.field)} ${c.negate ? 'NOT BETWEEN' : 'BETWEEN'} ${valueSql(c.low)} AND ${valueSql(c.high)}`;
    case 'like':
      return `${refSql(c.field)} ${c.negate ? 'NOT ' : ''}${c.insensitive ? 'ILIKE' : 'LIKE'} ${quote(c.pattern)}`;
    case 'regex':
      return `${refSql(c.field)} ${c.negate ? 'NOT ' : ''}REGEXP ${quote(`${c.insensitive ? '(?i)' : ''}${c.pattern}`)}`;
    case 'null':
      return `${refSql(c.field)} IS ${c.negate ? 'NOT ' : ''}NULL`;
    case 'exists':
      // SQL has no "the key is missing"; IS NULL is the closest and the translations treat it alike.
      return `${refSql(c.field)} IS ${c.negate ? '' : 'NOT '}NULL`;
  }
};

/** Short aliases for the collections of a query: pedidos p, productos pr. */
export const makeAliases = (names: string[], taken: string[] = []) => {
  const used = new Set(taken.map((x) => x.toLowerCase()));
  return names.map((name) => {
    const clean = name.replace(/[^A-Za-z]/g, '').toLowerCase() || 'c';
    for (let n = 1; n <= clean.length; n += 1) {
      const alias = clean.slice(0, n);
      if (!used.has(alias) && !RESERVED.has(alias.toUpperCase())) {
        used.add(alias);
        return alias;
      }
    }
    let i = 2;
    while (used.has(`${clean[0]}${i}`)) i += 1;
    used.add(`${clean[0]}${i}`);
    return `${clean[0]}${i}`;
  });
};

const where = (keyword: string, c: Cond) => (c.op === 'and' ? `${keyword} ${c.items.map((i) => condSql(i, true)).join('\n  AND ')}` : `${keyword} ${condSql(c)}`);

const mapRefs = (c: Cond | undefined, f: (r: Ref) => Ref): Cond | undefined => {
  if (!c) return c;
  if (c.op === 'and' || c.op === 'or') return { ...c, items: c.items.map((i) => mapRefs(i, f)!) };
  if (c.op === 'not') return { ...c, item: mapRefs(c.item, f)! };
  return { ...c, field: f(c.field) };
};

export const toSql = (source: QueryIR): string => {
  const ir = structuredClone(source);
  // With joins every column says which collection it comes from.
  if (ir.joins.length && !ir.from.alias) {
    const [alias] = makeAliases([ir.from.collection], ir.joins.map((j) => j.alias ?? j.collection));
    ir.from.alias = alias;
    const selectNames = new Set(ir.select.flatMap((s) => (s.kind === 'field' && s.as ? [s.as] : [])));
    const qualify = (r: Ref): Ref => (r.alias || r.path === '*' || selectNames.has(r.path) ? r : { ...r, alias });
    ir.select = ir.select.map((s) => (s.kind === 'field' ? { ...s, ref: qualify(s.ref) } : s));
    ir.where = mapRefs(ir.where, qualify);
    ir.groupBy = ir.groupBy.map(qualify);
    ir.orderBy = ir.orderBy.map((o) => ({ ...o, ref: qualify(o.ref) }));
    ir.joins = ir.joins.map((j) => ({ ...j, on: { left: qualify(j.on.left), right: qualify(j.on.right) } }));
  }
  const lines: string[] = [];
  const columns = ir.select.map((s) => (s.kind === 'all' ? (s.alias ? `${ident(s.alias)}.*` : '*') : `${refSql(s.ref)}${s.as ? ` AS ${ident(s.as)}` : ''}`));
  lines.push(`SELECT ${ir.distinct ? 'DISTINCT ' : ''}${columns.join(', ')}`);
  lines.push(`FROM ${ident(ir.from.collection)}${ir.from.alias ? ` ${ident(ir.from.alias)}` : ''}`);
  for (const j of ir.joins) lines.push(`${j.left ? 'LEFT JOIN' : 'JOIN'} ${ident(j.collection)}${j.alias ? ` ${ident(j.alias)}` : ''} ON ${refSql(j.on.left)} = ${refSql(j.on.right)}`);
  if (ir.where) lines.push(where('WHERE', ir.where));
  if (ir.groupBy.length) lines.push(`GROUP BY ${ir.groupBy.map(refSql).join(', ')}`);
  if (ir.having) lines.push(where('HAVING', ir.having));
  if (ir.orderBy.length) lines.push(`ORDER BY ${ir.orderBy.map((o) => `${refSql(o.ref)}${o.desc ? ' DESC' : ''}`).join(', ')}`);
  if (ir.limit) lines.push(`LIMIT ${ir.limit}`);
  if (ir.offset) lines.push(`OFFSET ${ir.offset}`);
  for (const note of ir.untranslated ?? []) lines.push(`/* ${note.replace(/\*\//g, '* /')} */`);
  return lines.join('\n');
};
