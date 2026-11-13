import { t } from '../i18n';
import { createCollection, createField, createProject, uid } from '../domain/model';
import type { DocIndex, Field, Project } from '../domain/types';

const field = (name: string, type: Field['type'], extra: Partial<Field> = {}) => createField({ name, type, ...extra });

const index = (name: string, path: string, unique = false): DocIndex => ({
  id: uid(),
  name,
  nameIsCustom: false,
  keys: [{ path, order: 1 }],
  ...(unique ? { unique } : {}),
});

/** A small MongoDB store, so the first visit shows nested fields, an embedded array and a reference. */
export const createSampleProject = (): Project => {
  const engine = 'mongodb';
  const project = createProject(t('projects.sampleName'), engine, 'tienda');

  const clientes = createCollection(engine, 'clientes', { x: 0, y: 0 });
  clientes.fields.push(
    field('nombre', 'string', { required: true, maxLength: 120 }),
    field('email', 'string', { required: true, pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' }),
    field('direccion', 'object', {
      children: [field('calle', 'string'), field('ciudad', 'string', { required: true }), field('codigoPostal', 'string')],
    }),
    field('creadoEn', 'date', { required: true }),
  );
  clientes.indexes.push(index('email_1', 'email', true));

  const productos = createCollection(engine, 'productos', { x: 0, y: 360 });
  productos.fields.push(
    field('nombre', 'string', { required: true }),
    field('precio', 'decimal', { required: true, minimum: 0 }),
    field('categorias', 'array', { items: field('', 'string'), maxItems: 10 }),
    field('stock', 'int', { minimum: 0 }),
  );

  const pedidos = createCollection(engine, 'pedidos', { x: 440, y: 120 });
  const clienteId = field('clienteId', 'objectId', { required: true, reference: { collectionId: clientes.id, fieldPath: '_id' } });
  pedidos.fields.push(
    clienteId,
    field('fecha', 'date', { required: true }),
    field('estado', 'enum', { required: true, enumValues: ['pendiente', 'pagado', 'enviado', 'cancelado'] }),
    field('items', 'array', {
      required: true,
      minItems: 1,
      maxItems: 50,
      items: field('', 'object', {
        children: [
          field('productoId', 'objectId', { required: true, reference: { collectionId: productos.id, fieldPath: '_id' } }),
          field('nombre', 'string', { required: true }),
          field('cantidad', 'int', { required: true, minimum: 1 }),
          field('precio', 'decimal', { required: true, minimum: 0 }),
        ],
      }),
    }),
    field('total', 'decimal', { required: true, minimum: 0 }),
  );
  pedidos.indexes.push(index('clienteId_1', 'clienteId'));

  project.collections.push(clientes, pedidos, productos);
  project.relationships.push(
    {
      id: uid(),
      kind: 'reference',
      from: { collectionId: pedidos.id, fieldPath: 'clienteId' },
      to: { collectionId: clientes.id },
      cardinality: '1:N',
      storage: 'single',
    },
    {
      id: uid(),
      kind: 'embed',
      from: { collectionId: pedidos.id, fieldPath: 'items' },
      to: { collectionId: productos.id },
      cardinality: '1:N',
      storage: 'array',
    },
  );
  return project;
};
