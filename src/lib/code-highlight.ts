/**
 * Splits code into tokens for highlighting: SQL keywords, functions, strings, numbers and comments;
 * in JavaScript and JSON, keys, $operators, strings, numbers, ObjectId and ISODate calls, regular
 * expressions and comments.
 */

export type CodeToken = { text: string; kind: 'kw' | 'fn' | 'comment' | 'string' | 'number' | 'key' | 'op' | 'plain' };

const SQL_KEYWORDS = new Set(
  `SELECT FROM WHERE AND OR NOT IN IS NULL AS ON JOIN INNER LEFT RIGHT OUTER GROUP BY ORDER HAVING LIMIT OFFSET DISTINCT
   BETWEEN LIKE ILIKE REGEXP ASC DESC TRUE FALSE DATE TIMESTAMP WITH`.split(/\s+/),
);

const SQL_TOKEN = /(--[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|('(?:[^']|'')*'?)|("(?:[^"]|"")*"?|`[^`]*`?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)(\s*\()?/g;

export const tokenizeSql = (text: string): CodeToken[] => {
  const tokens: CodeToken[] = [];
  let last = 0;
  for (const match of text.matchAll(SQL_TOKEN)) {
    const index = match.index!;
    if (index > last) tokens.push({ text: text.slice(last, index), kind: 'plain' });
    const [whole, comment, string, quoted, number, word, call] = match;
    if (comment) tokens.push({ text: comment, kind: 'comment' });
    else if (string) tokens.push({ text: string, kind: 'string' });
    else if (quoted) tokens.push({ text: quoted, kind: 'plain' });
    else if (number) tokens.push({ text: number, kind: 'number' });
    else if (word) {
      tokens.push({ text: word, kind: SQL_KEYWORDS.has(word.toUpperCase()) ? 'kw' : call ? 'fn' : 'plain' });
      if (call) tokens.push({ text: call, kind: 'plain' });
    } else tokens.push({ text: whole, kind: 'plain' });
    last = index + whole.length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last), kind: 'plain' });
  return tokens;
};

const JS_WORDS = new Set(['db', 'true', 'false', 'null', 'new', 'await', 'const', 'let', 'use']);

// Comments, strings, regex literals after ( : , [, numbers, $operators, words and calls.
const JS_TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|`[^`]*`?)|((?<=[(:,[]\s*)\/(?:\\.|[^/\\\n])+\/[a-z]*)|(\b-?\d+(?:\.\d+)?\b)|(\$[A-Za-z_][\w]*)|([A-Za-z_$][\w$]*)(\s*\()?/g;

export const tokenizeJs = (text: string): CodeToken[] => {
  const tokens: CodeToken[] = [];
  let last = 0;
  for (const match of text.matchAll(JS_TOKEN)) {
    const index = match.index!;
    if (index > last) tokens.push({ text: text.slice(last, index), kind: 'plain' });
    const [whole, comment, string, regex, number, operator, word, call] = match;
    const next = text.slice(index + whole.length);
    if (comment) tokens.push({ text: comment, kind: 'comment' });
    else if (string) tokens.push({ text: string, kind: /^\s*:/.test(next) ? 'key' : 'string' });
    else if (regex) tokens.push({ text: regex, kind: 'string' });
    else if (number) tokens.push({ text: number, kind: 'number' });
    else if (operator) tokens.push({ text: operator, kind: 'op' });
    else if (word) {
      const kind = call ? 'fn' : /^\s*:/.test(next) ? 'key' : JS_WORDS.has(word) ? 'kw' : 'plain';
      tokens.push({ text: word, kind });
      if (call) tokens.push({ text: call, kind: 'plain' });
    } else tokens.push({ text: whole, kind: 'plain' });
    last = index + whole.length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last), kind: 'plain' });
  return tokens;
};

export const TOKEN_CLASS: Record<CodeToken['kind'], string> = {
  kw: 'text-accent font-semibold',
  fn: 'text-fk',
  comment: 'text-muted italic',
  string: 'text-success',
  number: 'text-warning',
  key: 'text-pk',
  op: 'text-accent',
  plain: '',
};
