import { t } from '../../i18n';
import { docIdParam } from '../model';
import { pascalCase } from '../naming';
import type { Collection, Field, Project } from '../types';
import { childrenOf, rootCollections, type OutputResult } from './shared';

const RULES_TYPE: Partial<Record<Field['type'], string>> = {
  string: 'string',
  enum: 'string',
  int: 'int',
  long: 'int',
  double: 'number',
  number: 'number',
  decimal: 'number',
  bool: 'bool',
  date: 'timestamp',
  timestamp: 'timestamp',
  object: 'map',
  array: 'list',
  geoPoint: 'latlng',
  reference: 'path',
  binary: 'bytes',
  objectId: 'string',
  uuid: 'string',
};

/** Rules strings are single quoted. */
const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const access = (base: string, name: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? `${base}.${name}` : `${base}[${q(name)}]`);

/** Conditions that a value must meet, already joined with &&. */
const valueChecks = (field: Field, expr: string, warnings: string[], where: string): string[] => {
  const checks: string[] = [];
  if (field.type === 'null') return [`${expr} == null`];
  const type = RULES_TYPE[field.type];
  if (type) checks.push(`${expr} is ${type}`);
  if (field.type === 'enum' && field.enumValues?.length) checks.push(`${expr} in [${field.enumValues.map(q).join(', ')}]`);
  if (field.minLength !== undefined) checks.push(`${expr}.size() >= ${field.minLength}`);
  if (field.maxLength !== undefined) checks.push(`${expr}.size() <= ${field.maxLength}`);
  if (field.pattern) checks.push(`${expr}.matches(${q(field.pattern.replace(/^\^/, '').replace(/\$$/, ''))})`);
  if (field.minimum !== undefined && ['int', 'long', 'double', 'number', 'decimal'].includes(field.type)) {
    checks.push(`${expr} ${field.exclusiveMin ? '>' : '>='} ${field.minimum}`);
  }
  if (field.maximum !== undefined && ['int', 'long', 'double', 'number', 'decimal'].includes(field.type)) checks.push(`${expr} <= ${field.maximum}`);
  if (field.minItems !== undefined) checks.push(`${expr}.size() >= ${field.minItems}`);
  if (field.maxItems !== undefined) checks.push(`${expr}.size() <= ${field.maxItems}`);
  if (field.type === 'object') checks.push(...objectChecks(field.children ?? [], expr, warnings, where, false));
  if (field.type === 'array' && field.items && field.items.type !== 'any' && (field.items.type !== 'string' || field.items.enumValues)) {
    // Rules have no loops, so array elements cannot be checked one by one.
    warnings.push(t('output.rulesArrayItems', { path: where }));
  }
  return checks;
};

const objectChecks = (fields: Field[], base: string, warnings: string[], where: string, root: boolean, strict?: boolean): string[] => {
  const named = fields.filter((f) => f.name && !(root && f.name === '_id'));
  const checks: string[] = [];
  const required = named.filter((f) => f.required).map((f) => q(f.name));
  if (required.length) checks.push(`${base}.keys().hasAll([${required.join(', ')}])`);
  if (strict) checks.push(`${base}.keys().hasOnly([${named.map((f) => q(f.name)).join(', ')}])`);
  for (const field of named) {
    const expr = access(base, field.name);
    const inner = valueChecks(field, expr, warnings, where ? `${where}.${field.name}` : field.name);
    if (inner.length === 0) continue;
    let cond = inner.length === 1 ? inner[0] : `(${inner.join(' && ')})`;
    if (field.nullable && field.type !== 'null') cond = `(${expr} == null || ${cond})`;
    if (!field.required) cond = `(!(${q(field.name)} in ${base}) || ${cond})`;
    checks.push(cond);
  }
  return checks;
};

const functionName = (collection: Collection) => `isValid${pascalCase(collection.name)}`;

const matchBlock = (project: Project, collection: Collection, indent: string): string[] => {
  const id = docIdParam(collection);
  const lines = [
    `${indent}match /${collection.name}/{${id}} {`,
    `${indent}  allow read: if request.auth != null;`,
    `${indent}  allow create, update: if request.auth != null && ${functionName(collection)}(request.resource.data);`,
    `${indent}  allow delete: if request.auth != null;`,
  ];
  for (const child of childrenOf(project, collection)) lines.push('', ...matchBlock(project, child, `${indent}  `));
  lines.push(`${indent}}`);
  return lines;
};

/** firestore.rules: a validation function per collection and match blocks with subcollections nested. */
export const firestoreRules = (project: Project): OutputResult => {
  const warnings: string[] = [];
  const functions = project.collections.map((collection) => {
    const checks = objectChecks(collection.fields, 'data', warnings, collection.name, true, collection.options.additionalProperties === false);
    const body = checks.length ? checks.join('\n        && ') : 'true';
    return `    // ${collection.name}\n    function ${functionName(collection)}(data) {\n      return ${body};\n    }`;
  });
  const matches = rootCollections(project).flatMap((c) => ['', ...matchBlock(project, c, '    ')]);
  const code = [
    "rules_version = '2';",
    '',
    'service cloud.firestore {',
    '  match /databases/{database}/documents {',
    functions.join('\n\n'),
    ...matches,
    '  }',
    '}',
    '',
  ].join('\n');
  return { code, warnings: [...new Set(warnings)] };
};
