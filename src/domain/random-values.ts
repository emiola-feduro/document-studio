import type { Locale } from '../i18n';
import { ID_KEY } from './engines';
import { documentIds, parseDocument, type JsonObject } from './documents';
import { uid } from './model';
import { topologicalOrder } from './model';
import type { Collection, EngineId, Field, Project, SampleDocument } from './types';

export type Rng = () => number;

/** Small seeded generator so tests are reproducible. */
export const seededRng = (seed: number): Rng => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
};

const int = (rng: Rng, min: number, max: number) => Math.floor(rng() * (max - min + 1)) + min;
const pick = <T,>(rng: Rng, list: readonly T[]) => list[int(rng, 0, list.length - 1)];

type Words = { first: string[]; last: string[]; cities: string[]; countries: string[]; words: string[]; titles: string[]; domain: string; street: (n: number) => string; sentence: string[] };

const DATA: Record<Locale, Words> = {
  es: {
    first: ['Ana', 'Luis', 'María', 'Carlos', 'Sofía', 'Jorge', 'Lucía', 'Andrés', 'Valentina', 'Diego', 'Camila', 'Mateo'],
    last: ['García', 'Rodríguez', 'López', 'Martínez', 'Gómez', 'Pérez', 'Sánchez', 'Ramírez', 'Torres', 'Flores'],
    cities: ['Bogotá', 'Madrid', 'Lima', 'Quito', 'Santiago', 'Ciudad de México', 'Buenos Aires', 'Montevideo'],
    countries: ['Colombia', 'España', 'Perú', 'Ecuador', 'Chile', 'México', 'Argentina', 'Uruguay'],
    words: ['mesa', 'azul', 'rápido', 'proyecto', 'norte', 'verde', 'datos', 'nube', 'claro', 'ruta', 'café', 'luna'],
    titles: ['Guía práctica', 'Notas de viaje', 'Ideas para el fin de semana', 'Resumen del mes', 'Primeros pasos', 'Lo que aprendí'],
    sentence: ['Un texto breve', 'con algunas palabras', 'para probar el diseño', 'y ver cómo se comporta', 'en la aplicación'],
    domain: 'ejemplo.com',
    street: (n) => `Calle ${n} # ${n + 12}-${n % 90}`,
  },
  en: {
    first: ['Emma', 'Liam', 'Olivia', 'Noah', 'Ava', 'James', 'Mia', 'Lucas', 'Grace', 'Henry', 'Chloe', 'Jack'],
    last: ['Smith', 'Johnson', 'Brown', 'Taylor', 'Wilson', 'Davis', 'Clark', 'Lewis', 'Walker', 'Hall'],
    cities: ['London', 'New York', 'Toronto', 'Sydney', 'Dublin', 'Chicago', 'Boston', 'Seattle'],
    countries: ['United Kingdom', 'United States', 'Canada', 'Australia', 'Ireland', 'New Zealand'],
    words: ['table', 'blue', 'quick', 'project', 'north', 'green', 'data', 'cloud', 'bright', 'route', 'coffee', 'moon'],
    titles: ['A practical guide', 'Travel notes', 'Weekend ideas', 'Monthly recap', 'Getting started', 'What I learned'],
    sentence: ['A short text', 'with a few words', 'to try the design', 'and see how it behaves', 'in the app'],
    domain: 'example.com',
    street: (n) => `${n} Main Street`,
  },
  fr: {
    first: ['Léa', 'Hugo', 'Chloé', 'Louis', 'Manon', 'Jules', 'Camille', 'Arthur', 'Inès', 'Gabriel', 'Zoé', 'Nathan'],
    last: ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau'],
    cities: ['Paris', 'Lyon', 'Marseille', 'Bordeaux', 'Montréal', 'Bruxelles', 'Genève', 'Nantes'],
    countries: ['France', 'Belgique', 'Suisse', 'Canada', 'Luxembourg', 'Sénégal'],
    words: ['table', 'bleu', 'rapide', 'projet', 'nord', 'vert', 'données', 'nuage', 'clair', 'route', 'café', 'lune'],
    titles: ['Guide pratique', 'Notes de voyage', 'Idées pour le week-end', 'Bilan du mois', 'Premiers pas', 'Ce que j’ai appris'],
    sentence: ['Un texte court', 'avec quelques mots', 'pour essayer le modèle', 'et voir son comportement', 'dans l’application'],
    domain: 'exemple.com',
    street: (n) => `${n} rue de la Paix`,
  },
  pt: {
    first: ['Ana', 'João', 'Maria', 'Pedro', 'Beatriz', 'Lucas', 'Mariana', 'Gabriel', 'Laura', 'Rafael', 'Júlia', 'Miguel'],
    last: ['Silva', 'Santos', 'Oliveira', 'Souza', 'Pereira', 'Costa', 'Rodrigues', 'Almeida', 'Lima', 'Carvalho'],
    cities: ['São Paulo', 'Lisboa', 'Rio de Janeiro', 'Porto', 'Salvador', 'Recife', 'Curitiba', 'Coimbra'],
    countries: ['Brasil', 'Portugal', 'Angola', 'Moçambique', 'Cabo Verde'],
    words: ['mesa', 'azul', 'rápido', 'projeto', 'norte', 'verde', 'dados', 'nuvem', 'claro', 'rota', 'café', 'lua'],
    titles: ['Guia prático', 'Notas de viagem', 'Ideias para o fim de semana', 'Resumo do mês', 'Primeiros passos', 'O que aprendi'],
    sentence: ['Um texto curto', 'com algumas palavras', 'para testar o modelo', 'e ver como se comporta', 'no aplicativo'],
    domain: 'exemplo.com',
    street: (n) => `Rua das Flores, ${n}`,
  },
};

const ascii = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Field name fragments in the four languages, used to guess what kind of text fits. */
const KEYS: [keyof typeof GUESS, string[]][] = [
  ['email', ['email', 'correo', 'mail', 'courriel']],
  ['phone', ['telefono', 'phone', 'celular', 'movil', 'telephone', 'telefone', 'tel']],
  ['url', ['url', 'web', 'sitio', 'site', 'link', 'enlace', 'avatar', 'imagen', 'image', 'foto', 'photo']],
  ['last', ['apellido', 'lastname', 'last_name', 'sobrenome', 'surname']],
  ['fullName', ['autor', 'author', 'usuario', 'username', 'user', 'remitente', 'sender']],
  ['title', ['titulo', 'title', 'titre', 'asunto', 'subject']],
  ['text', ['descripcion', 'description', 'contenido', 'content', 'texto', 'text', 'body', 'cuerpo', 'mensaje', 'message', 'bio', 'comentario', 'comment', 'resumen', 'summary', 'nota', 'note']],
  ['city', ['ciudad', 'city', 'ville', 'cidade']],
  ['country', ['pais', 'country', 'pays']],
  ['street', ['calle', 'direccion', 'street', 'address', 'adresse', 'rua', 'endereco', 'linea']],
  ['zip', ['postal', 'zip', 'cp', 'cep']],
  ['slug', ['slug']],
  ['currency', ['moneda', 'currency', 'devise', 'moeda']],
  ['color', ['color', 'colour', 'couleur', 'cor']],
  ['first', ['nombre', 'name', 'first', 'nom', 'prenom', 'nome']],
];

const GUESS = {
  email: (w: Words, rng: Rng) => `${ascii(pick(rng, w.first))}.${ascii(pick(rng, w.last))}${int(rng, 1, 99)}@${w.domain}`.replace(/\s+/g, ''),
  phone: (_: Words, rng: Rng) => `+57 3${int(rng, 0, 2)}${int(rng, 0, 9)} ${int(rng, 100, 999)} ${int(rng, 1000, 9999)}`,
  url: (w: Words, rng: Rng) => `https://${w.domain}/${ascii(pick(rng, w.words))}/${int(rng, 1, 999)}`,
  last: (w: Words, rng: Rng) => pick(rng, w.last),
  fullName: (w: Words, rng: Rng) => `${pick(rng, w.first)} ${pick(rng, w.last)}`,
  title: (w: Words, rng: Rng) => pick(rng, w.titles),
  text: (w: Words, rng: Rng) => `${pick(rng, w.sentence)} ${pick(rng, w.sentence).toLowerCase()}.`,
  city: (w: Words, rng: Rng) => pick(rng, w.cities),
  country: (w: Words, rng: Rng) => pick(rng, w.countries),
  street: (w: Words, rng: Rng) => w.street(int(rng, 1, 180)),
  zip: (_: Words, rng: Rng) => String(int(rng, 10000, 99999)),
  slug: (w: Words, rng: Rng) => `${ascii(pick(rng, w.words))}-${ascii(pick(rng, w.words))}-${int(rng, 1, 99)}`,
  currency: (_: Words, rng: Rng) => pick(rng, ['COP', 'EUR', 'USD', 'BRL', 'MXN']),
  color: (_: Words, rng: Rng) => `#${int(rng, 0, 0xffffff).toString(16).padStart(6, '0')}`,
  first: (w: Words, rng: Rng) => pick(rng, w.first),
};

const guessKind = (name: string) => {
  const key = ascii(name).replace(/[^a-z]/g, '');
  for (const [kind, frags] of KEYS) if (frags.some((f) => key === f || key.includes(f))) return kind;
  return undefined;
};

/* Strings that match a regular expression: classes, ranges, quantifiers, groups and alternation. */

type Node = { kind: 'set'; chars: string[] } | { kind: 'seq'; items: Quant[] } | { kind: 'alt'; options: Node[] };
type Quant = { node: Node; min: number; max: number };

const range = (from: string, to: string) => {
  const out: string[] = [];
  for (let c = from.charCodeAt(0); c <= to.charCodeAt(0); c += 1) out.push(String.fromCharCode(c));
  return out;
};

const DIGITS = range('0', '9');
const WORD = [...range('a', 'z'), ...range('A', 'Z'), ...DIGITS, '_'];
const PRINTABLE = [...range('a', 'z'), ...DIGITS];

const parseRegex = (source: string): Node => {
  let i = 0;
  const escape = (c: string): string[] => {
    if (c === 'd') return DIGITS;
    if (c === 'w') return WORD;
    if (c === 's') return [' '];
    if (c === 'D' || c === 'W' || c === 'S') return ['-'];
    return [c];
  };
  const parseClass = (): string[] => {
    i += 1;
    const negate = source[i] === '^';
    if (negate) i += 1;
    const chars: string[] = [];
    while (i < source.length && source[i] !== ']') {
      let c = source[i];
      if (c === '\\') {
        chars.push(...escape(source[i + 1]));
        i += 2;
        continue;
      }
      if (source[i + 1] === '-' && source[i + 2] && source[i + 2] !== ']') {
        chars.push(...range(c, source[i + 2]));
        i += 3;
        continue;
      }
      chars.push(c);
      i += 1;
      c = '';
    }
    i += 1;
    return negate ? PRINTABLE.filter((c) => !chars.includes(c)) : chars;
  };
  const parseAlt = (): Node => {
    const options: Node[] = [parseSeq()];
    while (source[i] === '|') {
      i += 1;
      options.push(parseSeq());
    }
    return options.length === 1 ? options[0] : { kind: 'alt', options };
  };
  const parseSeq = (): Node => {
    const items: Quant[] = [];
    while (i < source.length && source[i] !== '|' && source[i] !== ')') {
      const c = source[i];
      let node: Node | undefined;
      if (c === '^' || c === '$') {
        i += 1;
        continue;
      }
      if (c === '(') {
        i += 1;
        if (source[i] === '?') i += 2;
        node = parseAlt();
        i += 1;
      } else if (c === '[') node = { kind: 'set', chars: parseClass() };
      else if (c === '\\') {
        node = { kind: 'set', chars: escape(source[i + 1]) };
        i += 2;
      } else if (c === '.') {
        node = { kind: 'set', chars: PRINTABLE };
        i += 1;
      } else {
        node = { kind: 'set', chars: [c] };
        i += 1;
      }
      let min = 1;
      let max = 1;
      const q = source[i];
      if (q === '*') [min, max, i] = [0, 3, i + 1];
      else if (q === '+') [min, max, i] = [1, 4, i + 1];
      else if (q === '?') [min, max, i] = [0, 1, i + 1];
      else if (q === '{') {
        const end = source.indexOf('}', i);
        const [a, b] = source.slice(i + 1, end).split(',');
        min = Number(a) || 0;
        max = b === undefined ? min : b === '' ? min + 3 : Number(b);
        i = end + 1;
      }
      if (source[i] === '?') i += 1;
      items.push({ node, min, max });
    }
    return { kind: 'seq', items };
  };
  return parseAlt();
};

const render = (node: Node, rng: Rng): string => {
  if (node.kind === 'set') return node.chars.length ? pick(rng, node.chars) : '';
  if (node.kind === 'alt') return render(pick(rng, node.options), rng);
  return node.items.map(({ node: n, min, max }) => Array.from({ length: int(rng, min, max) }, () => render(n, rng)).join('')).join('');
};

/** A string that matches the pattern, or undefined when the generator cannot produce one. */
export const stringForPattern = (pattern: string, rng: Rng): string | undefined => {
  try {
    const re = new RegExp(pattern);
    const tree = parseRegex(pattern);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const value = render(tree, rng);
      if (re.test(value)) return value;
    }
  } catch {
    /* invalid pattern */
  }
  return undefined;
};

/* Values */

export const randomObjectId = (rng: Rng) => {
  // Real ObjectIds start with a timestamp, so generated ids sort roughly by creation.
  const seconds = Math.floor(Date.UTC(2025, 0, 1) / 1000) + int(rng, 0, 30_000_000);
  return seconds.toString(16).padStart(8, '0') + Array.from({ length: 16 }, () => int(rng, 0, 15).toString(16)).join('');
};

const randomUuid = (rng: Rng) => {
  const hex = (n: number) => Array.from({ length: n }, () => int(rng, 0, 15).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${pick(rng, ['8', '9', 'a', 'b'])}${hex(3)}-${hex(12)}`;
};

const randomDate = (rng: Rng, field: Field) => {
  const min = field.minimum ?? Date.UTC(2024, 0, 1);
  const max = field.maximum ?? Date.UTC(2026, 10, 1);
  return new Date(int(rng, Math.min(min, max), Math.max(min, max))).toISOString();
};

export type GenerateContext = {
  engine: EngineId;
  rng: Rng;
  locale: Locale;
  /** Most elements in a generated array. */
  maxArray: number;
  /** Ids available in each collection, for references. */
  ids: Map<string, string[]>;
  /** Firestore references are written as paths. */
  paths: Map<string, string>;
};

const numberIn = (rng: Rng, field: Field, integer: boolean) => {
  const min = field.minimum ?? (integer ? 0 : 0);
  const max = field.maximum ?? (integer ? Math.max(min + 100, 100) : Math.max(min + 500, 500));
  const low = field.exclusiveMin ? min + (integer ? 1 : 0.01) : min;
  if (integer) return int(rng, Math.ceil(low), Math.floor(max));
  return Math.round((low + rng() * (max - low)) * 100) / 100;
};

const stringFor = (field: Field, name: string, ctx: GenerateContext) => {
  const { rng } = ctx;
  if (field.pattern) {
    const value = stringForPattern(field.pattern, rng);
    if (value !== undefined) return value;
  }
  const words = DATA[ctx.locale] ?? DATA.es;
  const kind = guessKind(name);
  let value = kind ? GUESS[kind](words, rng) : `${pick(rng, words.words)} ${pick(rng, words.words)}`;
  if (field.maxLength !== undefined && value.length > field.maxLength) value = value.slice(0, field.maxLength);
  if (field.minLength !== undefined) while (value.length < field.minLength) value += pick(rng, words.words).slice(0, field.minLength - value.length);
  return value;
};

const referenceValue = (field: Field, ctx: GenerateContext) => {
  const target = field.reference?.collectionId;
  const ids = target ? ctx.ids.get(target) : undefined;
  if (!ids || ids.length === 0) return undefined;
  const id = pick(ctx.rng, ids);
  if (ctx.engine === 'firestore') return `${ctx.paths.get(target!) ?? ''}/${id}`.replace(/^\//, '');
  return id;
};

/** A value for a field, honoring its type and constraints. `undefined` leaves an optional field out. */
export const randomFieldValue = (field: Field, name: string, ctx: GenerateContext, depth = 0): unknown => {
  const { rng } = ctx;
  if (field.nullable && rng() < 0.08) return null;
  if (field.reference) {
    const ref = referenceValue(field, ctx);
    if (ref !== undefined) return ref;
    return field.required ? (ctx.engine === 'mongodb' ? randomObjectId(rng) : randomUuid(rng)) : undefined;
  }
  switch (field.type) {
    case 'string':
      return stringFor(field, name, ctx);
    case 'enum':
      return field.enumValues?.length ? pick(rng, field.enumValues) : stringFor(field, name, ctx);
    case 'int':
    case 'long':
      return numberIn(rng, field, true);
    case 'double':
    case 'number':
      return numberIn(rng, field, false);
    case 'decimal':
      return ctx.engine === 'couchdb' ? numberIn(rng, field, false).toFixed(2) : numberIn(rng, field, false);
    case 'bool':
      return rng() < 0.5;
    case 'date':
    case 'timestamp':
      return randomDate(rng, field);
    case 'objectId':
      return randomObjectId(rng);
    case 'reference':
      return ctx.engine === 'mongodb' ? randomObjectId(rng) : randomUuid(rng);
    case 'uuid':
      return randomUuid(rng);
    case 'binary':
      return btoa(String(int(rng, 100000, 999999)));
    case 'null':
      return null;
    case 'any':
      return stringFor(field, name, ctx);
    case 'geoPoint': {
      const lat = Math.round((-35 + rng() * 60) * 1e5) / 1e5;
      const lng = Math.round((-80 + rng() * 85) * 1e5) / 1e5;
      if (ctx.engine === 'mongodb') return { type: 'Point', coordinates: [lng, lat] };
      if (ctx.engine === 'firestore') return { latitude: lat, longitude: lng };
      return { lat, lng };
    }
    case 'object':
      return randomObject(field.children ?? [], ctx, depth + 1);
    case 'array': {
      const min = field.minItems ?? 0;
      const max = Math.max(min, Math.min(field.maxItems ?? ctx.maxArray, ctx.maxArray));
      const count = int(rng, min, max);
      if (!field.items) return [];
      const out: unknown[] = [];
      const seen = new Set<string>();
      for (let i = 0; i < count * 3 && out.length < count; i += 1) {
        const value = randomFieldValue({ ...field.items, nullable: false }, name, ctx, depth + 1);
        if (value === undefined) break;
        const key = JSON.stringify(value);
        if (field.uniqueItems && seen.has(key)) continue;
        seen.add(key);
        out.push(value);
      }
      return out;
    }
    default:
      return null;
  }
};

export const randomObject = (fields: Field[], ctx: GenerateContext, depth = 0): JsonObject => {
  const out: JsonObject = {};
  for (const field of fields) {
    if (!field.name || field.name === '_rev') continue;
    if (!field.required && ctx.rng() < 0.15) continue;
    const value = randomFieldValue(field, field.name, ctx, depth);
    if (value !== undefined) out[field.name] = value;
  }
  return out;
};

export type GenerateOptions = { count: number; locale: Locale; maxArray?: number; rng?: Rng };

const initialIds = (project: Project) => {
  const ids = new Map<string, string[]>();
  for (const c of project.collections) ids.set(c.id, [...documentIds(project, c.id)]);
  return ids;
};

/** Values of unique indexes already used, so generated documents do not collide. */
const usedUniqueValues = (project: Project, collection: Collection) => {
  const paths = collection.indexes.filter((i) => i.unique && i.keys.length === 1 && !i.keys[0].path.includes('[]')).map((i) => i.keys[0].path);
  const used = new Map(paths.map((p) => [p, new Set<string>()]));
  for (const doc of project.documents?.[collection.id] ?? []) {
    const value = parseDocument(doc).value;
    for (const p of paths) {
      const v = p.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as JsonObject)[k] : undefined), value);
      if (v !== undefined) used.get(p)!.add(JSON.stringify(v));
    }
  }
  return used;
};

const setPath = (obj: JsonObject, path: string, value: unknown) => {
  const parts = path.split('.');
  let target: JsonObject = obj;
  for (const part of parts.slice(0, -1)) {
    if (!target[part] || typeof target[part] !== 'object') return;
    target = target[part] as JsonObject;
  }
  target[parts.at(-1)!] = value;
};

/** New sample documents for one collection, appended after the existing ones. */
export const generateDocuments = (project: Project, collectionId: string, options: GenerateOptions, ids = initialIds(project)): SampleDocument[] => {
  const collection = project.collections.find((c) => c.id === collectionId);
  if (!collection) return [];
  const rng = options.rng ?? Math.random;
  const paths = new Map(project.collections.map((c) => [c.id, c.name]));
  const ctx: GenerateContext = { engine: project.engine, rng, locale: options.locale, maxArray: options.maxArray ?? 5, ids, paths };
  const used = usedUniqueValues(project, collection);
  const idField = collection.fields.find((f) => f.name === ID_KEY);
  const docs: SampleDocument[] = [];
  const own = ids.get(collection.id) ?? [];
  for (let n = 0; n < options.count; n += 1) {
    const value = randomObject(collection.fields, ctx);
    // Unique fields get a suffix until they are free.
    for (const [path, set] of used) {
      const field = collection.fields.find((f) => f.name === path.split('.')[0]);
      let current = path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as JsonObject)[k] : undefined), value);
      let tries = 0;
      while (current !== undefined && set.has(JSON.stringify(current)) && tries < 50) {
        current = typeof current === 'string' ? `${current.replace(/\d+$/, '')}${int(rng, 2, 9999)}` : typeof current === 'number' ? current + int(rng, 1, 1000) : current;
        if (typeof current === 'string' && current.includes('@')) current = current.replace(/^([^@]+?)(\d*)@/, `$1${int(rng, 100, 9999)}@`);
        tries += 1;
      }
      if (current !== undefined && field) {
        setPath(value, path, current);
        set.add(JSON.stringify(current));
      }
    }
    const taken = new Set(own);
    let id = '';
    for (let attempt = 0; attempt === 0 || taken.has(id); attempt += 1) {
      if (project.engine === 'mongodb') id = idField?.type === 'string' ? `${collection.name}-${own.length + 1 + attempt}` : idField?.type === 'uuid' ? randomUuid(rng) : randomObjectId(rng);
      else if (project.engine === 'couchdb') id = `${collection.name}:${randomUuid(rng).slice(0, 8)}`;
      else id = randomObjectId(rng).slice(4, 24);
    }
    // The id is chosen here so references can point at it; the random value for _id is dropped.
    delete value[ID_KEY];
    const ordered: JsonObject = { [ID_KEY]: id, ...value };
    if (project.engine === 'couchdb') {
      delete ordered._rev;
      ordered[collection.options.typeDiscriminator?.field?.trim() || 'type'] = collection.options.typeDiscriminator?.value?.trim() || collection.name;
    }
    own.push(id);
    docs.push({ id: uid(), json: JSON.stringify(ordered, null, 2) });
  }
  ids.set(collection.id, own);
  return docs;
};

/** Documents for every collection, referenced collections first so references point at real ids. */
export const generateAllDocuments = (project: Project, options: GenerateOptions) => {
  const ids = initialIds(project);
  const out: Record<string, SampleDocument[]> = {};
  for (const collection of topologicalOrder(project)) out[collection.id] = generateDocuments(project, collection.id, options, ids);
  return out;
};
