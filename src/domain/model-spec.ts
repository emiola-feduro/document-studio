import { t } from '../i18n';
import { ENGINES } from './engines';
import { indexName } from './indexes';
import { collectionPath } from './model';
import { walkFields } from './paths';
import { displayType } from './outputs/json-schema';
import type { Collection, Field, Project } from './types';

/** Portable description of the model for coding agents. */
export type SpecField = {
  path: string;
  type: string;
  engineType: string;
  required: boolean;
  nullable: boolean;
  description?: string;
  default?: string;
  enum?: string[];
  constraints?: Record<string, number | string | boolean>;
  references?: string;
};

export type SpecRelation = {
  kind: 'embed' | 'reference';
  field: string;
  target: string;
  cardinality: string;
  storage: 'single' | 'array';
  twoWay?: boolean;
  reverseField?: string;
};

export type SpecIndex = { name: string; keys: { path: string; order: string | number }[]; unique?: boolean; sparse?: boolean; partialFilter?: string; scope?: string };

export type SpecCollection = {
  name: string;
  path: string;
  kind: 'collection' | 'subcollection';
  parent?: string;
  notes?: string;
  fields: SpecField[];
  relations: SpecRelation[];
  indexes: SpecIndex[];
  options?: Record<string, unknown>;
};

export type ModelSpec = { project: string; engine: string; database?: string; collections: SpecCollection[] };

const fieldSpec = (project: Project, field: Field, path: string): SpecField => {
  const constraints: Record<string, number | string | boolean> = {};
  for (const key of ['minLength', 'maxLength', 'pattern', 'minimum', 'maximum', 'exclusiveMin', 'minItems', 'maxItems', 'uniqueItems'] as const) {
    if (field[key] !== undefined) constraints[key] = field[key] as number | string | boolean;
  }
  const holder = field.type === 'array' ? field.items : field;
  const target = holder?.reference && project.collections.find((c) => c.id === holder.reference!.collectionId);
  return {
    path,
    type: field.type === 'array' ? `array<${field.items?.type ?? 'any'}>` : field.type,
    engineType: displayType(project.engine, field),
    required: field.required,
    nullable: field.nullable,
    ...(field.description ? { description: field.description } : {}),
    ...(field.defaultValue ? { default: field.defaultValue } : {}),
    ...(field.enumValues?.length ? { enum: field.enumValues } : field.items?.enumValues?.length ? { enum: field.items.enumValues } : {}),
    ...(Object.keys(constraints).length ? { constraints } : {}),
    ...(target ? { references: `${target.name}.${holder!.reference!.fieldPath}` } : {}),
  };
};

const collectionSpec = (project: Project, collection: Collection): SpecCollection => {
  const nameOf = (id: string) => project.collections.find((c) => c.id === id)?.name ?? '?';
  const relations: SpecRelation[] = project.relationships
    .filter((r) => r.from.collectionId === collection.id)
    .map((r) => ({
      kind: r.kind,
      field: r.from.fieldPath,
      target: nameOf(r.to.collectionId),
      cardinality: r.cardinality,
      storage: r.storage,
      ...(r.twoWay ? { twoWay: true, reverseField: r.reverseFieldPath } : {}),
    }));
  const options = Object.fromEntries(Object.entries(collection.options).filter(([, v]) => v !== undefined));
  return {
    name: collection.name,
    path: collectionPath(project, collection),
    kind: collection.kind,
    ...(collection.parentId ? { parent: nameOf(collection.parentId) } : {}),
    ...(collection.notes ? { notes: collection.notes } : {}),
    fields: walkFields(collection.fields).map(({ field, path }) => fieldSpec(project, field, path)),
    relations,
    indexes: collection.indexes.map((i) => ({
      name: indexName(i),
      keys: i.keys.map((k) => ({ path: k.path, order: k.order })),
      ...(i.unique ? { unique: true } : {}),
      ...(i.sparse ? { sparse: true } : {}),
      ...(i.partialFilter ? { partialFilter: i.partialFilter } : {}),
      ...(i.scope ? { scope: i.scope } : {}),
    })),
    ...(Object.keys(options).length ? { options } : {}),
  };
};

export const buildModelSpec = (project: Project, collectionIds?: string[]): ModelSpec => ({
  project: project.name,
  engine: ENGINES[project.engine].name,
  ...(project.databaseName ? { database: project.databaseName } : {}),
  collections: project.collections.filter((c) => !collectionIds || collectionIds.includes(c.id)).map((c) => collectionSpec(project, c)),
});

export type AgentExportOptions = {
  /** Library or framework the agent should write for. Empty lets the agent ask. */
  target?: string;
  notes?: string;
  /** The engine's script appended as an exact reference. */
  script?: string;
};

export const agentInstructions = ({ target, notes }: AgentExportOptions, engine: string) => {
  const lines = [
    target?.trim() ? t('agentExport.instructionsTarget', { target: target.trim(), engine }) : t('agentExport.instructionsAny', { engine }),
    t('agentExport.instructionsRules'),
  ];
  if (notes?.trim()) lines.push(t('agentExport.notes', { notes: notes.trim() }));
  return lines.join('\n\n');
};

export const toAgentJson = (spec: ModelSpec, options: AgentExportOptions) =>
  `${JSON.stringify(
    {
      format: 'document-studio.model-spec',
      version: 1,
      instructions: agentInstructions(options, spec.engine),
      ...(options.target?.trim() ? { target: options.target.trim() } : {}),
      ...spec,
      ...(options.script ? { script: options.script } : {}),
    },
    null,
    2,
  )}\n`;

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

const constraintText = (f: SpecField) =>
  [
    f.enum && t('agentExport.enumValues', { values: f.enum.join(', ') }),
    f.default && t('agentExport.default', { value: f.default }),
    ...Object.entries(f.constraints ?? {}).map(([k, v]) => `${k}: ${v}`),
    f.references && t('agentExport.references', { target: f.references }),
  ]
    .filter(Boolean)
    .join('; ');

export const toAgentMarkdown = (spec: ModelSpec, options: AgentExportOptions) => {
  const out = [`# ${t('agentExport.title', { project: spec.project })}`, '', `## ${t('agentExport.instructions')}`, '', agentInstructions(options, spec.engine), ''];
  out.push(`- ${t('agentExport.engine')}: ${spec.engine}`);
  if (spec.database) out.push(`- ${t('agentExport.database')}: ${spec.database}`);
  out.push('', `## ${t('agentExport.collections')}`, '');
  for (const c of spec.collections) {
    out.push(`### ${c.name}`, '');
    if (c.kind === 'subcollection') out.push(t('agentExport.subcollection', { path: c.path }), '');
    if (c.notes) out.push(c.notes, '');
    out.push(
      `| ${t('agentExport.col.path')} | ${t('agentExport.col.type')} | ${t('agentExport.col.required')} | ${t('agentExport.col.nullable')} | ${t('agentExport.col.constraints')} | ${t('agentExport.col.description')} |`,
      '|---|---|---|---|---|---|',
    );
    for (const f of c.fields) {
      out.push(`| \`${cell(f.path)}\` | ${cell(f.type)} (${cell(f.engineType)}) | ${f.required ? t('agentExport.yes') : t('agentExport.no')} | ${f.nullable ? t('agentExport.yes') : t('agentExport.no')} | ${cell(constraintText(f))} | ${cell(f.description ?? '')} |`);
    }
    out.push('');
    if (c.relations.length) {
      out.push(`**${t('agentExport.relations')}**`, '');
      for (const r of c.relations) {
        const kind = r.kind === 'embed' ? t('agentExport.embedded') : t('agentExport.referenced');
        out.push(`- \`${r.field}\`: ${kind} ${r.target}, ${r.cardinality}, ${r.storage === 'array' ? t('agentExport.array') : t('agentExport.single')}${r.twoWay ? `, ${t('agentExport.twoWay', { field: r.reverseField ?? '' })}` : ''}`);
      }
      out.push('');
    }
    if (c.indexes.length) {
      out.push(`**${t('agentExport.indexes')}**`, '');
      for (const i of c.indexes) {
        const flags = [i.unique && 'unique', i.sparse && 'sparse', i.partialFilter && `partial ${i.partialFilter}`, i.scope].filter(Boolean).join(', ');
        out.push(`- ${i.name}: ${i.keys.map((k) => `${k.path} ${k.order}`).join(', ')}${flags ? ` (${flags})` : ''}`);
      }
      out.push('');
    }
    if (c.options) out.push(`**${t('agentExport.options')}**: \`${JSON.stringify(c.options)}\``, '');
  }
  if (options.script) out.push(`## ${t('agentExport.script')}`, '', '```', options.script.trimEnd(), '```', '');
  return out.join('\n');
};
