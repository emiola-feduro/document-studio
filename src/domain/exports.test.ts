import { describe, expect, it } from 'vitest';
import { buildModelSpec, toAgentJson, toAgentMarkdown } from './model-spec';
import { createCollection, createField } from './model';
import { buildOpenApi } from './openapi';
import { storeFixture } from './outputs/fixtures';
import { generateAllDocuments, seededRng } from './random-values';

describe('agent export', () => {
  const project = storeFixture('mongodb');

  it('lists every path with type, constraints and references', () => {
    const spec = buildModelSpec(project);
    const orders = spec.collections[1];
    expect(orders.fields.map((f) => f.path)).toContain('items[].sku');
    expect(orders.fields.find((f) => f.path === 'clienteId')?.references).toBe('clientes._id');
    expect(orders.relations[0]).toMatchObject({ kind: 'reference', field: 'clienteId', target: 'clientes', cardinality: '1:N' });
    expect(spec.collections[0].indexes[0]).toMatchObject({ name: 'email_1', unique: true });
  });

  it('writes Markdown and JSON with instructions for the chosen technology', () => {
    const spec = buildModelSpec(project);
    const md = toAgentMarkdown(spec, { target: 'Mongoose', script: 'db.x' });
    expect(md).toContain('Mongoose');
    expect(md).toContain('| `items[].cantidad` |');
    expect(md).toContain('```\ndb.x\n```');
    const json = JSON.parse(toAgentJson(spec, {}));
    expect(json.format).toBe('document-studio.model-spec');
    expect(json.collections).toHaveLength(2);
  });
});

describe('OpenAPI', () => {
  it('has CRUD routes, ObjectId ids and examples from documents', () => {
    const project = storeFixture('mongodb');
    project.documents = generateAllDocuments(project, { count: 2, locale: 'en', rng: seededRng(2) });
    const doc = buildOpenApi(project);
    expect(Object.keys(doc.paths)).toEqual(['/clientes', '/clientes/{id}', '/pedidos', '/pedidos/{id}']);
    const params = (doc.paths['/clientes/{id}'] as { parameters: { schema: unknown }[] }).parameters;
    expect(params[0].schema).toEqual({ type: 'string', pattern: '^[a-f0-9]{24}$' });
    expect(doc.components.schemas.Cliente.example).toBeDefined();
    expect((doc.components.schemas.Pedido as { properties: Record<string, { type: string }> }).properties.items.type).toBe('array');
  });

  it('nests Firestore subcollections under their parent document', () => {
    const project = storeFixture('firestore');
    const notes = createCollection('firestore', 'notas');
    notes.kind = 'subcollection';
    notes.parentId = project.collections[0].id;
    notes.fields.push(createField({ name: 'texto' }));
    project.collections.push(notes);
    const doc = buildOpenApi(project);
    expect(Object.keys(doc.paths)).toContain('/clientes/{clienteId}/notas/{id}');
  });
});
