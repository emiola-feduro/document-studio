import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../../lib/sample-project';
import { changeEngine } from '../engine-change';
import type { Project } from '../types';
import { parseSql } from './sql-parse';
import { toNative } from './to-native';

const project = (engine: Project['engine']) => {
  const p = createSampleProject();
  if (engine !== 'mongodb') changeEngine(p, engine);
  p.databaseName = 'tienda';
  return p;
};

const translate = (engine: Project['engine'], sql: string) => {
  const parsed = parseSql(sql);
  expect(parsed.diagnostics).toEqual([]);
  return toNative(project(engine), parsed.ir!);
};
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

/** SQL in, and what each engine gets: mongosh, the Mango selector, and Firestore constraints. */
const CASES: { sql: string; mongo: string; mango?: Record<string, unknown>; firestore?: string[] }[] = [
  {
    sql: "SELECT * FROM pedidos WHERE estado = 'pagado'",
    mongo: 'db.pedidos.find({ estado: "pagado" });',
    mango: { type: 'pedidos', estado: 'pagado' },
    firestore: ['where("estado", "==", "pagado")'],
  },
  {
    sql: "SELECT * FROM clientes WHERE direccion.ciudad = 'Lima'",
    mongo: 'db.clientes.find({ "direccion.ciudad": "Lima" });',
    mango: { type: 'clientes', 'direccion.ciudad': 'Lima' },
    firestore: ['where("direccion.ciudad", "==", "Lima")'],
  },
  {
    sql: "SELECT * FROM clientes WHERE nombre LIKE 'An%' AND email LIKE '%.com' AND direccion.calle LIKE '%real%'",
    mongo: 'db.clientes.find({ nombre: /^An/, email: /\\.com$/, "direccion.calle": /real/ });',
    mango: { type: 'clientes', nombre: { $regex: '^An' }, email: { $regex: '\\.com$' }, 'direccion.calle': { $regex: 'real' } },
  },
  {
    sql: "SELECT * FROM pedidos WHERE estado IN ('pagado', 'enviado')",
    mongo: 'db.pedidos.find({ estado: { $in: ["pagado", "enviado"] } });',
    mango: { type: 'pedidos', estado: { $in: ['pagado', 'enviado'] } },
    firestore: ['where("estado", "in", ["pagado", "enviado"])'],
  },
  {
    sql: 'SELECT * FROM pedidos WHERE total BETWEEN 10 AND 100',
    mongo: 'db.pedidos.find({ total: { $gte: 10, $lte: 100 } });',
    mango: { type: 'pedidos', total: { $gte: 10, $lte: 100 } },
    firestore: ['where("total", ">=", 10)', 'where("total", "<=", 100)'],
  },
  {
    sql: 'SELECT * FROM clientes WHERE direccion.calle IS NULL',
    mongo: 'db.clientes.find({ "direccion.calle": null });',
    mango: { type: 'clientes', 'direccion.calle': null },
    firestore: ['where("direccion.calle", "==", null)'],
  },
  {
    sql: 'SELECT * FROM pedidos ORDER BY fecha DESC LIMIT 10 OFFSET 20',
    mongo: 'db.pedidos.find({}) .sort({ fecha: -1 }) .skip(20) .limit(10);',
  },
  {
    sql: 'SELECT p.total, c.nombre FROM pedidos p JOIN clientes c ON p.clienteId = c._id',
    mongo:
      'db.pedidos.aggregate([ { $lookup: { from: "clientes", localField: "clienteId", foreignField: "_id", as: "c" } }, { $unwind: "$c" }, { $project: { total: 1, "c.nombre": 1 } } ]);',
  },
  {
    sql: 'SELECT p._id, pr.nombre FROM pedidos p JOIN productos pr ON p.items.productoId = pr._id',
    mongo:
      'db.pedidos.aggregate([ { $lookup: { from: "productos", localField: "items.productoId", foreignField: "_id", as: "pr" } }, { $unwind: "$pr" }, { $project: { _id: 1, "pr.nombre": 1 } } ]);',
  },
  {
    sql: 'SELECT estado, COUNT(*) AS n FROM pedidos GROUP BY estado HAVING COUNT(*) > 1',
    mongo: 'db.pedidos.aggregate([ { $group: { _id: "$estado", n: { $sum: 1 } } }, { $project: { _id: 0, estado: "$_id", n: 1 } }, { $match: { n: { $gt: 1 } } } ]);',
  },
];

describe('SQL translated to each engine', () => {
  it.each(CASES)('$sql', ({ sql, mongo, mango, firestore }) => {
    expect(flat(translate('mongodb', sql).text)).toBe(flat(mongo));
    if (mango) expect(JSON.parse(translate('couchdb', sql).text).selector).toEqual(mango);
    if (firestore) {
      const code = translate('firestore', sql).text;
      for (const constraint of firestore) expect(code).toContain(constraint);
    }
  });

  it('gives CouchDB the Mango index for the sort, a view for GROUP BY and two options for JOIN', () => {
    const sorted = translate('couchdb', 'SELECT * FROM pedidos ORDER BY fecha');
    expect(JSON.parse(sorted.extras![0].code)).toEqual({ index: { fields: ['type', 'fecha'] }, name: 'type-fecha', type: 'json' });
    const grouped = translate('couchdb', 'SELECT estado, SUM(total) FROM pedidos GROUP BY estado');
    const design = JSON.parse(grouped.extras![0].code);
    expect(design.views.by_estado).toEqual({ map: 'function (doc) { if (doc.type === "pedidos") emit(doc.estado, doc.total); }', reduce: '_sum' });
    expect(grouped.extras![1].code).toBe('GET /tienda/_design/pedidos/_view/by_estado?group=true');
    const joined = translate('couchdb', 'SELECT * FROM pedidos p JOIN clientes c ON p.clienteId = c._id');
    expect(joined.extras!.map((e) => e.language)).toEqual(['json', 'json', 'sh']);
    expect(JSON.parse(joined.extras![0].code)).toEqual({ selector: { type: 'clientes', _id: { $in: ['<clienteId>'] } } });
    expect(joined.extras![1].code).toContain('emit(doc._id, { _id: doc.clienteId })');
  });

  it('tells Firestore what changes meaning, what needs an index and how to read in two steps', () => {
    const ne = translate('firestore', "SELECT * FROM pedidos WHERE estado <> 'cancelado' ORDER BY total");
    expect(ne.diagnostics.some((d) => d.severity === 'info' && d.message.includes('estado') && d.pos)).toBe(true);
    expect(ne.missingIndex?.keys).toEqual([
      { path: 'estado', order: 1 },
      { path: 'total', order: 1 },
    ]);
    const joined = translate('firestore', 'SELECT * FROM pedidos p JOIN clientes c ON p.clienteId = c._id');
    expect(joined.extras![0].code).toContain('getDoc(d.data().clienteId)');
    const grouped = translate('firestore', 'SELECT estado, COUNT(*) FROM pedidos GROUP BY estado');
    expect(grouped.extras![0].code).toContain('groups.set(key, group);');
    const contains = translate('firestore', "SELECT * FROM clientes WHERE nombre LIKE '%a%'");
    expect(contains.diagnostics.find((d) => d.severity === 'warning')?.pos).toBeDefined();
  });

  it('reports errors with their place in the SQL', () => {
    expect(parseSql("SELECT * FROM pedidos WHERE total >").diagnostics[0].pos?.start).toBe(35);
    const n = toNative(project('mongodb'), parseSql('SELECT * FROM pedidos WHERE totl > 1').ir!);
    expect(n.diagnostics[0]).toMatchObject({ severity: 'error', pos: { start: 28, end: 32 }, fix: { text: 'total' } });
  });
});
