import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readMongosh } from '../import/mongosh';
import { detectFormat } from '../import';
import { importJsonSchema } from '../infer';
import { createProject } from '../model';
import type { Project } from '../types';
import { mongoJsonSchemaOutput } from './json-schema';
import { mongoCreateScript } from './mongodb-create';

const SAMPLE = readFileSync(new URL('./fixtures/validators-sample.json', import.meta.url), 'utf8');
const SCRIPT = readFileSync(new URL('./fixtures/app-mongosh.js', import.meta.url), 'utf8');

const projectWith = (collections: Project['collections'], databaseName = 'academic') => ({ ...createProject('p', 'mongodb', databaseName), collections });

/** Runs a mongosh script against a fake db that already has `existing` collections. */
const run = (code: string, existing: string[] = []) => {
  const calls: { method: string; args: unknown[]; target?: string }[] = [];
  const collection = (target: string) => new Proxy({}, { get: (_t, m) => (...args: unknown[]) => calls.push({ method: String(m), args, target }) });
  const db = new Proxy(
    {},
    {
      get: (_t, key) => {
        if (key === 'getCollectionNames') return () => existing;
        if (key === 'createCollection' || key === 'runCommand' || key === 'dropDatabase') return (...args: unknown[]) => calls.push({ method: String(key), args });
        if (key === 'getCollection') return (n: string) => collection(n);
        return collection(String(key));
      },
    },
  );
  const used: string[] = [];
  new Function('db', 'use', code)(db, (name: string) => used.push(name));
  return { calls, used };
};

describe('MongoDB validators round trip', () => {
  it('imports the sample validators and exports exactly the same JSON', () => {
    const collections = importJsonSchema(SAMPLE, 'mongodb', 'x');
    expect(collections.map((c) => c.name)).toEqual(['users', 'courses', 'sessions', 'academicPeriods', 'courseInstances', 'migrations']);
    const exported = JSON.parse(mongoJsonSchemaOutput(projectWith(collections)).code);
    expect(exported).toEqual(JSON.parse(SAMPLE));
  });

  it('keeps "number", ["null", "array"], titles and nested items as written', () => {
    const [users, courses, , academic, instances] = importJsonSchema(SAMPLE, 'mongodb', 'x');
    expect(users.options.validatorTitle).toBe('Users Validations');
    expect(courses.fields.find((f) => f.name === 'averageGrade')?.type).toBe('number');
    const nullable = academic.fields.find((f) => f.name === 'courseInstances')!;
    expect(nullable).toMatchObject({ type: 'array', nullable: true, nullFirst: true });
    const entries = instances.fields.find((f) => f.name === 'breakdowns')!.items!.children!.find((f) => f.name === 'entries')!;
    expect(entries.items?.children?.map((f) => f.name)).toEqual(['name', 'rawScore', 'maxScore']);
  });

  it('writes a creation script that creates the 6 collections with the same validators and can run again', () => {
    const project = projectWith(importJsonSchema(SAMPLE, 'mongodb', 'x'));
    const { code, warnings } = mongoCreateScript(project);
    expect(warnings).toEqual([]);
    const first = run(code);
    expect(first.used).toEqual(['academic']);
    const created = first.calls.filter((c) => c.method === 'createCollection');
    expect(created.map((c) => c.args[0])).toEqual(['users', 'courses', 'sessions', 'academicPeriods', 'courseInstances', 'migrations']);
    const sample = JSON.parse(SAMPLE);
    for (const c of created) {
      const options = c.args[1] as { validator: unknown; validationLevel: string; validationAction: string };
      expect(options.validator).toEqual(sample[c.args[0] as string]);
      expect(options).toMatchObject({ validationLevel: 'strict', validationAction: 'error' });
    }
    // Second run: every collection exists, so the validators go through collMod.
    const second = run(code, Object.keys(sample));
    expect(second.calls.filter((c) => c.method === 'createCollection')).toEqual([]);
    const mods = second.calls.filter((c) => c.method === 'runCommand').map((c) => c.args[0] as { collMod: string; validator: unknown });
    expect(mods.map((m) => m.collMod)).toEqual(Object.keys(sample));
    expect(mods[0].validator).toEqual(sample.users);
  });

  it('drops the database first only when asked, and warns when the database has no name', () => {
    const project = projectWith(importJsonSchema(SAMPLE, 'mongodb', 'x'), '');
    expect(run(mongoCreateScript(project).code).calls.some((c) => c.method === 'dropDatabase')).toBe(false);
    const { code, warnings } = mongoCreateScript(project, { dropFirst: true });
    expect(run(code).calls[0].method).toBe('dropDatabase');
    expect(warnings[0]).toMatch(/base de datos/);
  });
});

describe('mongosh script import', () => {
  it('reads createCollection with $jsonSchema and $expr, createIndex and the database', () => {
    expect(detectFormat(SCRIPT)).toBe('mongosh');
    const result = readMongosh(SCRIPT, 'mongodb');
    expect(result.databaseName).toBe('app');
    expect(result.collections.map((c) => c.name)).toEqual(['users', 'courses', 'sessions', 'academicPeriods', 'courseInstances', 'migrations']);
    const [users, , sessions, , , migrations] = result.collections;
    expect(users.options).toMatchObject({ validationLevel: 'strict', validationAction: 'error', validatorTitle: 'Users Validations' });
    expect(users.indexes).toMatchObject([{ keys: [{ path: 'email', order: 1 }], unique: true }]);
    expect(migrations.indexes).toMatchObject([{ name: 'unique_migration_name', nameIsCustom: true, unique: true }]);
    expect(JSON.parse(sessions.options.extraValidator!)).toEqual({ $expr: { $gt: ['$expiresAt', '$issuedAt'] } });
  });

  it('writes the same validators back, $expr included, and reads its own creation script', () => {
    const imported = readMongosh(SCRIPT, 'mongodb');
    const project = projectWith(imported.collections, imported.databaseName);
    const { calls } = run(mongoCreateScript(project).code);
    const sessions = calls.find((c) => c.method === 'createCollection' && c.args[0] === 'sessions')!.args[1] as { validator: { $and: unknown[] } };
    expect(sessions.validator.$and[1]).toEqual({ $expr: { $gt: ['$expiresAt', '$issuedAt'] } });
    expect(calls.filter((c) => c.method === 'createIndex').map((c) => c.target)).toEqual(['users', 'migrations']);
    // The app's own script reads back into the same validators.
    const again = readMongosh(mongoCreateScript(project).code, 'mongodb');
    expect(JSON.parse(mongoJsonSchemaOutput(projectWith(again.collections)).code)).toEqual(JSON.parse(mongoJsonSchemaOutput(project).code));
  });
});
