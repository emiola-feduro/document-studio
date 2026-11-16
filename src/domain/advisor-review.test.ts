import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import { applyIssueFix, dismissIssue, restoreDismissedIssues } from '../lib/actions';
import { db } from '../lib/db';
import { createSampleProject } from '../lib/sample-project';
import useProjectStore from '../stores/use-project-store';
import { activeIssues, adviseProject, MANY_FIELDS, type Issue } from './advisor';
import { createCollection, createField, createProject } from './model';
import { fieldAtPath } from './paths';
import { createRelationship } from './relationships';

const find = (issues: Issue[], code: string) => issues.find((i) => i.code === code);

const blog = () => {
  const p = createProject('p', 'mongodb');
  const autores = createCollection('mongodb', 'autores');
  autores.fields.push(createField({ name: 'nombre' }), createField({ name: 'edad', type: 'int' }));
  const posts = createCollection('mongodb', 'posts');
  posts.fields.push(createField({ name: 'titulo' }), createField({ name: 'edad', type: 'string' }));
  const comentarios = createCollection('mongodb', 'comentarios');
  comentarios.fields.push(createField({ name: 'texto' }));
  p.collections.push(autores, posts, comentarios);
  return { p, autores, posts, comentarios };
};

describe('design review rules', () => {
  it('flags the same collection embedded in several places until a pattern is declared', () => {
    const { p, autores, posts, comentarios } = blog();
    createRelationship(p, { kind: 'embed', fromId: posts.id, toId: autores.id, cardinality: '1:1' });
    createRelationship(p, { kind: 'embed', fromId: comentarios.id, toId: autores.id, cardinality: '1:1' });
    const issues = adviseProject(p).filter((i) => i.code === 'embed-copies');
    expect(issues).toHaveLength(2);
    expect(issues[0].fixes?.map((f) => f.kind)).toEqual(['declarePattern', 'declarePattern']);
    p.relationships[0].pattern = 'extendedReference';
    expect(adviseProject(p).filter((i) => i.code === 'embed-copies')).toHaveLength(1);
  });

  it('flags the same field with different types in related collections', () => {
    const { p, autores, posts } = blog();
    createRelationship(p, { kind: 'reference', fromId: posts.id, toId: autores.id, cardinality: '1:N' });
    const issue = find(adviseProject(p), 'type-mismatch')!;
    expect(issue).toMatchObject({ collectionId: posts.id, path: 'edad', level: 'warning' });
    expect(issue.fixes).toEqual([{ kind: 'setType', collectionId: posts.id, path: 'edad', type: 'int' }]);
  });

  it('suggests the attribute pattern for wide documents and schemaVersion for big ones', () => {
    const p = createProject('p', 'mongodb');
    const wide = createCollection('mongodb', 'productos');
    for (let i = 0; i <= MANY_FIELDS; i += 1) wide.fields.push(createField({ name: `atributo${i}` }));
    p.collections.push(wide);
    const issues = adviseProject(p);
    expect(find(issues, 'many-fields')?.level).toBe('info');
    expect(find(issues, 'schema-version')?.fixes).toEqual([{ kind: 'addSchemaVersion', collectionId: wide.id }]);
  });

  it('gives each issue an id that does not depend on the language', () => {
    const p = createSampleProject();
    p.collections[1].indexes = [];
    setLocale('es');
    const es = adviseProject(p).map((i) => i.id);
    setLocale('en');
    const en = adviseProject(p).map((i) => i.id);
    setLocale('es');
    expect(en).toEqual(es);
    expect(new Set(es).size).toBe(es.length);
    expect(es).toContain(`ref-index|${p.collections[1].id}||clienteId|`);
  });
});

const store = () => useProjectStore.getState();

describe('quick fixes', () => {
  beforeEach(async () => {
    await db.projects.clear();
    useProjectStore.setState({ status: 'loading', projects: [], project: null, past: [], future: [] });
    await store().init();
  });

  const pedidos = () => store().project!.collections.find((c) => c.name === 'pedidos')!;

  it('creates the missing index of a reference field, and undo removes it', () => {
    store().mutate((d) => void (d.collections.find((c) => c.name === 'pedidos')!.indexes = []));
    const issue = find(activeIssues(store().project!).issues, 'ref-index')!;
    applyIssueFix(issue.fixes![0]);
    expect(pedidos().indexes.map((i) => i.keys[0].path)).toEqual(['clienteId']);
    expect(find(activeIssues(store().project!).issues, 'ref-index')?.path).toBe('items[].productoId');
    store().undo();
    expect(pedidos().indexes).toEqual([]);
  });

  it('limits an unbounded array or turns the embed into references', () => {
    store().mutate((d) => void delete fieldAtPath(d.collections.find((c) => c.name === 'pedidos')!.fields, 'items')!.maxItems);
    const issue = find(activeIssues(store().project!).issues, 'unbounded-array')!;
    expect(issue.fixes?.map((f) => f.kind)).toEqual(['addMaxItems', 'changeKind']);
    applyIssueFix(issue.fixes![0]);
    expect(fieldAtPath(pedidos().fields, 'items')?.maxItems).toBe(100);
    store().undo();
    applyIssueFix(issue.fixes![1]);
    const rel = store().project!.relationships.find((r) => r.id === (issue.fixes![1] as { relationshipId: string }).relationshipId)!;
    expect(rel.kind).toBe('reference');
  });

  it('adds schemaVersion right after _id', () => {
    applyIssueFix({ kind: 'addSchemaVersion', collectionId: pedidos().id });
    expect(pedidos().fields.slice(0, 2).map((f) => f.name)).toEqual(['_id', 'schemaVersion']);
    expect(pedidos().fields[1]).toMatchObject({ type: 'int', required: true, defaultValue: '1' });
  });

  it('ignores an issue, keeps it ignored and restores it', () => {
    store().mutate((d) => void (d.collections.find((c) => c.name === 'pedidos')!.indexes = []));
    const before = activeIssues(store().project!);
    const issue = find(before.issues, 'ref-index')!;
    dismissIssue(issue.id);
    const after = activeIssues(store().project!);
    expect(after.issues.some((i) => i.id === issue.id)).toBe(false);
    expect(after.dismissedCount).toBe(1);
    // An unrelated edit keeps the same issue ignored.
    store().mutate((d) => void (d.collections[0].name = 'clientes2'));
    expect(activeIssues(store().project!).issues.some((i) => i.id === issue.id)).toBe(false);
    restoreDismissedIssues();
    expect(activeIssues(store().project!).issues.some((i) => i.id === issue.id)).toBe(true);
  });
});
