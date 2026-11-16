/**
 * Intermediate representation shared by every query language: SQL is read into it, each engine's
 * native query is read into it, and every translation is written from it. Parts keep their place in
 * the source text (`pos`) so the editor can underline problems.
 */

export type Pos = { start: number; end: number };

export type AggFn = 'count' | 'sum' | 'avg' | 'min' | 'max';

/** A field path, maybe qualified by a collection alias, or an aggregate over one. */
export type Ref = {
  /** Alias or collection name written before the path (`u.email`). */
  alias?: string;
  /** Dotted path; `*` only inside COUNT(*). */
  path: string;
  agg?: AggFn;
  pos?: Pos;
};

export type Value =
  | { kind: 'string'; value: string; pos?: Pos }
  | { kind: 'number'; value: number; pos?: Pos }
  | { kind: 'bool'; value: boolean; pos?: Pos }
  | { kind: 'null'; pos?: Pos }
  | { kind: 'date'; value: string; pos?: Pos }
  | { kind: 'objectId'; value: string; pos?: Pos };

export type Comparison = '=' | '!=' | '<' | '<=' | '>' | '>=';

export type Cond =
  | { op: 'and'; items: Cond[] }
  | { op: 'or'; items: Cond[] }
  | { op: 'not'; item: Cond }
  | { op: 'cmp'; field: Ref; cmp: Comparison; value: Value }
  | { op: 'in'; field: Ref; values: Value[]; negate?: boolean }
  | { op: 'between'; field: Ref; low: Value; high: Value; negate?: boolean }
  /** SQL LIKE pattern with % and _. */
  | { op: 'like'; field: Ref; pattern: string; negate?: boolean; insensitive?: boolean }
  /** A regular expression that has no LIKE form. */
  | { op: 'regex'; field: Ref; pattern: string; insensitive?: boolean; negate?: boolean }
  | { op: 'null'; field: Ref; negate?: boolean }
  | { op: 'exists'; field: Ref; negate?: boolean };

export type SelectItem = { kind: 'all'; alias?: string } | { kind: 'field'; ref: Ref; as?: string };

export type Join = {
  collection: string;
  alias?: string;
  /** ON left = right; one side belongs to this join. */
  on: { left: Ref; right: Ref };
  left: boolean;
  pos?: Pos;
  collectionPos?: Pos;
};

export type QueryIR = {
  from: { collection: string; alias?: string; pos?: Pos };
  joins: Join[];
  select: SelectItem[];
  distinct?: boolean;
  where?: Cond;
  groupBy: Ref[];
  having?: Cond;
  orderBy: { ref: Ref; desc: boolean }[];
  limit?: number;
  offset?: number;
  /** Parts of a native query with no SQL form, kept as comments. */
  untranslated?: string[];
};

export type Severity = 'error' | 'warning' | 'info';

export type Diagnostic = {
  severity: Severity;
  message: string;
  pos?: Pos;
  /** A replacement for the text at `pos`, offered as "Did you mean...?". */
  fix?: { label: string; text: string };
};

export const refText = (r: Ref) => {
  const base = r.alias ? `${r.alias}.${r.path}` : r.path;
  return r.agg ? `${r.agg.toUpperCase()}(${base})` : base;
};

/** Every reference a condition reads, for checks and for deciding where a $match goes. */
export const condRefs = (c: Cond | undefined, out: Ref[] = []): Ref[] => {
  if (!c) return out;
  if (c.op === 'and' || c.op === 'or') c.items.forEach((i) => condRefs(i, out));
  else if (c.op === 'not') condRefs(c.item, out);
  else out.push(c.field);
  return out;
};

/** The same query without text positions, to compare two of them. */
export const stripPositions = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value, (key, v) => (key === 'pos' ? undefined : v))) as T;
