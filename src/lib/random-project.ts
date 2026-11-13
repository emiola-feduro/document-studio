import { generateRandomModel, type RandomModelOptions } from '../domain/random-model';
import { layoutProject } from './layout';

/** A random model laid out so it opens tidy. */
export const createRandomProject = (options: RandomModelOptions) => {
  const project = generateRandomModel(options);
  layoutProject(project);
  return project;
};
