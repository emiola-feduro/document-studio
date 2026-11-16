/**
 * Reads JavaScript object and array literals as written in Mongoose models, without running them:
 * quoted or bare keys, strings, numbers, booleans, regular expressions, identifiers such as
 * `String` or `Schema.Types.ObjectId`, calls like `new Schema({...})`, and functions, which are kept
 * only as "something that is not data". Comments are skipped.
 */

export type JsValue =
  | { kind: 'object'; entries: [string, JsValue][] }
  | { kind: 'array'; items: JsValue[] }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'null' }
  | { kind: 'regex'; source: string }
  | { kind: 'ident'; name: string }
  | { kind: 'call'; callee: string; args: JsValue[] }
  | { kind: 'code'; text: string };

export class JsParser {
  pos = 0;
  constructor(readonly text: string) {}

  private skip() {
    for (;;) {
      const rest = this.text.slice(this.pos);
      const ws = /^\s+/.exec(rest);
      if (ws) {
        this.pos += ws[0].length;
        continue;
      }
      if (rest.startsWith('//')) {
        const end = this.text.indexOf('\n', this.pos);
        this.pos = end < 0 ? this.text.length : end + 1;
        continue;
      }
      if (rest.startsWith('/*')) {
        const end = this.text.indexOf('*/', this.pos + 2);
        this.pos = end < 0 ? this.text.length : end + 2;
        continue;
      }
      return;
    }
  }

  private peek() {
    this.skip();
    return this.text[this.pos];
  }

  private expect(ch: string) {
    if (this.peek() !== ch) throw new Error(`Expected ${ch} at ${this.pos}`);
    this.pos += 1;
  }

  /** Skips a balanced piece of code (a function body, an arrow function) and returns its text. */
  private skipCode(): string {
    const start = this.pos;
    let depth = 0;
    while (this.pos < this.text.length) {
      const ch = this.text[this.pos];
      if (ch === '"' || ch === "'" || ch === '`') {
        this.readString();
        continue;
      }
      if ('({['.includes(ch)) depth += 1;
      else if (')}]'.includes(ch)) {
        if (depth === 0) break;
        depth -= 1;
      } else if (ch === ',' && depth === 0) break;
      this.pos += 1;
    }
    return this.text.slice(start, this.pos).trim();
  }

  private readString(): string {
    const quote = this.text[this.pos];
    this.pos += 1;
    let out = '';
    while (this.pos < this.text.length && this.text[this.pos] !== quote) {
      const ch = this.text[this.pos];
      if (ch === '\\') {
        const next = this.text[this.pos + 1];
        out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
        this.pos += 2;
        continue;
      }
      out += ch;
      this.pos += 1;
    }
    this.pos += 1;
    return out;
  }

  private readName(): string {
    const m = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/.exec(this.text.slice(this.pos));
    if (!m) throw new Error(`Unexpected ${this.text[this.pos] ?? 'end'} at ${this.pos}`);
    this.pos += m[0].length;
    return m[0];
  }

  value(): JsValue {
    const ch = this.peek();
    if (ch === '{') return this.object();
    if (ch === '[') return this.array();
    if (ch === '"' || ch === "'" || ch === '`') return { kind: 'string', value: this.readString() };
    if (ch === '/') {
      const m = /^\/((?:\\.|[^/\\\n])+)\/[a-z]*/.exec(this.text.slice(this.pos));
      if (m) {
        this.pos += m[0].length;
        return { kind: 'regex', source: m[1] };
      }
    }
    const num = /^-?\d+(?:\.\d+)?(?:e-?\d+)?/i.exec(this.text.slice(this.pos));
    if (num) {
      this.pos += num[0].length;
      return { kind: 'number', value: Number(num[0]) };
    }
    // A function or an arrow function is not data: it is kept as code.
    if (/^(function\b|async\b|\(|[A-Za-z_$][\w$]*\s*=>)/.test(this.text.slice(this.pos))) return { kind: 'code', text: this.skipCode() };
    if (this.text.startsWith('new ', this.pos)) {
      this.pos += 4;
      this.skip();
    }
    const name = this.readName();
    if (name === 'true' || name === 'false') return { kind: 'bool', value: name === 'true' };
    if (name === 'null' || name === 'undefined') return { kind: 'null' };
    if (this.peek() === '(') {
      this.pos += 1;
      const args: JsValue[] = [];
      while (this.peek() !== ')') {
        args.push(this.value());
        if (this.peek() === ',') this.pos += 1;
      }
      this.pos += 1;
      return { kind: 'call', callee: name, args };
    }
    return { kind: 'ident', name };
  }

  private object(): JsValue {
    this.expect('{');
    const entries: [string, JsValue][] = [];
    while (this.peek() !== '}') {
      if (this.text.startsWith('...', this.pos)) {
        this.pos += 3;
        entries.push(['...', { kind: 'code', text: this.skipCode() }]);
      } else {
        const ch = this.peek();
        const key = ch === '"' || ch === "'" ? this.readString() : ch === '[' ? `[${this.skipCode()}]` : this.readName();
        // Methods written as `name() { ... }` are code.
        if (this.peek() === '(') {
          this.skipCode();
          if (this.peek() === '{') {
            this.pos += 1;
            this.skipCode();
            this.expect('}');
          }
          entries.push([key, { kind: 'code', text: '' }]);
        } else if (this.peek() === ':') {
          this.pos += 1;
          entries.push([key, this.value()]);
        } else entries.push([key, { kind: 'ident', name: key }]);
      }
      if (this.peek() === ',') this.pos += 1;
    }
    this.pos += 1;
    return { kind: 'object', entries };
  }

  private array(): JsValue {
    this.expect('[');
    const items: JsValue[] = [];
    while (this.peek() !== ']') {
      items.push(this.value());
      if (this.peek() === ',') this.pos += 1;
    }
    this.pos += 1;
    return { kind: 'array', items };
  }
}

export const parseJs = (text: string) => new JsParser(text).value();

/** The text of the balanced (...) that starts at `open`, without the parentheses. */
export const balancedArgs = (text: string, open: number): string | undefined => {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return undefined;
};

/** Arguments of a call as values, for `new Schema(a, b)` or `model('X', schema)`. */
export const parseArgs = (inside: string): JsValue[] => {
  const p = new JsParser(`[${inside}]`);
  const v = p.value();
  return v.kind === 'array' ? v.items : [];
};

export const entry = (v: JsValue | undefined, key: string) => (v?.kind === 'object' ? v.entries.find(([k]) => k === key)?.[1] : undefined);

export const literal = (v: JsValue | undefined): unknown => {
  if (!v) return undefined;
  switch (v.kind) {
    case 'string':
    case 'number':
    case 'bool':
      return v.value;
    case 'null':
      return null;
    case 'array':
      return v.items.map(literal);
    case 'object':
      return Object.fromEntries(v.entries.map(([k, x]) => [k, literal(x)]));
    case 'regex':
      return v.source;
    case 'ident':
      return v.name;
    default:
      return undefined;
  }
};
