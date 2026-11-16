import { t } from '../i18n';
import { parseDocument } from './documents';
import { ENGINES, ID_KEY } from './engines';
import { docIdParam } from './model';
import { modelTypeName } from './naming';
import { standardFieldSchema } from './outputs/json-schema';
import type { Collection, Project } from './types';

type JsonSchema = Record<string, unknown>;

export type OpenApiDocument = Record<string, unknown> & {
  openapi: string;
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, JsonSchema>; parameters: Record<string, unknown>; responses: Record<string, unknown> };
};

export type OpenApiOptions = { collectionIds?: string[]; serverUrl?: string; version?: string };

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: unknown) => ({ 'application/json': { schema } });
const segment = (name: string) => encodeURIComponent(name.trim().replace(/\s+/g, '_'));

const idSchema = (project: Project, collection: Collection): JsonSchema => {
  const idField = collection.fields.find((f) => f.name === ID_KEY);
  if (project.engine === 'mongodb' && (!idField || idField.type === 'objectId')) return { type: 'string', pattern: '^[a-f0-9]{24}$' };
  if (idField?.type === 'uuid') return { type: 'string', format: 'uuid' };
  if (idField && ['int', 'long'].includes(idField.type)) return { type: 'integer' };
  return { type: 'string' };
};

/** CRUD routes for each collection, with Firestore subcollections nested under their parent document. */
export const buildOpenApi = (project: Project, options: OpenApiOptions = {}): OpenApiDocument => {
  const chosen = options.collectionIds ? project.collections.filter((c) => options.collectionIds!.includes(c.id)) : project.collections;
  const used = new Set<string>();
  const names = new Map<string, string>();
  for (const c of project.collections) {
    let name = modelTypeName(project, c.name);
    for (let i = 2; used.has(name) || ['Error'].includes(name); i += 1) name = `${modelTypeName(project, c.name)}${i}`;
    used.add(name);
    names.set(c.id, name);
  }
  const doc: OpenApiDocument = {
    openapi: '3.1.0',
    info: {
      title: t('openapi.title', { project: project.name || t('common.project') }),
      version: options.version ?? '1.0.0',
      description: t('openapi.description', { engine: ENGINES[project.engine].name }),
    },
    servers: [{ url: options.serverUrl?.trim() || 'http://localhost:3000' }],
    tags: [],
    paths: {},
    components: {
      schemas: {
        Error: { type: 'object', required: ['message'], properties: { message: { type: 'string' }, details: { type: 'array', items: { type: 'string' } } } },
      },
      parameters: {
        page: { name: 'page', in: 'query', description: t('openapi.page'), schema: { type: 'integer', minimum: 1, default: 1 } },
        pageSize: { name: 'pageSize', in: 'query', description: t('openapi.pageSize'), schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
        sort: { name: 'sort', in: 'query', description: t('openapi.sort'), schema: { type: 'string' } },
      },
      responses: {
        BadRequest: { description: t('openapi.badRequest'), content: json(ref('Error')) },
        NotFound: { description: t('openapi.notFound'), content: json(ref('Error')) },
        Conflict: { description: t('openapi.conflict'), content: json(ref('Error')) },
      },
    },
  };
  const tags = doc.tags as { name: string; description?: string }[];

  const basePath = (c: Collection): { path: string; params: Record<string, unknown>[] } => {
    const parent = c.kind === 'subcollection' && c.parentId ? project.collections.find((p) => p.id === c.parentId) : undefined;
    if (!parent) return { path: `/${segment(c.name)}`, params: [] };
    const up = basePath(parent);
    const param = docIdParam(parent);
    return {
      path: `${up.path}/{${param}}/${segment(c.name)}`,
      params: [...up.params, { name: param, in: 'path', required: true, schema: idSchema(project, parent) }],
    };
  };

  for (const collection of chosen) {
    const name = names.get(collection.id)!;
    const fields = collection.fields.filter((f) => f.name && f.name !== '_rev');
    const writable = fields.filter((f) => f.name !== ID_KEY);
    const strict = collection.options.additionalProperties;
    const props = (list: typeof fields) => Object.fromEntries(list.map((f) => [f.name, standardFieldSchema(f, project.engine, strict)]));
    const examples = (project.documents?.[collection.id] ?? []).map((d) => parseDocument(d).value).filter(Boolean);
    const example = examples[0];
    const { [ID_KEY]: _id, _rev, ...exampleBody } = (example ?? {}) as Record<string, unknown>;
    void _id;
    void _rev;
    doc.components.schemas[name] = {
      type: 'object',
      required: [ID_KEY, ...writable.filter((f) => f.required).map((f) => f.name)],
      properties: { [ID_KEY]: idSchema(project, collection), ...props(writable) },
      ...(example ? { example } : {}),
    };
    doc.components.schemas[`${name}Create`] = {
      type: 'object',
      required: writable.filter((f) => f.required && !f.defaultValue).map((f) => f.name),
      properties: props(writable),
      ...(example ? { example: exampleBody } : {}),
    };
    doc.components.schemas[`${name}Update`] = { type: 'object', description: t('openapi.partial'), properties: props(writable) };
    doc.components.schemas[`${name}List`] = {
      type: 'object',
      required: ['data', 'page', 'pageSize', 'total'],
      properties: { data: { type: 'array', items: ref(name) }, page: { type: 'integer' }, pageSize: { type: 'integer' }, total: { type: 'integer' } },
    };
    tags.push({ name: collection.name, ...(collection.notes ? { description: collection.notes } : {}) });
    const { path, params } = basePath(collection);
    const refFilters = project.relationships
      .filter((r) => r.kind === 'reference' && r.from.collectionId === collection.id && !r.from.fieldPath.includes('.'))
      .map((r) => ({ name: r.from.fieldPath, in: 'query', description: t('openapi.filterBy', { field: r.from.fieldPath }), schema: { type: 'string' } }));
    doc.paths[path] = {
      ...(params.length ? { parameters: params } : {}),
      get: {
        tags: [collection.name],
        operationId: `list${name}`,
        summary: t('openapi.list', { collection: collection.name }),
        parameters: [{ $ref: '#/components/parameters/page' }, { $ref: '#/components/parameters/pageSize' }, { $ref: '#/components/parameters/sort' }, ...refFilters],
        responses: { 200: { description: t('openapi.ok'), content: json(ref(`${name}List`)) }, 400: { $ref: '#/components/responses/BadRequest' } },
      },
      post: {
        tags: [collection.name],
        operationId: `create${name}`,
        summary: t('openapi.create', { collection: collection.name }),
        requestBody: { required: true, content: json(ref(`${name}Create`)) },
        responses: {
          201: { description: t('openapi.created'), content: json(ref(name)) },
          400: { $ref: '#/components/responses/BadRequest' },
          409: { $ref: '#/components/responses/Conflict' },
        },
      },
    };
    const notFound = { $ref: '#/components/responses/NotFound' };
    doc.paths[`${path}/{id}`] = {
      parameters: [...params, { name: 'id', in: 'path', required: true, schema: idSchema(project, collection) }],
      get: {
        tags: [collection.name],
        operationId: `get${name}`,
        summary: t('openapi.get', { collection: collection.name }),
        responses: { 200: { description: t('openapi.ok'), content: json(ref(name)) }, 404: notFound },
      },
      put: {
        tags: [collection.name],
        operationId: `replace${name}`,
        summary: t('openapi.replace', { collection: collection.name }),
        requestBody: { required: true, content: json(ref(`${name}Create`)) },
        responses: { 200: { description: t('openapi.ok'), content: json(ref(name)) }, 400: { $ref: '#/components/responses/BadRequest' }, 404: notFound },
      },
      patch: {
        tags: [collection.name],
        operationId: `update${name}`,
        summary: t('openapi.update', { collection: collection.name }),
        requestBody: { required: true, content: json(ref(`${name}Update`)) },
        responses: { 200: { description: t('openapi.ok'), content: json(ref(name)) }, 400: { $ref: '#/components/responses/BadRequest' }, 404: notFound },
      },
      delete: {
        tags: [collection.name],
        operationId: `delete${name}`,
        summary: t('openapi.delete', { collection: collection.name }),
        responses: { 204: { description: t('openapi.deleted') }, 404: notFound },
      },
    };
  }
  return doc;
};

export const openApiJson = (doc: OpenApiDocument) => `${JSON.stringify(doc, null, 2)}\n`;

/** YAML text; loaded on demand so the library only downloads when someone exports YAML. */
export const openApiYaml = async (doc: OpenApiDocument) => {
  const { stringify } = await import('yaml');
  return stringify(doc, { aliasDuplicateObjects: false, lineWidth: 0 });
};
