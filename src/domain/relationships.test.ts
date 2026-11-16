import { describe, expect, it } from 'vitest';
import { createCollection, createField, createProject } from './model';
import { createRelationship, rebuildRelationshipField, removeRelationship, suggestFieldName } from './relationships';

const setup = (engine: 'mongodb' | 'firestore' | 'couchdb' = 'mongodb') => {
  const project = { ...createProject('p', engine), namesLocale: 'en' as const };
  const customers = createCollection(engine, 'customers');
  customers.fields.push(createField({ name: 'name' }), createField({ name: 'email' }));
  const orders = createCollection(engine, 'orders');
  project.collections.push(customers, orders);
  return { project, customers, orders };
};

describe('relationships', () => {
  it('references create a field with the target id type', () => {
    const { project, customers, orders } = setup();
    expect(suggestFieldName(project, { kind: 'reference', toId: customers.id, cardinality: '1:N' })).toBe('customerId');
    const rel = createRelationship(project, { kind: 'reference', fromId: orders.id, toId: customers.id, cardinality: '1:N' })!;
    expect(rel.storage).toBe('single');
    expect(orders.fields.at(-1)).toMatchObject({ name: 'customerId', type: 'objectId', reference: { collectionId: customers.id, fieldPath: '_id' } });
  });

  it('N:M references are arrays, on both sides when two way', () => {
    const { project, customers, orders } = setup('firestore');
    const rel = createRelationship(project, { kind: 'reference', fromId: orders.id, toId: customers.id, cardinality: 'N:M', twoWay: true })!;
    expect(orders.fields.at(-1)).toMatchObject({ name: 'customerIds', type: 'array' });
    expect(orders.fields.at(-1)?.items?.type).toBe('reference');
    expect(customers.fields.at(-1)?.name).toBe('orderIds');
    expect(rel.reverseFieldPath).toBe('orderIds');
    removeRelationship(project, rel.id, true);
    expect(orders.fields.some((f) => f.name === 'customerIds')).toBe(false);
    expect(customers.fields.some((f) => f.name === 'orderIds')).toBe(false);
  });

  it('embeds copy the target fields, all or a subset', () => {
    const { project, customers, orders } = setup();
    createRelationship(project, { kind: 'embed', fromId: orders.id, toId: customers.id, cardinality: '1:1' });
    const embedded = orders.fields.at(-1)!;
    expect(embedded).toMatchObject({ name: 'customer', type: 'object' });
    expect(embedded.children?.map((f) => f.name)).toEqual(['name', 'email']);
    createRelationship(project, { kind: 'embed', fromId: customers.id, toId: orders.id, cardinality: '1:N', embedFieldIds: [] });
    expect(customers.fields.at(-1)).toMatchObject({ name: 'orders', type: 'array' });
    expect(customers.fields.at(-1)?.items?.type).toBe('object');
  });

  it('rebuilds the stored field when the kind changes', () => {
    const { project, customers, orders } = setup('couchdb');
    const rel = createRelationship(project, { kind: 'reference', fromId: orders.id, toId: customers.id, cardinality: '1:N' })!;
    expect(orders.fields.at(-1)?.type).toBe('reference');
    rel.kind = 'embed';
    rel.storage = 'single';
    rebuildRelationshipField(project, rel.id);
    expect(orders.fields.at(-1)).toMatchObject({ name: 'customerId', type: 'object' });
  });
});
