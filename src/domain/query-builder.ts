import { t } from '../i18n';
import { ID_KEY } from './engines';
import { docIdParam } from './model';
import { discriminator } from './outputs/couchdb';
import { jsLiteral, RawJs } from './outputs/shared';
import { toMongoPath, walkFields } from './paths';
import type { Collection, Field, Project } from './types';

/**
 * Query builder: a base collection, the references to resolve (also from the collections already
 * joined), the fields to return, a filter written as MongoDB JSON, sort, skip and limit. The same
 * description becomes an aggregation pipeline in MongoDB, SDK code in Firestore and a Mango query
 * in CouchDB.
 */

export type JoinMode = 'left' | 'inner';

export type QuerySpec = {
  rootId?: string;
  /** Ids of the references to resolve, see `joinOptions`. */
  joins: string[];
  modes?: Record<string, JoinMode>;
  /** Fields to return by part of the query ('' is the base collection, else a join id). Missing means all. */
  fields?: Record<string, string[]>;
  filter?: string;
  sortPath?: string;
  sortOrder?: 1 | -1;
  skip?: number;
  /** 0 means no limit. */
  limit: number;
};

export const EMPTY_QUERY: QuerySpec = { joins: [], limit: 0 };

export type JoinOption = {
  /** Path of the reference, prefixed by the parent join id when it hangs from another join. */
  id: string;
  parentId: string | null;
  from: Collection;
  /** Path in the interface form (items[].productoId). */
  path: string;
  target: Collection;
  /** Resolves to many documents: an array of references or a reference inside an array. */
  many: boolean;
  /** Field that receives the referenced documents. */
  as: string;
  field: Field;
};

const MAX_DEPTH = 3;

const lastSegment = (path: string) => toMongoPath(path).split('.').pop() ?? path;

const aliasFor = (path: string, target: Collection, many: boolean) => {
  if (many) return target.name;
  const base = lastSegment(path).replace(/(_ids?|Ids?)$/, '');
  return base && base !== lastSegment(path) ? base : `${lastSegment(path)}Doc`;
};

/** References that can be resolved from the base collection and from the single joins already chosen. */
export const joinOptions = (project: Project, spec: QuerySpec): JoinOption[] => {
  const root = project.collections.find((c) => c.id === spec.rootId);
  if (!root) return [];
  const options: JoinOption[] = [];
  const queue: { id: string | null; collection: Collection; prefix: string; depth: number; taken: Set<string> }[] = [
    { id: null, collection: root, prefix: '', depth: 0, taken: new Set(root.fields.map((f) => f.name)) },
  ];
  while (queue.length) {
    const { id: parentId, collection, prefix, depth, taken } = queue.shift()!;
    for (const { path, field, inArray } of walkFields(collection.fields)) {
      const holder = field.type === 'array' ? field.items : field;
      const targetId = holder?.reference?.collectionId;
      const target = targetId && project.collections.find((c) => c.id === targetId);
      if (!target) continue;
      const many = field.type === 'array' || inArray;
      let as = aliasFor(path, target, many);
      for (let i = 2; taken.has(as); i += 1) as = `${aliasFor(path, target, many)}${i}`;
      taken.add(as);
      const id = parentId ? `${parentId}/${path}` : path;
      const option: JoinOption = { id, parentId, from: collection, path, target, many, as: prefix ? `${prefix}.${as}` : as, field };
      options.push(option);
      // A single joined document can be followed further; arrays stop here to keep the result readable.
      if (!many && depth + 1 < MAX_DEPTH && spec.joins.includes(id)) {
        queue.push({ id, collection: target, prefix: option.as, depth: depth + 1, taken: new Set(target.fields.map((f) => f.name)) });
      }
    }
  }
  return options;
};

/** Paths a filter, a sort or a projection can use, in MongoDB notation, with their field. */
export type QueryPath = { path: string; field: Field; inArray: boolean };

export const queryPaths = (collection: Collection, prefix = ''): QueryPath[] =>
  walkFields(collection.fields).map(({ path, field, inArray }) => ({ path: (prefix ? `${prefix}.` : '') + toMongoPath(path), field, inArray }));

export type FilterParse = { value?: Record<string, unknown>; error?: string };

export const parseFilter = (text: string | undefined): FilterParse => {
  if (!text?.trim()) return {};
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: t('query.filterObject') };
    return { value: value as Record<string, unknown> };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
};

/** Field paths named in a filter, skipping operators. */
export const filterKeys = (value: unknown, out: string[] = []): string[] => {
  if (Array.isArray(value)) value.forEach((v) => filterKeys(v, out));
  else if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      if (!key.startsWith('$')) out.push(key);
      if (key === '$elemMatch') continue;
      filterKeys(v, out);
    }
  }
  return out;
};

const isPlainObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Replaces Extended JSON wrappers ({"$oid"}, {"$date"}) with what each engine writes. */
const mapEjson = (value: unknown, map: (kind: '$oid' | '$date' | '$numberDecimal', text: string) => unknown): unknown => {
  if (Array.isArray(value)) return value.map((v) => mapEjson(v, map));
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1 && ['$oid', '$date', '$numberDecimal'].includes(keys[0]) && typeof value[keys[0]] === 'string') {
      return map(keys[0] as '$oid', value[keys[0]] as string);
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapEjson(v, map)]));
  }
  return value;
};

export type QueryResult = {
  code: string;
  language: 'js' | 'ts' | 'sh';
  fileName: string;
  warnings: string[];
  /** Firestore composite index the query needs, when the model does not have it yet. */
  missingIndex?: { collectionId: string; keys: { path: string; order: 1 | -1 }[] };
};

type Built = { root: Collection; joins: JoinOption[]; filter: FilterParse; spec: QuerySpec };

const prepare = (project: Project, spec: QuerySpec): Built | undefined => {
  const root = project.collections.find((c) => c.id === spec.rootId);
  if (!root) return undefined;
  const options = joinOptions(project, spec);
  // Joins deleted from the model, or whose parent was dropped, leave the query.
  const joins = options.filter((o) => spec.joins.includes(o.id));
  return { root, joins, filter: parseFilter(spec.filter), spec };
};

const chosenFields = (spec: QuerySpec, key: string) => spec.fields?.[key];

/* MongoDB */

const shellName = (name: string) => (/^[A-Za-z_$][\w$]*$/.test(name) ? `db.${name}` : `db.getCollection(${JSON.stringify(name)})`);

const toShell = (value: unknown) =>
  mapEjson(value, (kind, text) =>
    new RawJs(kind === '$oid' ? `ObjectId(${JSON.stringify(text)})` : kind === '$date' ? `ISODate(${JSON.stringify(text)})` : `NumberDecimal(${JSON.stringify(text)})`),
  );

const mongoProjection = ({ spec, joins }: Built) => {
  const parts: [string, string[] | undefined][] = [['', chosenFields(spec, '')], ...joins.map((j) => [j.as, chosenFields(spec, j.id)] as [string, string[] | undefined])];
  if (parts.every(([, fields]) => !fields)) return undefined;
  const projection: Record<string, 1> = {};
  const rootFields = chosenFields(spec, '');
  for (const f of rootFields ?? []) projection[f] = 1;
  for (const j of joins) {
    const fields = chosenFields(spec, j.id);
    // Without a choice the whole joined document comes back.
    if (!fields) projection[j.as] = 1;
    else for (const f of fields) projection[`${j.as}.${f}`] = 1;
  }
  // Only joins restricted: keep every root field by listing them.
  if (!rootFields) return { projection, keepRoot: true };
  return { projection, keepRoot: false };
};

export const mongoQuery = (project: Project, spec: QuerySpec): QueryResult | undefined => {
  const built = prepare(project, spec);
  if (!built) return undefined;
  const { root, joins, filter } = built;
  const warnings: string[] = [];
  if (filter.error) warnings.push(t('query.filterInvalid', { error: filter.error }));
  const match = filter.value && Object.keys(filter.value).length ? toShell(filter.value) : undefined;
  const projection = mongoProjection(built);
  const sort = spec.sortPath ? { [spec.sortPath]: spec.sortOrder ?? 1 } : undefined;
  const header = `// ${root.name}${project.databaseName ? `\nuse(${JSON.stringify(project.databaseName)});` : ''}`;

  if (joins.length === 0) {
    const args = [jsLiteral(match ?? {})];
    if (projection) args.push(jsLiteral(projection.projection));
    let code = `${shellName(root.name)}.find(${args.join(', ')})`;
    if (sort) code += `\n  .sort(${jsLiteral(sort)})`;
    if (spec.skip) code += `\n  .skip(${spec.skip})`;
    if (spec.limit) code += `\n  .limit(${spec.limit})`;
    return { code: `${header}\n${code};\n`, language: 'js', fileName: `${root.name}.query.js`, warnings };
  }

  const aliases = joins.map((j) => j.as);
  // Conditions on the base collection go first so they can use its indexes.
  const keys = filter.value ? filterKeys(filter.value) : [];
  const late = keys.some((k) => aliases.some((a) => k === a || k.startsWith(`${a}.`)));
  const stages: unknown[] = [];
  if (match && !late) stages.push({ $match: match });
  for (const join of joins) {
    const parent = join.parentId ? joins.find((j) => j.id === join.parentId) : undefined;
    const localField = parent ? `${parent.as}.${toMongoPath(join.path)}` : toMongoPath(join.path);
    stages.push({ $lookup: { from: join.target.name, localField, foreignField: ID_KEY, as: join.as } });
    if (!join.many) stages.push({ $unwind: { path: `$${join.as}`, preserveNullAndEmptyArrays: (spec.modes?.[join.id] ?? 'left') === 'left' } });
  }
  if (match && late) stages.push({ $match: match });
  if (projection) {
    if (projection.keepRoot) {
      // $project with only joined paths would drop the base fields, so they are listed too.
      for (const f of root.fields) if (!aliases.includes(f.name)) projection.projection[f.name] = 1;
    }
    stages.push({ $project: projection.projection });
  }
  if (sort) stages.push({ $sort: sort });
  if (spec.skip) stages.push({ $skip: spec.skip });
  if (spec.limit) stages.push({ $limit: spec.limit });
  return { code: `${header}\n${shellName(root.name)}.aggregate(${jsLiteral(stages)});\n`, language: 'js', fileName: `${root.name}.aggregate.js`, warnings };
};

/* Firestore */

const FIRESTORE_OPS: Record<string, string> = { $eq: '==', $ne: '!=', $gt: '>', $gte: '>=', $lt: '<', $lte: '<=', $in: 'in', $nin: 'not-in' };
const RANGE_OPS = new Set(['!=', '>', '>=', '<', '<=', 'not-in']);

type Condition = { path: string; op: string; value: unknown };
type Tree = { kind: 'and' | 'or'; items: (Tree | Condition)[] };

const fieldOf = (paths: QueryPath[], path: string) => paths.find((p) => p.path === path);

const firestoreConditions = (value: Record<string, unknown>, paths: QueryPath[], warnings: string[]): Tree => {
  const items: (Tree | Condition)[] = [];
  for (const [key, v] of Object.entries(value)) {
    if (key === '$and' || key === '$or') {
      const list = Array.isArray(v) ? v.filter(isPlainObject) : [];
      items.push({ kind: key === '$and' ? 'and' : 'or', items: list.map((x) => firestoreConditions(x, paths, warnings)) });
      continue;
    }
    if (key.startsWith('$')) {
      warnings.push(t('query.firestoreUnsupported', { operator: key }));
      continue;
    }
    const isArray = fieldOf(paths, key)?.field.type === 'array';
    const operators = isPlainObject(v) && Object.keys(v).some((k) => k.startsWith('$')) && !('$date' in v || '$oid' in v) ? v : undefined;
    if (!operators) {
      items.push({ path: key, op: isArray ? 'array-contains' : '==', value: v });
      continue;
    }
    for (const [op, operand] of Object.entries(operators)) {
      if (op === '$in' && isArray) items.push({ path: key, op: 'array-contains-any', value: operand });
      else if (op === '$all' && Array.isArray(operand) && operand.length === 1) items.push({ path: key, op: 'array-contains', value: operand[0] });
      else if (op === '$exists' && operand === true) items.push({ path: key, op: '!=', value: null });
      else if (FIRESTORE_OPS[op]) items.push({ path: key, op: FIRESTORE_OPS[op], value: operand });
      else warnings.push(t('query.firestoreUnsupported', { operator: op }));
    }
  }
  return { kind: 'and', items };
};

const flatConditions = (tree: Tree): Condition[] => tree.items.flatMap((i) => ('items' in i ? flatConditions(i) : [i]));

const firestoreValue = (value: unknown, field: Field | undefined, refTarget: Collection | undefined) => {
  const mapped = mapEjson(value, (kind, text) => (kind === '$date' ? new RawJs(`Timestamp.fromDate(new Date(${JSON.stringify(text)}))`) : text));
  // A reference field holds a DocumentReference, so ids become doc(...) calls.
  const asRef = (v: unknown) => (typeof v === 'string' && refTarget ? new RawJs(`doc(db, ${JSON.stringify(refTarget.name)}, ${JSON.stringify(v)})`) : v);
  const isRef = field?.type === 'reference' || field?.items?.type === 'reference';
  if (!isRef) return mapped;
  return Array.isArray(mapped) ? mapped.map(asRef) : asRef(mapped);
};

export const firestoreQuery = (project: Project, spec: QuerySpec): QueryResult | undefined => {
  const built = prepare(project, spec);
  if (!built) return undefined;
  const { root, joins, filter } = built;
  const warnings: string[] = [];
  if (filter.error) warnings.push(t('query.filterInvalid', { error: filter.error }));
  const paths = queryPaths(root);
  const tree = filter.value ? firestoreConditions(filter.value, paths, warnings) : { kind: 'and' as const, items: [] };

  const refTarget = (path: string) => {
    const field = fieldOf(paths, path)?.field;
    const id = (field?.reference ?? field?.items?.reference)?.collectionId;
    return id ? project.collections.find((c) => c.id === id) : undefined;
  };
  const whereCall = (c: Condition) => `where(${JSON.stringify(c.path)}, ${JSON.stringify(c.op)}, ${jsLiteral(firestoreValue(c.value, fieldOf(paths, c.path)?.field, refTarget(c.path)), 2)})`;
  const render = (node: Tree | Condition, indent: string): string => {
    if (!('items' in node)) return whereCall(node);
    const inner = node.items.map((i) => `${indent}  ${render(i, `${indent}  `)}`).join(',\n');
    return `${node.kind}(\n${inner},\n${indent})`;
  };
  const composite = tree.items.some((i) => 'items' in i);
  const constraints = composite ? [render(tree, '  ')] : tree.items.map((i) => render(i, '  '));
  if (spec.sortPath) constraints.push(`orderBy(${JSON.stringify(spec.sortPath)}, ${JSON.stringify(spec.sortOrder === -1 ? 'desc' : 'asc')})`);
  if (spec.limit) constraints.push(`limit(${spec.limit})`);
  if (spec.skip) warnings.push(t('query.firestoreSkip'));

  // Collection path, with the parent ids of a subcollection as parameters.
  const chain: Collection[] = [];
  for (let c: Collection | undefined = root; c; c = c.kind === 'subcollection' ? project.collections.find((p) => p.id === c!.parentId) : undefined) chain.unshift(c);
  const params = chain.slice(0, -1).map((c) => docIdParam(c));
  const segments = chain.flatMap((c, i) => (i < chain.length - 1 ? [JSON.stringify(c.name), docIdParam(c)] : [JSON.stringify(c.name)]));

  const conditions = flatConditions(tree);
  const used = new Set(['collection', 'query', 'getDocs']);
  if (conditions.length) used.add('where');
  if (composite) tree.items.forEach(function mark(i) {
    if ('items' in i) {
      used.add(i.kind);
      i.items.forEach(mark);
    }
  });
  if (composite) used.add('and');
  if (spec.sortPath) used.add('orderBy');
  if (spec.limit) used.add('limit');
  const code = [
    '',
    `export const run${root.name.replace(/[^A-Za-z0-9]/g, '').replace(/^./, (c) => c.toUpperCase())}Query = async (db: Firestore${params.map((p) => `, ${p}: string`).join('')}) => {`,
    `  const q = query(\n    collection(db, ${segments.join(', ')}),\n${constraints.map((c) => `    ${c.replace(/\n/g, '\n  ')}`).join(',\n')}${constraints.length ? ',' : ''}\n  );`,
    '  const snapshot = await getDocs(q);',
  ];
  const rootFields = chosenFields(spec, '');
  const pick = (source: string, fields: string[] | undefined) =>
    fields ? `{ ${fields.map((f) => `${/^[A-Za-z_$][\w$]*$/.test(f) ? f : JSON.stringify(f)}: ${source}${/^[A-Za-z_$][\w$]*$/.test(f) ? `.${f}` : `[${JSON.stringify(f)}]`}`).join(', ')} }` : source;
  if (joins.length === 0) {
    code.push(`  return snapshot.docs.map((d) => {`, `    const data = d.data();`, `    return { id: d.id, ...${pick('data', rootFields)} };`, '  });', '};');
  } else {
    code.push(`  // ${t('query.firestoreJoins')}`, '  const rows = await Promise.all(', '    snapshot.docs.map(async (d) => {', '      const data = d.data();');
    used.add('getDoc');
    const varOf = new Map<string, string>();
    for (const join of joins) {
      const name = join.as.split('.').pop()!.replace(/[^A-Za-z0-9_$]/g, '_');
      varOf.set(join.id, name);
      const parentVar = join.parentId ? `${varOf.get(join.parentId)}?` : 'data';
      const holder = join.field.type === 'array' ? join.field.items : join.field;
      const isRef = holder?.type === 'reference';
      if (!isRef) used.add('doc');
      const read = (ref: string) => (isRef ? `getDoc(${ref})` : `getDoc(doc(db, ${JSON.stringify(join.target.name)}, ${ref}))`);
      const segs = toMongoPath(join.path).split('.');
      if (!join.many) {
        const access = `${parentVar}.${segs.join('?.')}`;
        code.push(`      const ${name} = ${access} ? ({ id: ${access}${isRef ? '.id' : ''}, ...(await ${read(access)}).data() }) : null;`);
      } else {
        // Every id in the array, or in each element of the array of subdocuments.
        const arrayIndex = walkFields(join.from.fields).find((e) => e.path === join.path);
        const inside = join.path.includes('[]') && arrayIndex?.inArray;
        const [arrayPath, rest] = inside ? join.path.split('[].') : [join.path, ''];
        const refs = inside ? `(${parentVar}.${arrayPath} ?? []).map((item) => item.${rest.split('.').join('?.')}).filter(Boolean)` : `${parentVar}.${segs.join('?.')} ?? []`;
        code.push(`      const ${name} = await Promise.all((${refs}).map(async (ref) => ({ id: ref${isRef ? '.id' : ''}, ...(await ${read('ref')}).data() })));`);
      }
    }
    const parts = [`id: d.id`, `...${pick('data', rootFields)}`, ...joins.map((j) => varOf.get(j.id)!)];
    code.push(`      return { ${parts.join(', ')} };`, '    }),', '  );');
    const inner = joins.filter((j) => !j.many && !j.parentId && (spec.modes?.[j.id] ?? 'left') === 'inner');
    code.push(inner.length ? `  return rows.filter((row) => ${inner.map((j) => `row.${varOf.get(j.id)}`).join(' && ')});` : '  return rows;', '};');
  }
  if (rootFields) warnings.push(t('query.firestoreProjection'));
  const header = `import { ${[...used].sort().join(', ')}, type Firestore${conditions.some((c) => /Timestamp/.test(whereCall(c))) ? ', Timestamp' : ''} } from 'firebase/firestore';\n`;

  // Composite index: equality filters first, then the inequality or array filter, then the sort.
  const equality = conditions.filter((c) => c.op === '==' || c.op === 'in').map((c) => c.path);
  const ranges = conditions.filter((c) => RANGE_OPS.has(c.op) || c.op.startsWith('array-contains')).map((c) => c.path);
  const keys: { path: string; order: 1 | -1 }[] = [];
  for (const p of [...equality, ...ranges]) if (!keys.some((k) => k.path === p)) keys.push({ path: p, order: 1 });
  if (spec.sortPath) {
    const existing = keys.find((k) => k.path === spec.sortPath);
    if (existing) existing.order = spec.sortOrder ?? 1;
    else keys.push({ path: spec.sortPath, order: spec.sortOrder ?? 1 });
  }
  const needsIndex = keys.length > 1 && (ranges.length > 0 || Boolean(spec.sortPath) || composite);
  const hasIndex = root.indexes.some((i) => i.keys.length === keys.length && i.keys.every((k, n) => toMongoPath(k.path) === keys[n].path && (k.order === keys[n].order || fieldOf(paths, keys[n].path)?.field.type === 'array')));
  const missingIndex = needsIndex && !hasIndex ? { collectionId: root.id, keys } : undefined;
  if (needsIndex) warnings.push(hasIndex ? t('query.indexPresent') : t('query.indexNeeded', { fields: keys.map((k) => `${k.path} ${k.order === -1 ? 'desc' : 'asc'}`).join(', ') }));
  return { code: header + code.join('\n') + '\n', language: 'ts', fileName: `${root.name}.query.ts`, warnings, missingIndex };
};

/* CouchDB */

export const couchQuery = (project: Project, spec: QuerySpec): QueryResult | undefined => {
  const built = prepare(project, spec);
  if (!built) return undefined;
  const { root, joins, filter } = built;
  const warnings: string[] = [];
  if (filter.error) warnings.push(t('query.filterInvalid', { error: filter.error }));
  const { field: typeField, value: typeValue } = discriminator(root);
  const user = filter.value ? (mapEjson(filter.value, (_kind, text) => text) as Record<string, unknown>) : {};
  // Documents of every "collection" share the database, so the type field is always part of the selector.
  const selector = typeField in user ? { $and: [{ [typeField]: typeValue }, user] } : { [typeField]: typeValue, ...user };
  const body: Record<string, unknown> = { selector };
  const rootFields = chosenFields(spec, '');
  if (rootFields) {
    const fields = new Set([ID_KEY, ...rootFields, ...joins.filter((j) => !j.parentId).map((j) => toMongoPath(j.path).split('.')[0])]);
    body.fields = [...fields];
  }
  if (spec.sortPath) {
    body.sort = [{ [spec.sortPath]: spec.sortOrder === -1 ? 'desc' : 'asc' }];
    warnings.push(t('query.mangoSort', { field: spec.sortPath }));
  }
  if (spec.limit) body.limit = spec.limit;
  if (spec.skip) body.skip = spec.skip;
  const db = project.databaseName || 'db';
  const lines = [`# ${root.name}`, `POST /${db}/_find`, 'Content-Type: application/json', '', JSON.stringify(body, null, 2), ''];
  for (const join of joins) {
    lines.push(
      `# ${join.as}: ${t('query.couchJoin', { field: toMongoPath(join.path), collection: join.target.name })}`,
      `POST /${db}/_all_docs?include_docs=true`,
      'Content-Type: application/json',
      '',
      JSON.stringify({ keys: [`<${toMongoPath(join.path)}>`] }, null, 2),
      '',
    );
  }
  return { code: lines.join('\n'), language: 'sh', fileName: `${root.name}.mango.http`, warnings };
};

export const buildQuery = (project: Project, spec: QuerySpec): QueryResult | undefined =>
  project.engine === 'mongodb' ? mongoQuery(project, spec) : project.engine === 'firestore' ? firestoreQuery(project, spec) : couchQuery(project, spec);
