import { describe, expect, it } from 'vitest';
import { createSampleProject } from './sample-project';
import { parseProjectFile, serializeProject } from './project-file';

describe('project file', () => {
  it('round trips a project with a fresh id', () => {
    const project = createSampleProject();
    const parsed = parseProjectFile(serializeProject(project));
    expect(parsed.id).not.toBe(project.id);
    expect(parsed.collections).toEqual(project.collections);
    expect(parsed.relationships).toEqual(project.relationships);
  });

  it('rejects files that are not projects', () => {
    expect(() => parseProjectFile('nope')).toThrow();
    expect(() => parseProjectFile('{"name":"x","collections":[],"relationships":[],"engine":"oracle"}')).toThrow();
  });
});
