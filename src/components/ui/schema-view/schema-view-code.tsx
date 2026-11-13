import { useMemo } from 'react';
import type { Language } from '../../../domain/outputs';

type Token = { text: string; kind: 'kw' | 'comment' | 'string' | 'number' | 'key' | 'plain' };

const KEYWORDS: Record<Language, RegExp> = {
  js: /\b(db|use|const|let|var|function|return|if|else|for|new|true|false|null|undefined|createCollection|createIndex|runCommand|insertMany|ObjectId|ISODate|NumberDecimal|NumberLong|UUID|emit|throw)\b/g,
  ts: /\b(import|export|from|const|type|interface|new|return|true|false|null|undefined|string|number|boolean|unknown|Array|Schema|model)\b/g,
  json: /\b(true|false|null)\b/g,
  prisma: /\b(datasource|generator|model|type|enum|provider|url|env|String|Int|BigInt|Float|Boolean|DateTime|Json|Bytes)\b|@@?[a-zA-Z.]+/g,
  rules: /\b(rules_version|service|match|allow|read|write|create|update|delete|if|function|return|is|in|true|false|null|request|resource|data|keys|hasAll|hasOnly|size|matches|string|int|float|number|bool|map|list|timestamp|latlng|path|bytes)\b/g,
  sh: /\b(curl|DB|COUCH_URL)\b|-[XHd]\b/g,
  sql: /\b(CREATE|PRIMARY|INDEX|IF|NOT|EXISTS|ON|DISTINCT|ARRAY|FOR|IN|END|DESC|ASC|WHERE)\b/g,
};

const COMMENT: Record<Language, RegExp | null> = {
  js: /^\s*\/\//,
  ts: /^\s*\/\//,
  json: null,
  prisma: /^\s*\/\//,
  rules: /^\s*\/\//,
  sh: /^\s*#/,
  sql: /^\s*--/,
};

const tokenize = (line: string, language: Language): Token[] => {
  const comment = COMMENT[language];
  if (comment && comment.test(line)) return [{ text: line, kind: 'comment' }];
  const tokens: Token[] = [];
  const parts = line.split(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      // A JSON string followed by a colon is a key.
      const isKey = language === 'json' && /^\s*:/.test(parts[i + 1] ?? '');
      tokens.push({ text: part, kind: isKey ? 'key' : 'string' });
      return;
    }
    const re = new RegExp(`${KEYWORDS[language].source}|\\b-?\\d+(\\.\\d+)?\\b`, 'g');
    let last = 0;
    for (const match of part.matchAll(re)) {
      if (match.index! > last) tokens.push({ text: part.slice(last, match.index), kind: 'plain' });
      tokens.push({ text: match[0], kind: /^-?\d/.test(match[0]) ? 'number' : 'kw' });
      last = match.index! + match[0].length;
    }
    if (last < part.length) tokens.push({ text: part.slice(last), kind: 'plain' });
  });
  return tokens;
};

const kindClass = { kw: 'text-accent font-semibold', comment: 'text-muted italic', string: 'text-success', number: 'text-pk', key: 'text-fk', plain: '' };

const SchemaViewCode = ({ code, language }: { code: string; language: Language }) => {
  const lines = useMemo(() => code.split('\n').map((l) => tokenize(l, language)), [code, language]);

  return (
    <pre className="relative min-h-0 flex-1 overflow-auto p-4 font-code text-[13px] leading-relaxed">
      {/* Tailwind preflight gives <code> its own monospace font; inherit so the chosen code font applies. */}
      <code className="font-[inherit]">
        {lines.map((tokens, i) => (
          <div key={i}>
            {tokens.length === 0 ? ' ' : tokens.map((tk, j) => <span key={j} className={kindClass[tk.kind]}>{tk.text}</span>)}
          </div>
        ))}
      </code>
    </pre>
  );
};

export default SchemaViewCode;
