import { describe, expect, it } from 'vitest';
import { adviseProject } from './advisor';
import { validateDocuments } from './documents';
import { storeFixture } from './outputs/fixtures';
import { generateAllDocuments, generateDocuments, seededRng, stringForPattern } from './random-values';
import { generateRandomModel, THEMES } from './random-model';
import { createField } from './model';
import type { EngineId } from './types';

const ENGINES: EngineId[] = ['mongodb', 'firestore', 'couchdb'];

describe('stringForPattern', () => {
  it('produces strings that match common patterns', () => {
    const rng = seededRng(1);
    for (const p of ['^[A-Z]{3}-[0-9]{4}$', '^[^@\\s]+@[^@\\s]+\\.[a-z]{2,}$', '^[a-z0-9]+(-[a-z0-9]+)*$', '^v[0-9]\\.[0-9]{1,2}\\.[0-9]{1,2}$', '^(si|no)$', '^\\d{5}$']) {
      const value = stringForPattern(p, rng);
      expect(value, p).toBeDefined();
      expect(new RegExp(p).test(value!), `${p} ${value}`).toBe(true);
    }
  });
});

describe('generated documents', () => {
  it.each(ENGINES)('pass validation in %s, with references to real ids', (engine) => {
    const project = storeFixture(engine);
    project.collections[1].fields.push(createField({ name: 'tags', type: 'array', uniqueItems: true, maxItems: 3, items: createField({ name: '', type: 'enum', enumValues: ['a', 'b', 'c', 'd'] }) }));
    project.documents = generateAllDocuments(project, { count: 20, locale: 'es', rng: seededRng(7) });
    for (const c of project.collections) {
      expect(project.documents[c.id]).toHaveLength(20);
      expect(validateDocuments(project, c).flatMap((r) => r.errors.map((e) => `${r.index} ${e.path} ${e.message}`))).toEqual([]);
    }
  });

  it('appends without repeating unique values', () => {
    const project = storeFixture('mongodb');
    const [customers] = project.collections;
    project.documents = { [customers.id]: generateDocuments(project, customers.id, { count: 30, locale: 'en', rng: seededRng(3) }) };
    project.documents[customers.id].push(...generateDocuments(project, customers.id, { count: 30, locale: 'en', rng: seededRng(3) }));
    expect(validateDocuments(project, customers).flatMap((r) => r.errors)).toEqual([]);
  });
});

describe('random models', () => {
  for (const theme of THEMES) {
    for (const engine of ENGINES) {
      it(`${theme.id} in ${engine} has no warnings and valid documents`, () => {
        const project = generateRandomModel({ engine, themeId: theme.id, collectionCount: 10, namesLocale: 'fr', documentsPerCollection: 8, rng: seededRng(11) });
        const issues = adviseProject(project).filter((i) => i.level !== 'info');
        expect(issues.map((i) => i.message)).toEqual([]);
        for (const c of project.collections) expect(validateDocuments(project, c).flatMap((r) => r.errors.map((e) => `${c.name} ${e.path} ${e.message}`))).toEqual([]);
      });
    }
  }

  it('names collections in the chosen language', () => {
    const es = generateRandomModel({ engine: 'mongodb', themeId: 'store', collectionCount: 2, namesLocale: 'es', rng: seededRng(1) });
    const pt = generateRandomModel({ engine: 'mongodb', themeId: 'store', collectionCount: 2, namesLocale: 'pt', rng: seededRng(1) });
    expect(es.collections.map((c) => c.name)).toEqual(['clientes', 'productos']);
    expect(pt.collections[1].name).toBe('produtos');
  });
});
