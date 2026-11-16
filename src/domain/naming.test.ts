import { describe, expect, it } from 'vitest';
import { createCollection, createProject } from './model';
import { embedFieldName, modelTypeName, referenceFieldName, singularize } from './naming';
import { createRelationship, suggestFieldName } from './relationships';

describe('singularize', () => {
  it('handles Spanish plurals', () => {
    const cases = { clientes: 'cliente', pedidos: 'pedido', categorias: 'categoria', ciudades: 'ciudad', profesores: 'profesor', aviones: 'avion', editoriales: 'editorial', nombres: 'nombre', luces: 'luz', canciones: 'cancion', especialidades: 'especialidad', usuarios: 'usuario', cliente: 'cliente', mes: 'mes', analisis: 'analisis' };
    for (const [plural, singular] of Object.entries(cases)) expect(singularize(plural, 'es'), plural).toBe(singular);
  });

  it('handles English plurals', () => {
    const cases = { customers: 'customer', categories: 'category', boxes: 'box', addresses: 'address', people: 'person', status: 'status', data: 'data', order_items: 'order_item', orderItems: 'orderItem', books: 'book', wolves: 'wolf', series: 'series', classes: 'class' };
    for (const [plural, singular] of Object.entries(cases)) expect(singularize(plural, 'en'), plural).toBe(singular);
  });

  it('handles French and Portuguese plurals', () => {
    expect(singularize('clients', 'fr')).toBe('client');
    expect(singularize('journaux', 'fr')).toBe('journal');
    expect(singularize('bureaux', 'fr')).toBe('bureau');
    expect(singularize('cours', 'fr')).toBe('cours');
    expect(singularize('opcoes', 'pt')).toBe('opcao');
    expect(singularize('animais', 'pt')).toBe('animal');
    expect(singularize('itens', 'pt')).toBe('item');
    expect(singularize('professores', 'pt')).toBe('professor');
    expect(singularize('clientes', 'pt')).toBe('cliente');
  });
});

describe('reference field names', () => {
  it('uses the singular of the target and the naming convention', () => {
    expect(referenceFieldName('pedidos', false, { locale: 'es' })).toBe('pedidoId');
    expect(referenceFieldName('etiquetas', true, { locale: 'es' })).toBe('etiquetaIds');
    expect(referenceFieldName('pedidos', false, { locale: 'es', convention: 'snake_case' })).toBe('pedido_id');
    expect(referenceFieldName('etiquetas', true, { locale: 'es', convention: 'snake_case' })).toBe('etiqueta_ids');
    expect(referenceFieldName('ciudades', false, { locale: 'es' })).toBe('ciudadId');
    expect(referenceFieldName('categories', false, { locale: 'en' })).toBe('categoryId');
    expect(referenceFieldName('people', true, { locale: 'en' })).toBe('personIds');
    expect(referenceFieldName('journaux', false, { locale: 'fr' })).toBe('journalId');
    expect(referenceFieldName('opcoes', false, { locale: 'pt' })).toBe('opcaoId');
    expect(referenceFieldName('order_items', false, { locale: 'en' })).toBe('orderItemId');
    expect(referenceFieldName('orderItems', true, { locale: 'en', convention: 'snake_case' })).toBe('order_item_ids');
  });

  it('names embedded fields with the singular for one and the collection for many', () => {
    expect(embedFieldName('direcciones', false, { locale: 'es' })).toBe('direccion');
    expect(embedFieldName('items', true, { locale: 'en' })).toBe('items');
    expect(embedFieldName('lineas_pedido', true, { locale: 'es', convention: 'camelCase' })).toBe('lineasPedido');
  });

  it('follows the project names language and convention when creating relationships', () => {
    const project = { ...createProject('p', 'mongodb'), namesLocale: 'es' as const, namingConvention: 'snake_case' as const };
    const clientes = createCollection('mongodb', 'clientes');
    const pedidos = createCollection('mongodb', 'pedidos');
    const etiquetas = createCollection('mongodb', 'etiquetas');
    project.collections.push(clientes, pedidos, etiquetas);
    expect(suggestFieldName(project, { kind: 'reference', toId: clientes.id, cardinality: '1:N' })).toBe('cliente_id');
    createRelationship(project, { kind: 'reference', fromId: pedidos.id, toId: etiquetas.id, cardinality: 'N:M', twoWay: true });
    expect(pedidos.fields.some((f) => f.name === 'etiqueta_ids')).toBe(true);
    expect(etiquetas.fields.some((f) => f.name === 'pedido_ids')).toBe(true);
    expect(modelTypeName(project, 'ciudades')).toBe('Ciudad');
  });
});
