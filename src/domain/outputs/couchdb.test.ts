import { describe, expect, it } from 'vitest';
import { storeFixture } from './fixtures';
import { couchbaseIndexes, designDocuments, mangoIndexes, validateDocUpdate } from './couchdb';

const project = storeFixture('couchdb');
const [customers, orders] = project.collections;

/** Runs the generated validate_doc_update the way CouchDB does. */
const run = (source: string, doc: Record<string, unknown>) => {
  const fn = new Function(`return (${source});`)() as (n: unknown, o: unknown, u: unknown, s: unknown) => void;
  try {
    fn(doc, null, { name: 'ana', roles: [] }, {});
    return null;
  } catch (error) {
    return (error as { forbidden: string }).forbidden;
  }
};

const validCustomer = { _id: 'c1', type: 'clientes', nombre: 'Ana', email: 'ana@x.com', tipo: 'persona', creadoEn: '2025-01-02T10:00:00Z', direccion: { ciudad: 'Lima' }, puntos: null };

describe('validate_doc_update', () => {
  const source = validateDocUpdate(customers);

  it('accepts valid documents and ignores other types and deletions', () => {
    expect(run(source, validCustomer)).toBeNull();
    expect(run(source, { _id: 'x', type: 'pedidos', total: 'nope' })).toBeNull();
    expect(run(source, { _id: 'c1', _deleted: true })).toBeNull();
  });

  it('rejects missing, mistyped and out of range values', () => {
    const { nombre: _nombre, ...withoutName } = validCustomer;
    void _nombre;
    expect(run(source, withoutName)).toContain('nombre: required');
    expect(run(source, { ...validCustomer, email: 'no-at' })).toContain('email: pattern');
    expect(run(source, { ...validCustomer, tipo: 'otro' })).toContain('tipo: enum');
    expect(run(source, { ...validCustomer, creadoEn: 'ayer' })).toContain('creadoEn: date');
    expect(run(source, { ...validCustomer, puntos: -1 })).toContain('puntos: minimum');
    expect(run(source, { ...validCustomer, puntos: 1.5 })).toContain('puntos: int');
    expect(run(source, { ...validCustomer, direccion: {} })).toContain('direccion.ciudad: required');
    expect(run(source, { ...validCustomer, nombre: 'x'.repeat(121) })).toContain('nombre: maxLength');
  });

  it('checks array elements and limits', () => {
    const src = validateDocUpdate(orders);
    const base = { _id: 'o1', type: 'pedidos', clienteId: 'c1', total: 10, creadoEn: '2025-01-02T10:00:00Z', items: [{ sku: 'A', cantidad: 1 }] };
    expect(run(src, base)).toBeNull();
    expect(run(src, { ...base, items: [] })).toContain('items: minItems');
    expect(run(src, { ...base, items: [{ sku: 'A', cantidad: 0 }] })).toContain('items[0].cantidad: minimum');
  });

  it('rejects extra fields when the collection is strict', () => {
    const strict = validateDocUpdate({ ...customers, options: { additionalProperties: false } });
    expect(run(strict, validCustomer)).toBeNull();
    expect(run(strict, { ...validCustomer, extra: 1 })).toContain('extra: not allowed');
  });
});

describe('design documents and indexes', () => {
  it('adds a view per reference', () => {
    const [, design] = designDocuments(project);
    expect(design._id).toBe('_design/pedidos');
    expect(design.views.by_clienteId.map).toContain('emit(doc.clienteId, null)');
  });

  it('writes Mango indexes scoped by the type field', () => {
    const { code } = mangoIndexes(project);
    expect(code).toContain('"partial_filter_selector":{"type":"clientes"}');
    expect(code).toContain('"fields":[{"direccion.ciudad":"asc"},{"creadoEn":"desc"}]');
  });

  it('writes Couchbase SQL++ indexes, arrays with DISTINCT ARRAY', () => {
    const p = storeFixture('couchdb');
    p.collections[1].indexes.push({ id: 'x', name: 'by_sku', nameIsCustom: true, keys: [{ path: 'items[].sku', order: 1 }] });
    const { code } = couchbaseIndexes(p);
    expect(code).toContain('CREATE PRIMARY INDEX IF NOT EXISTS ON `tienda`.`_default`.`clientes`;');
    expect(code).toContain('CREATE INDEX `by_sku` IF NOT EXISTS ON `tienda`.`_default`.`pedidos`(DISTINCT ARRAY v.`sku` FOR v IN `items` END);');
  });
});
