import { describe, expect, it } from 'vitest';
import { adviseProject, estimateSize, recommendRelationship } from './advisor';
import { createCollection, createField, createProject } from './model';
import { createRelationship } from './relationships';
import { createSampleProject } from '../lib/sample-project';

const codes = (project: ReturnType<typeof createProject>) => adviseProject(project).map((i) => i.code);

describe('advisor', () => {
  it('the sample project has no errors or warnings', () => {
    expect(adviseProject(createSampleProject()).filter((i) => i.level !== 'info')).toEqual([]);
  });

  it('flags structure problems', () => {
    const p = createProject('p', 'firestore');
    const c = createCollection('firestore', 'a');
    c.fields.push(
      createField({ name: 'x' }),
      createField({ name: 'x' }),
      createField({ name: '__bad__' }),
      createField({ name: 'obj', type: 'object', children: [] }),
      createField({ name: 'arr', type: 'array' }),
      createField({ name: 'nested', type: 'array', items: createField({ name: '', type: 'array' }) }),
      createField({ name: 'e', type: 'enum', enumValues: [] }),
      createField({ name: 'r', pattern: '([' }),
      createField({ name: 'n', type: 'int', minimum: 5, maximum: 1 }),
    );
    p.collections.push(c, createCollection('firestore', 'empty'));
    expect(codes(p)).toEqual(expect.arrayContaining(['duplicate-field', 'field-name', 'empty-object', 'array-items', 'nested-array', 'empty-enum', 'bad-pattern', 'range', 'no-fields']));
  });

  it('flags index problems', () => {
    const p = createProject('p', 'mongodb');
    const c = createCollection('mongodb', 'a');
    c.fields.push(createField({ name: 'a' }), createField({ name: 'b' }), createField({ name: 'tags', type: 'array', items: createField({ name: '', type: 'string' }) }), createField({ name: 'when', type: 'string' }));
    c.indexes.push(
      { id: '1', name: '', nameIsCustom: false, keys: [{ path: 'a', order: 1 }] },
      { id: '2', name: '', nameIsCustom: false, keys: [{ path: 'a', order: 1 }] },
      { id: '3', name: '', nameIsCustom: false, keys: [{ path: 'a', order: 1 }, { path: 'b', order: 1 }] },
      { id: '4', name: '', nameIsCustom: false, keys: [{ path: 'tags', order: 1 }], unique: true },
      { id: '5', name: '', nameIsCustom: false, keys: [{ path: 'missing', order: 1 }], partialFilter: '{ bad' },
    );
    c.options.ttl = { field: 'when', seconds: 5 };
    p.collections.push(c);
    expect(codes(p)).toEqual(expect.arrayContaining(['duplicate-index', 'prefix-index', 'unique-multikey', 'index-path', 'bad-filter', 'ttl-type']));
  });

  it('warns about unbounded arrays, unindexed references and wrong reference types', () => {
    const p = createProject('p', 'mongodb');
    const a = createCollection('mongodb', 'a');
    const b = createCollection('mongodb', 'b');
    b.fields.push(createField({ name: 'n' }));
    p.collections.push(a, b);
    const rel = createRelationship(p, { kind: 'reference', fromId: a.id, toId: b.id, cardinality: '1:N' })!;
    createRelationship(p, { kind: 'embed', fromId: a.id, toId: b.id, cardinality: '1:N' });
    expect(codes(p)).toEqual(expect.arrayContaining(['ref-index', 'unbounded-array', 'rec-kind']));
    a.fields.find((f) => f.name === rel.from.fieldPath)!.type = 'string';
    expect(codes(p)).toContain('rel-type');
  });

  it('recommends embedding or referencing', () => {
    const p = createProject('p', 'mongodb');
    const a = createCollection('mongodb', 'a');
    const b = createCollection('mongodb', 'b');
    p.collections.push(a, b);
    const one = createRelationship(p, { kind: 'reference', fromId: a.id, toId: b.id, cardinality: '1:1' })!;
    expect(recommendRelationship(p, one).kind).toBe('embed');
    const many = createRelationship(p, { kind: 'embed', fromId: a.id, toId: b.id, cardinality: 'N:M' })!;
    expect(recommendRelationship(p, many).kind).toBe('reference');
  });

  it('estimates size from types, lengths and maxItems', () => {
    const small = estimateSize([createField({ name: 'a', type: 'int' })]);
    expect(small.bytes).toBeLessThan(20);
    const big = estimateSize([createField({ name: 'a', type: 'array', maxItems: 100000, items: createField({ name: '', type: 'string', maxLength: 500 }) })]);
    expect(big.bytes).toBeGreaterThan(16 * 1024 * 1024 * 0.5 * 0.5);
    expect(estimateSize([createField({ name: 'a', type: 'array', items: createField({ name: '' }) })]).unbounded).toBe(true);
    const p = createProject('p', 'firestore');
    const c = createCollection('firestore', 'c');
    c.fields.push(createField({ name: 'list', type: 'array', maxItems: 5000, items: createField({ name: '', type: 'string', maxLength: 300 }) }));
    p.collections.push(c);
    expect(codes(p)).toContain('size');
  });
});
