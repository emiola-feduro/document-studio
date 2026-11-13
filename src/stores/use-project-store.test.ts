import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createCollection } from '../domain/model';
import { db } from '../lib/db';
import useProjectStore from './use-project-store';

const store = () => useProjectStore.getState();

beforeEach(async () => {
  await db.projects.clear();
  useProjectStore.setState({ status: 'loading', projects: [], project: null, past: [], future: [] });
});

describe('project store', () => {
  it('starts with the sample store in MongoDB', async () => {
    await store().init();
    expect(store().status).toBe('ready');
    expect(store().project?.engine).toBe('mongodb');
    expect(store().project?.collections.map((c) => c.name)).toEqual(['clientes', 'pedidos', 'productos']);
  });

  it('creates, duplicates and deletes projects', async () => {
    await store().init();
    await store().createProject('Blog', 'firestore', ' blog ');
    expect(store().project).toMatchObject({ name: 'Blog', engine: 'firestore', databaseName: 'blog' });
    await store().duplicateProject(store().project!.id);
    expect(store().projects).toHaveLength(3);
    await store().deleteProject(store().project!.id);
    expect(store().projects).toHaveLength(2);
    expect(store().project).not.toBeNull();
  });

  it('undoes and redoes, grouping changes with the same key', async () => {
    await store().init();
    const before = store().project!.collections.length;
    store().mutate((d) => void d.collections.push(createCollection('mongodb', 'a')));
    store().mutate((d) => void (d.name = 'x'), 'name');
    store().mutate((d) => void (d.name = 'xy'), 'name');
    expect(store().past).toHaveLength(2);
    store().undo();
    expect(store().project!.name).not.toBe('xy');
    expect(store().project!.collections).toHaveLength(before + 1);
    store().undo();
    expect(store().project!.collections).toHaveLength(before);
    store().redo();
    expect(store().project!.collections).toHaveLength(before + 1);
  });
});
