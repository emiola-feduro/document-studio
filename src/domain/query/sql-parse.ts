import { t } from '../../i18n';
import type { AggFn, Comparison, Cond, Diagnostic, Join, Pos, QueryIR, Ref, SelectItem, Value } from './ir';

/**
 * Reads a SELECT written in SQL into the query IR: columns with dotted paths, aggregates, FROM and
 * [LEFT] JOIN ... ON, WHERE with comparisons, [NOT] IN, [NOT] BETWEEN, [NOT] LIKE, IS [NOT] NULL,
 * AND, OR, NOT and parentheses, GROUP BY, HAVING, ORDER BY, LIMIT and OFFSET. Values are text,
 * numbers, TRUE, FALSE, NULL, DATE '...', TIMESTAMP '...' and ObjectId('...').
 */

export type SqlToken = { kind: 'word' | 'quoted' | 'string' | 'number' | 'punct' | 'end'; text: string; value: string; pos: Pos };

export const SQL_KEYWORDS = new Set(
  'SELECT DISTINCT FROM AS JOIN LEFT INNER OUTER ON WHERE AND OR NOT IN BETWEEN LIKE ILIKE REGEXP IS NULL TRUE FALSE GROUP BY HAVING ORDER ASC DESC LIMIT OFFSET DATE TIMESTAMP'.split(' '),
);

const AGGS = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX']);

export const lexSql = (text: string): SqlToken[] => {
  const tokens: SqlToken[] = [];
  let i = 0;
  const push = (kind: SqlToken['kind'], start: number, end: number, value = text.slice(start, end)) => tokens.push({ kind, text: text.slice(start, end), value, pos: { start, end } });
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (text.startsWith('--', i)) {
      const end = text.indexOf('\n', i);
      i = end < 0 ? text.length : end;
      continue;
    }
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      let value = '';
      for (;;) {
        if (j >= text.length) throw new SqlError(t('qe.unterminatedString'), { start: i, end: text.length });
        if (text[j] === "'") {
          if (text[j + 1] === "'") {
            value += "'";
            j += 2;
            continue;
          }
          break;
        }
        value += text[j];
        j += 1;
      }
      push('string', i, j + 1, value);
      i = j + 1;
      continue;
    }
    if (ch === '"' || ch === '`') {
      const end = text.indexOf(ch, i + 1);
      if (end < 0) throw new SqlError(t('qe.unterminatedName'), { start: i, end: text.length });
      push('quoted', i, end + 1, text.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    const num = /^\d+(?:\.\d+)?/.exec(text.slice(i));
    if (num) {
      push('number', i, i + num[0].length);
      i += num[0].length;
      continue;
    }
    const word = /^[A-Za-z_$][\w$]*/.exec(text.slice(i));
    if (word) {
      push('word', i, i + word[0].length);
      i += word[0].length;
      continue;
    }
    const op = /^(<>|!=|<=|>=|[<>=,.()*;-])/.exec(text.slice(i));
    if (op) {
      push('punct', i, i + op[0].length);
      i += op[0].length;
      continue;
    }
    throw new SqlError(t('qe.unexpected', { token: ch }), { start: i, end: i + 1 });
  }
  tokens.push({ kind: 'end', text: '', value: '', pos: { start: text.length, end: text.length } });
  return tokens;
};

export class SqlError extends Error {
  constructor(
    message: string,
    readonly pos: Pos,
  ) {
    super(message);
  }
}

class Parser {
  i = 0;
  refs: Ref[] = [];
  constructor(readonly tokens: SqlToken[]) {}

  get tok() {
    return this.tokens[this.i];
  }

  atEnd() {
    return this.tokens[this.i].kind === 'end';
  }

  isKw(...words: string[]) {
    return this.tok.kind === 'word' && words.includes(this.tok.value.toUpperCase());
  }

  isPunct(p: string) {
    return this.tok.kind === 'punct' && this.tok.value === p;
  }

  take() {
    const tok = this.tok;
    this.i += 1;
    return tok;
  }

  kw(word: string) {
    if (!this.isKw(word)) throw this.fail(t('qe.expectedKeyword', { keyword: word }));
    return this.take();
  }

  punct(p: string) {
    if (!this.isPunct(p)) throw this.fail(t('qe.expectedKeyword', { keyword: p }));
    return this.take();
  }

  fail(message: string) {
    const tok = this.tok;
    return new SqlError(tok.kind === 'end' ? message : `${message}. ${t('qe.found', { token: tok.text })}`, tok.pos);
  }

  name(): SqlToken {
    if (this.tok.kind === 'quoted' || (this.tok.kind === 'word' && !SQL_KEYWORDS.has(this.tok.value.toUpperCase()))) return this.take();
    throw this.fail(t('qe.expectedName'));
  }

  /** A dotted name: alias.path.to.field. */
  ref(): Ref {
    const first = this.name();
    const parts = [first.value];
    let end = first.pos.end;
    while (this.isPunct('.')) {
      this.take();
      const next = this.name();
      parts.push(next.value);
      end = next.pos.end;
    }
    const ref: Ref = { path: parts.join('.'), pos: { start: first.pos.start, end } };
    this.refs.push(ref);
    return ref;
  }

  /** A column or an aggregate. */
  operand(): Ref {
    if (this.tok.kind === 'word' && AGGS.has(this.tok.value.toUpperCase()) && this.tokens[this.i + 1]?.value === '(') {
      const fn = this.take();
      this.punct('(');
      let ref: Ref;
      if (this.isPunct('*')) {
        const star = this.take();
        ref = { path: '*', pos: star.pos };
      } else {
        if (this.isKw('DISTINCT')) this.take();
        ref = this.ref();
      }
      const close = this.punct(')');
      ref.agg = fn.value.toLowerCase() as AggFn;
      ref.pos = { start: fn.pos.start, end: close.pos.end };
      return ref;
    }
    return this.ref();
  }

  value(): Value {
    const tok = this.tok;
    if (tok.kind === 'string') {
      this.take();
      return { kind: 'string', value: tok.value, pos: tok.pos };
    }
    if (tok.kind === 'number' || (this.isPunct('-') && this.tokens[this.i + 1]?.kind === 'number')) {
      const minus = this.isPunct('-') ? this.take() : undefined;
      const num = this.take();
      return { kind: 'number', value: Number(num.value) * (minus ? -1 : 1), pos: { start: (minus ?? num).pos.start, end: num.pos.end } };
    }
    if (this.isKw('TRUE', 'FALSE')) {
      this.take();
      return { kind: 'bool', value: tok.value.toUpperCase() === 'TRUE', pos: tok.pos };
    }
    if (this.isKw('NULL')) {
      this.take();
      return { kind: 'null', pos: tok.pos };
    }
    if (this.isKw('DATE', 'TIMESTAMP') && this.tokens[this.i + 1]?.kind === 'string') {
      this.take();
      const s = this.take();
      return { kind: 'date', value: s.value, pos: { start: tok.pos.start, end: s.pos.end } };
    }
    if (tok.kind === 'word' && tok.value.toLowerCase() === 'objectid' && this.tokens[this.i + 1]?.value === '(') {
      this.take();
      this.punct('(');
      const s = this.tok;
      if (s.kind !== 'string') throw this.fail(t('qe.expectedValue'));
      this.take();
      const close = this.punct(')');
      return { kind: 'objectId', value: s.value, pos: { start: tok.pos.start, end: close.pos.end } };
    }
    throw this.fail(t('qe.expectedValue'));
  }

  predicate(): Cond {
    const field = this.operand();
    const negate = this.isKw('NOT') ? Boolean(this.take()) : false;
    if (this.isKw('IN')) {
      this.take();
      this.punct('(');
      const values = [this.value()];
      while (this.isPunct(',')) {
        this.take();
        values.push(this.value());
      }
      this.punct(')');
      return { op: 'in', field, values, ...(negate ? { negate } : {}) };
    }
    if (this.isKw('BETWEEN')) {
      this.take();
      const low = this.value();
      this.kw('AND');
      const high = this.value();
      return { op: 'between', field, low, high, ...(negate ? { negate } : {}) };
    }
    if (this.isKw('LIKE', 'ILIKE')) {
      const insensitive = this.take().value.toUpperCase() === 'ILIKE';
      const pattern = this.tok;
      if (pattern.kind !== 'string') throw this.fail(t('qe.expectedText'));
      this.take();
      return { op: 'like', field, pattern: pattern.value, ...(negate ? { negate } : {}), ...(insensitive ? { insensitive } : {}) };
    }
    if (this.isKw('REGEXP')) {
      this.take();
      const pattern = this.tok;
      if (pattern.kind !== 'string') throw this.fail(t('qe.expectedText'));
      this.take();
      const insensitive = pattern.value.startsWith('(?i)');
      return { op: 'regex', field, pattern: insensitive ? pattern.value.slice(4) : pattern.value, ...(negate ? { negate } : {}), ...(insensitive ? { insensitive } : {}) };
    }
    if (negate) throw this.fail(t('qe.expectedKeyword', { keyword: 'IN, BETWEEN, LIKE' }));
    if (this.isKw('IS')) {
      this.take();
      const not = this.isKw('NOT') ? Boolean(this.take()) : false;
      this.kw('NULL');
      return { op: 'null', field, ...(not ? { negate: true } : {}) };
    }
    const op = this.tok;
    const cmp = op.kind === 'punct' && ['=', '<>', '!=', '<', '<=', '>', '>='].includes(op.value) ? op.value : undefined;
    if (!cmp) throw this.fail(t('qe.expectedOperator'));
    this.take();
    // `campo = NULL` reads as IS NULL, as people usually mean.
    const value = this.value();
    if (value.kind === 'null' && (cmp === '=' || cmp === '<>' || cmp === '!=')) return { op: 'null', field, ...(cmp === '=' ? {} : { negate: true }) };
    return { op: 'cmp', field, cmp: (cmp === '<>' ? '!=' : cmp) as Comparison, value };
  }

  primary(): Cond {
    if (this.isKw('NOT')) {
      this.take();
      return { op: 'not', item: this.primary() };
    }
    if (this.isPunct('(')) {
      this.take();
      const inner = this.cond();
      this.punct(')');
      return inner;
    }
    return this.predicate();
  }

  and(): Cond {
    const items = [this.primary()];
    while (this.isKw('AND')) {
      this.take();
      items.push(this.primary());
    }
    return items.length === 1 ? items[0] : { op: 'and', items: items.flatMap((c) => (c.op === 'and' ? c.items : [c])) };
  }

  cond(): Cond {
    const items = [this.and()];
    while (this.isKw('OR')) {
      this.take();
      items.push(this.and());
    }
    return items.length === 1 ? items[0] : { op: 'or', items: items.flatMap((c) => (c.op === 'or' ? c.items : [c])) };
  }

  alias(): string | undefined {
    if (this.isKw('AS')) {
      this.take();
      return this.name().value;
    }
    if (this.tok.kind === 'quoted' || (this.tok.kind === 'word' && !SQL_KEYWORDS.has(this.tok.value.toUpperCase()))) return this.take().value;
    return undefined;
  }

  count(): number {
    const tok = this.tok;
    if (tok.kind !== 'number') throw this.fail(t('qe.expectedNumber'));
    this.take();
    return Math.floor(Number(tok.value));
  }

  query(): QueryIR {
    if (this.tok.kind === 'end') throw this.fail(t('qe.expectedKeyword', { keyword: 'SELECT' }));
    this.kw('SELECT');
    const distinct = this.isKw('DISTINCT') ? Boolean(this.take()) : false;
    const select: SelectItem[] = [];
    do {
      if (select.length) this.take();
      if (this.isPunct('*')) {
        this.take();
        select.push({ kind: 'all' });
      } else if (this.tok.kind === 'word' && this.tokens[this.i + 1]?.value === '.' && this.tokens[this.i + 2]?.value === '*') {
        const alias = this.take().value;
        this.take();
        this.take();
        select.push({ kind: 'all', alias });
      } else {
        const ref = this.operand();
        const as = this.alias();
        select.push({ kind: 'field', ref, ...(as ? { as } : {}) });
      }
    } while (this.isPunct(','));
    this.kw('FROM');
    const fromTok = this.name();
    const from = { collection: fromTok.value, pos: fromTok.pos, ...(() => {
      const alias = this.alias();
      return alias ? { alias } : {};
    })() };
    const joins: Join[] = [];
    while (this.isKw('JOIN', 'LEFT', 'INNER')) {
      const start = this.tok.pos.start;
      let left = false;
      if (this.isKw('LEFT')) {
        this.take();
        left = true;
        if (this.isKw('OUTER')) this.take();
      } else if (this.isKw('INNER')) this.take();
      this.kw('JOIN');
      const coll = this.name();
      const alias = this.alias();
      this.kw('ON');
      const l = this.ref();
      this.punct('=');
      const r = this.ref();
      joins.push({ collection: coll.value, ...(alias ? { alias } : {}), on: { left: l, right: r }, left, pos: { start, end: r.pos!.end }, collectionPos: coll.pos });
    }
    const ir: QueryIR = { from, joins, select, groupBy: [], orderBy: [] };
    if (distinct) ir.distinct = true;
    if (this.isKw('WHERE')) {
      this.take();
      ir.where = this.cond();
    }
    if (this.isKw('GROUP')) {
      this.take();
      this.kw('BY');
      do {
        if (ir.groupBy.length) this.take();
        ir.groupBy.push(this.ref());
      } while (this.isPunct(','));
    }
    if (this.isKw('HAVING')) {
      this.take();
      ir.having = this.cond();
    }
    if (this.isKw('ORDER')) {
      this.take();
      this.kw('BY');
      do {
        if (ir.orderBy.length) this.take();
        const ref = this.operand();
        let desc = false;
        if (this.isKw('ASC', 'DESC')) desc = this.take().value.toUpperCase() === 'DESC';
        ir.orderBy.push({ ref, desc });
      } while (this.isPunct(','));
    }
    for (let k = 0; k < 2; k += 1) {
      if (this.isKw('LIMIT')) {
        this.take();
        ir.limit = this.count();
      } else if (this.isKw('OFFSET')) {
        this.take();
        ir.offset = this.count();
      }
    }
    if (this.isPunct(';')) this.take();
    if (!this.atEnd()) throw this.fail(t('qe.unexpectedEnd'));
    return ir;
  }
}

/** Splits `alias.path` into its alias once the aliases and collection names of the query are known. */
const qualify = (ir: QueryIR, refs: Ref[]) => {
  const names = new Set([ir.from.alias ?? ir.from.collection, ...ir.joins.map((j) => j.alias ?? j.collection)]);
  if (ir.from.alias) names.add(ir.from.collection);
  for (const j of ir.joins) if (j.alias) names.add(j.collection);
  for (const ref of refs) {
    const [head, ...rest] = ref.path.split('.');
    if (rest.length && names.has(head)) {
      ref.alias = head;
      ref.path = rest.join('.');
    }
  }
};

export type SqlParse = { ir?: QueryIR; diagnostics: Diagnostic[] };

export const parseSql = (text: string): SqlParse => {
  if (!text.trim()) return { diagnostics: [] };
  try {
    const parser = new Parser(lexSql(text));
    const ir = parser.query();
    qualify(ir, parser.refs);
    return { ir, diagnostics: [] };
  } catch (e) {
    if (e instanceof SqlError) return { diagnostics: [{ severity: 'error', message: e.message, pos: e.pos }] };
    throw e;
  }
};
