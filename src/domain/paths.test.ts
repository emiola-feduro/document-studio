import { describe, expect, it } from 'vitest';
import { createCollection, createField, createProject } from './model';
import { allPaths, fieldAtPath, indentField, locateField, moveField, outdentField, renamePath, setFieldType, toMongoPath } from './paths';

const sample = () => {
  const c = createCollection('mongodb', 'pedidos');
  c.fields.push(
    createField({ name: 'cliente', type: 'object', children: [createField({ name: 'nombre' }), createField({ name: 'direccion', type: 'object', children: [createField({ name: 'ciudad' })] })] }),
    createField({ name: 'items', type: 'array', items: createField({ name: '', type: 'object', children: [createField({ name: 'sku' }), createField({ name: 'cantidad', type: 'int' })] }) }),
    createField({ name: 'tags', type: 'array', items: createField({ name: '', type: 'string' }) }),
  );
  return c;
};

describe('paths', () => {
  it('lists every path with [] for array elements, three levels deep', () => {
    expect(allPaths(sample()).map((e) => e.path)).toEqual(['_id', 'cliente', 'cliente.nombre', 'cliente.direccion', 'cliente.direccion.ciudad', 'items', 'items[].sku', 'items[].cantidad', 'tags']);
    expect(toMongoPath('items[].sku')).toBe('items.sku');
  });

  it('finds fields by either path form', () => {
    const c = sample();
    expect(fieldAtPath(c.fields, 'items[].sku')?.name).toBe('sku');
    expect(fieldAtPath(c.fields, 'items.sku')?.name).toBe('sku');
    expect(fieldAtPath(c.fields, 'cliente.direccion.ciudad')?.name).toBe('ciudad');
  });

  it('marks fields inside arrays', () => {
    const entries = allPaths(sample());
    expect(entries.find((e) => e.path === 'items[].sku')?.inArray).toBe(true);
    expect(entries.find((e) => e.path === 'cliente.nombre')?.inArray).toBe(false);
  });

  it('renames a path in indexes, options and relationships', () => {
    const project = createProject('p', 'mongodb');
    const c = sample();
    project.collections.push(c);
    c.indexes.push({ id: 'i', name: '', nameIsCustom: false, keys: [{ path: 'cliente.direccion.ciudad', order: 1 }, { path: 'items[].sku', order: 1 }] });
    c.options.ttl = { field: 'cliente.nombre', seconds: 10 };
    project.relationships.push({ id: 'r', kind: 'embed', from: { collectionId: c.id, fieldPath: 'items' }, to: { collectionId: 'x' }, cardinality: '1:N', storage: 'array' });
    renamePath(project, c.id, 'cliente', 'comprador');
    renamePath(project, c.id, 'items', 'lineas');
    expect(c.indexes[0].keys.map((k) => k.path)).toEqual(['comprador.direccion.ciudad', 'lineas[].sku']);
    expect(c.options.ttl.field).toBe('comprador.nombre');
    expect(project.relationships[0].from.fieldPath).toBe('lineas');
  });

  it('indents into the object above and outdents back', () => {
    const c = createCollection('mongodb', 'a');
    const obj = createField({ name: 'obj', type: 'object', children: [] });
    const x = createField({ name: 'x' });
    c.fields.push(obj, x);
    expect(indentField(c.fields, x.id)).toBe(true);
    expect(locateField(c.fields, x.id)?.path).toBe('obj.x');
    expect(outdentField(c.fields, x.id)).toBe(true);
    expect(locateField(c.fields, x.id)?.path).toBe('x');
    expect(moveField(c.fields, x.id, -1)).toBe(true);
    expect(c.fields.map((f) => f.name)).toEqual(['_id', 'x', 'obj']);
  });

  it('changing the type creates or keeps children and element types', () => {
    const f = createField({ name: 'a', type: 'object', children: [createField({ name: 'b' })] });
    setFieldType(f, 'array');
    expect(f.items?.type).toBe('object');
    expect(f.items?.children?.map((c) => c.name)).toEqual(['b']);
    setFieldType(f, 'object');
    expect(f.children?.map((c) => c.name)).toEqual(['b']);
    setFieldType(f, 'string');
    expect(f.children).toBeUndefined();
    expect(f.items).toBeUndefined();
  });
});
