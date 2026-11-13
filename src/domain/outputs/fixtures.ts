import { createCollection, createField, createProject, uid } from '../model';
import { createRelationship } from '../relationships';
import type { EngineId, Project } from '../types';

/** A small store model used by the output tests in every engine. */
export const storeFixture = (engine: EngineId): Project => {
  const project = createProject('Tienda', engine, 'tienda');
  const customers = createCollection(engine, 'clientes');
  customers.fields.push(
    createField({ name: 'nombre', type: 'string', required: true, maxLength: 120 }),
    createField({ name: 'email', type: 'string', required: true, pattern: '^[^@]+@[^@]+$' }),
    createField({ name: 'tipo', type: 'enum', required: true, enumValues: ['persona', 'empresa'] }),
    createField({ name: 'direccion', type: 'object', children: [createField({ name: 'ciudad', type: 'string', required: true })] }),
    createField({ name: 'creadoEn', type: engine === 'firestore' ? 'timestamp' : 'date', required: true }),
    createField({ name: 'puntos', type: 'int', minimum: 0, nullable: true }),
  );
  customers.indexes.push({ id: uid(), name: '', nameIsCustom: false, keys: [{ path: 'email', order: 1 }], unique: true });
  customers.indexes.push({ id: uid(), name: '', nameIsCustom: false, keys: [{ path: 'direccion.ciudad', order: 1 }, { path: 'creadoEn', order: -1 }] });
  const orders = createCollection(engine, 'pedidos');
  orders.fields.push(
    createField({ name: 'items', type: 'array', required: true, minItems: 1, maxItems: 20, items: createField({ name: '', type: 'object', children: [createField({ name: 'sku', type: 'string', required: true }), createField({ name: 'cantidad', type: 'int', required: true, minimum: 1 })] }) }),
    createField({ name: 'total', type: engine === 'mongodb' ? 'decimal' : 'double', required: true }),
  );
  orders.options.ttl = { field: 'creadoEn', seconds: 3600 };
  orders.fields.push(createField({ name: 'creadoEn', type: engine === 'firestore' ? 'timestamp' : 'date', required: true }));
  project.collections.push(customers, orders);
  createRelationship(project, { kind: 'reference', fromId: orders.id, toId: customers.id, cardinality: '1:N', fieldName: 'clienteId' });
  return project;
};
