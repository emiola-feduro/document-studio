import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../../lib/sample-project';
import { changeEngine } from '../engine-change';
import type { Project } from '../types';
import { bindQuery } from './resolve';
import { parseNative } from './native-parse';
import { parseSql } from './sql-parse';
import { toNative } from './to-native';
import { toSql } from './to-sql';

const project = (engine: Project['engine'] = 'mongodb') => {
  const p = createSampleProject();
  if (engine !== 'mongodb') changeEngine(p, engine);
  return p;
};

const native = (p: Project, sql: string) => {
  const parsed = parseSql(sql);
  expect(parsed.diagnostics).toEqual([]);
  return toNative(p, parsed.ir!);
};

/** SQL to native, native back to the IR and again to native and to SQL: every step gives the same native query. */
const roundTrip = (p: Project, sql: string) => {
  const first = native(p, sql);
  const back = parseNative(p, first.text);
  expect(back.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  expect(toNative(p, back.ir!).text).toBe(first.text);
  const sql2 = toSql(back.ir!);
  expect(native(p, sql2).text).toBe(first.text);
  return { native: first, sql: sql2 };
};

/** Runs mongosh text against a fake db and returns the calls. */
const shell = (code: string) => {
  const calls: { method: string; args: unknown[] }[] = [];
  const cursor: Record<string, unknown> = {};
  for (const m of ['sort', 'skip', 'limit']) cursor[m] = (...args: unknown[]) => (calls.push({ method: m, args }), cursor);
  const coll = new Proxy({}, { get: (_t, m) => (...args: unknown[]) => (calls.push({ method: String(m), args }), cursor) });
  const db = new Proxy({}, { get: (_t, k) => (k === 'getCollection' ? () => coll : coll) });
  new Function('db', 'ObjectId', 'ISODate', code)(db, (s: string) => ({ oid: s }), (s: string) => ({ date: s }));
  return calls;
};

const CASES = [
  "SELECT * FROM pedidos WHERE estado = 'pagado'",
  "SELECT nombre, email FROM clientes WHERE direccion.ciudad = 'Lima' ORDER BY nombre LIMIT 10 OFFSET 20",
  "SELECT * FROM clientes WHERE nombre LIKE 'An%' AND email NOT LIKE '%@test.com'",
  "SELECT * FROM clientes WHERE nombre ILIKE '%ana%' OR nombre LIKE '%ez'",
  "SELECT * FROM pedidos WHERE estado IN ('pagado', 'enviado') AND total BETWEEN 10 AND 100",
  "SELECT * FROM pedidos WHERE estado NOT IN ('cancelado') AND total NOT BETWEEN 5 AND 50",
  'SELECT * FROM clientes WHERE direccion.calle IS NULL OR direccion.codigoPostal IS NOT NULL',
  "SELECT * FROM pedidos WHERE NOT (estado = 'pagado' OR total > 100)",
  "SELECT * FROM pedidos WHERE estado <> 'cancelado' AND total >= 10 AND total < 500",
];

describe('SQL and MongoDB in both directions', () => {
  it.each(CASES)('round trip: %s', (sql) => {
    roundTrip(project(), sql);
  });

  it('writes find with a filter, projection, sort, skip and limit', () => {
    const { native: n } = roundTrip(project(), CASES[1]);
    expect(shell(n.text)).toEqual([
      { method: 'find', args: [{ 'direccion.ciudad': 'Lima' }, { nombre: 1, email: 1 }] },
      { method: 'sort', args: [{ nombre: 1 }] },
      { method: 'skip', args: [20] },
      { method: 'limit', args: [10] },
    ]);
  });

  it('turns LIKE into anchored regular expressions and back', () => {
    const p = project();
    const n = native(p, "SELECT * FROM clientes WHERE nombre LIKE 'An%' AND email LIKE '%.com' AND calle LIKE '%a.b%'").text;
    expect(n).toContain('/^An/');
    expect(n).toContain('/\\.com$/');
    expect(n).toContain('/a\\.b/');
    expect(toSql(parseNative(p, n).ir!)).toContain("nombre LIKE 'An%'");
  });

  it('joins one to one and to an array with $lookup and $unwind', () => {
    const { native: one } = roundTrip(project(), "SELECT p.total, c.nombre FROM pedidos p JOIN clientes c ON p.clienteId = c._id WHERE c.nombre LIKE 'A%'");
    const [call] = shell(one.text);
    expect(call.args[0]).toEqual([
      { $lookup: { from: 'clientes', localField: 'clienteId', foreignField: '_id', as: 'c' } },
      { $unwind: '$c' },
      { $match: { 'c.nombre': /^A/ } },
      { $project: { total: 1, 'c.nombre': 1 } },
    ]);
    const { native: many } = roundTrip(project(), 'SELECT p._id, pr.nombre FROM pedidos p LEFT JOIN productos pr ON p.items.productoId = pr._id');
    expect(shell(many.text)[0].args[0]).toEqual([
      { $lookup: { from: 'productos', localField: 'items.productoId', foreignField: '_id', as: 'pr' } },
      { $unwind: { path: '$pr', preserveNullAndEmptyArrays: true } },
      { $project: { _id: 1, 'pr.nombre': 1 } },
    ]);
  });

  it('groups with HAVING, sorts by an aggregate and limits', () => {
    const { native: n, sql } = roundTrip(project(), 'SELECT estado, COUNT(*) AS n, SUM(total) AS suma FROM pedidos GROUP BY estado HAVING COUNT(*) > 2 ORDER BY n DESC LIMIT 5');
    expect(shell(n.text)[0].args[0]).toEqual([
      { $group: { _id: '$estado', n: { $sum: 1 }, suma: { $sum: '$total' } } },
      { $project: { _id: 0, estado: '$_id', n: 1, suma: 1 } },
      { $match: { n: { $gt: 2 } } },
      { $sort: { n: -1 } },
      { $limit: 5 },
    ]);
    expect(sql).toBe('SELECT estado, COUNT(*) AS n, SUM(total) AS suma\nFROM pedidos\nGROUP BY estado\nHAVING COUNT(*) > 2\nORDER BY n DESC\nLIMIT 5');
  });

  it('counts with countDocuments and converts values to the field type', () => {
    const p = project();
    expect(native(p, 'SELECT COUNT(*) FROM pedidos WHERE total > 100').text.replace(/\s+/g, ' ')).toBe('db.pedidos.countDocuments({ total: { $gt: 100 } });');
    const n = native(p, "SELECT * FROM pedidos WHERE clienteId = '0123456789abcdef01234567' AND fecha >= '2026-01-01'").text;
    expect(n.replace(/\s+/g, ' ')).toContain('clienteId: ObjectId("0123456789abcdef01234567")');
    expect(n.replace(/\s+/g, ' ')).toContain('fecha: { $gte: ISODate("2026-01-01") }');
    roundTrip(p, "SELECT * FROM pedidos WHERE clienteId = '0123456789abcdef01234567' AND fecha >= '2026-01-01'");
  });

  it('reads native MongoDB into SQL, keeping what has no SQL form as a comment', () => {
    const p = project();
    const sql = toSql(parseNative(p, 'db.pedidos.find({ estado: { $ne: "cancelado" }, total: { $gte: 10, $lte: 100 } }).sort({ fecha: -1 }).limit(5)').ir!);
    expect(sql).toBe("SELECT *\nFROM pedidos\nWHERE estado <> 'cancelado'\n  AND total >= 10\n  AND total <= 100\nORDER BY fecha DESC\nLIMIT 5");
    const facet = parseNative(p, 'db.pedidos.aggregate([{ $match: { estado: "pagado" } }, { $facet: { a: [] } }])');
    expect(toSql(facet.ir!)).toContain('/* $facet */');
    expect(toNative(p, facet.ir!).diagnostics.some((d) => d.message.includes('$facet'))).toBe(true);
    expect(toSql(parseNative(p, 'db.clientes.find({ nombre: { $regex: "^(a|b)" } })').ir!)).toContain("REGEXP '^(a|b)'");
  });
});

describe('SQL and CouchDB in both directions', () => {
  it.each(CASES)('round trip: %s', (sql) => {
    roundTrip(project('couchdb'), sql);
  });

  it('writes a Mango body with the type field', () => {
    const n = native(project('couchdb'), "SELECT nombre FROM clientes WHERE nombre LIKE 'A%' ORDER BY nombre LIMIT 3");
    expect(JSON.parse(n.text)).toEqual({ selector: { type: 'clientes', nombre: { $regex: '^A' } }, fields: ['nombre'], sort: [{ nombre: 'asc' }], limit: 3 });
    expect(n.diagnostics.map((d) => d.severity)).toEqual(['warning']);
  });

  it('explains what Mango cannot do', () => {
    const n = native(project('couchdb'), 'SELECT estado, COUNT(*) FROM pedidos p JOIN clientes c ON p.clienteId = c._id GROUP BY estado');
    expect(n.diagnostics.map((d) => d.message).join('\n')).toMatch(/JOIN[\s\S]*map\/reduce/);
  });
});

describe('SQL and Firestore in both directions', () => {
  const FS = [CASES[0], CASES[1], CASES[4], "SELECT * FROM pedidos WHERE estado NOT IN ('cancelado')", "SELECT * FROM clientes WHERE nombre LIKE 'An%'", 'SELECT COUNT(*) AS total, SUM(total) AS suma FROM pedidos WHERE estado = \'pagado\''];
  it.each(FS)('round trip: %s', (sql) => {
    roundTrip(project('firestore'), sql);
  });

  it('writes SDK constraints, prefix ranges and server aggregates', () => {
    const p = project('firestore');
    expect(native(p, "SELECT * FROM clientes WHERE nombre LIKE 'An%' ORDER BY nombre LIMIT 5").text).toBe(
      'query(\n  collection(db, "clientes"),\n  where("nombre", ">=", "An"),\n  where("nombre", "<", "An"),\n  orderBy("nombre"),\n  limit(5)\n)',
    );
    expect(native(p, "SELECT * FROM pedidos WHERE estado = 'pagado' OR total > 10").text).toContain('or(\n');
    expect(native(p, 'SELECT COUNT(*) FROM pedidos').text).toContain('getAggregateFromServer(');
    const like = native(p, "SELECT * FROM clientes WHERE nombre LIKE '%a%'");
    expect(like.diagnostics.some((d) => d.severity === 'warning')).toBe(true);
  });
});

describe('diagnostics against the model', () => {
  it('flags unknown names with the closest one as a fix', () => {
    const p = project();
    const check = (sql: string) => bindQuery(p, parseSql(sql).ir!).diagnostics;
    const [field] = check('SELECT nombr FROM clientes');
    expect(field).toMatchObject({ severity: 'error', pos: { start: 7, end: 12 }, fix: { text: 'nombre' } });
    const [coll] = check('SELECT * FROM pedido');
    expect(coll).toMatchObject({ pos: { start: 14, end: 20 }, fix: { text: 'pedidos' } });
    const [alias] = check('SELECT x.nombre FROM clientes c');
    expect(alias).toMatchObject({ severity: 'error', pos: { start: 7, end: 8 }, fix: { text: 'c' } });
    expect(check("SELECT * FROM pedidos WHERE total LIKE '1%'")[0].severity).toBe('warning');
    expect(check('SELECT * FROM clientes c JOIN pedidos p ON p.clienteId = c._id WHERE c.direccion.ciudad = 1')).toEqual([]);
  });

  it('reports syntax errors where they happen', () => {
    expect(parseSql('SELECT * FROM').diagnostics[0]).toMatchObject({ severity: 'error', pos: { start: 13, end: 13 } });
    expect(parseSql("SELECT * FROM a WHERE b = 'x").diagnostics[0].pos).toEqual({ start: 26, end: 28 });
    expect(parseNative(project(), 'db.pedidos.find({ a: ').diagnostics[0].severity).toBe('error');
  });
});
