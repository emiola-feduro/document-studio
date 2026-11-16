import { t, type Locale, LOCALES } from '../../i18n';
import { importFirestoreIndexes, importJsonSchema, parseDocumentsText, planImport } from '../infer';
import { camelCase, singularize } from '../naming';
import { toMongoPath, walkFields } from '../paths';
import type { Collection, EngineId, Project, Relationship } from '../types';
import { readMongoose } from './mongoose';
import { readPrisma } from './prisma';
import type { ImportFormat, SchemaImport } from './types';

export type { ImportFormat, SchemaImport } from './types';

/** Format of a pasted or uploaded source, from what it looks like. */
export const detectFormat = (text: string): ImportFormat | undefined => {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (/^\s*(model|datasource|generator)\s+\w+\s*\{/m.test(trimmed)) return 'prisma';
  if (/new\s+(?:mongoose\.)?Schema\s*(?:<[^>]*>)?\(/.test(trimmed)) return 'mongoose';
  try {
    const data = JSON.parse(trimmed) as unknown;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const o = data as Record<string, unknown>;
      if (Array.isArray(o.indexes) && (o.fieldOverrides !== undefined || o.indexes.every((i) => i && typeof i === 'object' && 'collectionGroup' in i))) return 'firestoreIndexes';
      if (/"\$jsonSchema"|"bsonType"/.test(trimmed)) return 'jsonSchema';
      return 'documents';
    }
    if (Array.isArray(data)) return data.some((d) => d && typeof d === 'object' && ('options' in d || 'info' in d) && /"\$jsonSchema"/.test(JSON.stringify(d))) ? 'jsonSchema' : 'documents';
  } catch {
    // Several JSON documents, one per line.
    if (trimmed.split('\n').every((l) => !l.trim() || /^\s*\{/.test(l))) return 'documents';
  }
  return undefined;
};

/** Field words that are typical of each language, to break ties between singular rules. */
const COMMON_WORDS: Record<Locale, Set<string>> = {
  es: new Set(['nombre', 'correo', 'fecha', 'precio', 'cantidad', 'direccion', 'ciudad', 'estado', 'creado', 'usuario', 'usuarios', 'cliente', 'clientes', 'producto', 'productos', 'calle', 'telefono', 'descripcion', 'titulo', 'activo']),
  en: new Set(['name', 'email', 'date', 'price', 'quantity', 'address', 'city', 'status', 'created', 'updated', 'user', 'users', 'customer', 'customers', 'product', 'products', 'street', 'phone', 'description', 'title', 'active']),
  fr: new Set(['nom', 'courriel', 'prix', 'quantite', 'adresse', 'ville', 'statut', 'cree', 'utilisateur', 'utilisateurs', 'client', 'clients', 'produit', 'produits', 'rue', 'telephone', 'titre', 'actif']),
  pt: new Set(['nome', 'preco', 'quantidade', 'endereco', 'cidade', 'criado', 'usuario', 'usuarios', 'cliente', 'clientes', 'produto', 'produtos', 'rua', 'telefone', 'descricao', 'titulo', 'ativo']),
};

/**
 * Language of the names: the one whose singular rules best explain the reference fields (clienteId
 * pointing at clientes says Spanish, customerId at customers says English). Undefined when nothing tells.
 */
export const detectNamesLocale = (collections: Collection[], relationships: Relationship[]): Locale | undefined => {
  const score = new Map<Locale, number>();
  for (const rel of relationships) {
    const target = collections.find((c) => c.id === rel.to.collectionId);
    if (!target) continue;
    const base = camelCase(toMongoPath(rel.from.fieldPath).split('.').pop()!.replace(/(_ids?|Ids?)$/, '')).toLowerCase();
    for (const { id } of LOCALES) if (camelCase(singularize(target.name, id)).toLowerCase() === base) score.set(id, (score.get(id) ?? 0) + 1);
  }
  // Ties (clientes is cliente in every language) are broken by common words in the field names.
  const words = collections.flatMap((c) => [c.name, ...walkFields(c.fields).map((e) => e.field.name)]).flatMap((n) => n.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z]+/));
  const lexicon = (id: Locale) => words.filter((w) => COMMON_WORDS[id].has(w)).length;
  const best = Math.max(0, ...score.values());
  const candidates = best ? LOCALES.map((l) => l.id).filter((id) => score.get(id) === best) : LOCALES.map((l) => l.id);
  const ranked = candidates.map((id) => [id, lexicon(id)] as const).sort((a, b) => b[1] - a[1]);
  if (candidates.length === 1) return candidates[0];
  if (!ranked.length || ranked[0][1] === 0 || (ranked[1] && ranked[1][1] === ranked[0][1])) return undefined;
  return ranked[0][0];
};

/** Reads a source in a given format into collections for the project (documents, schemas or models). */
export const readSource = (project: Project, format: ImportFormat, sources: { name: string; text: string }[]): SchemaImport => {
  const engine: EngineId = project.engine;
  if (format === 'documents') {
    const inputs = sources.map((s) => ({ name: s.name, docs: parseDocumentsText(s.text) }));
    if (inputs.every((i) => i.docs.length === 0)) throw new Error(t('infer.noDocuments'));
    const plan = planImport(project, inputs);
    return {
      collections: plan.collections.map((c) => c.collection),
      relationships: plan.relationships,
      documents: Object.fromEntries(plan.collections.map((c) => [c.collection.id, c.documents])),
      stats: Object.fromEntries(plan.collections.map((c) => [c.collection.id, c.stats])),
      warnings: plan.warnings,
      skipped: [],
    };
  }
  if (format === 'jsonSchema') {
    const collections = sources.flatMap((s) => importJsonSchema(s.text, engine, s.name));
    return { collections, relationships: [], documents: {}, stats: {}, warnings: [], skipped: [] };
  }
  if (format === 'firestoreIndexes') {
    // Indexes go to the collections that already exist; the preview counts them on a copy.
    const copy = structuredClone(project);
    const added = sources.reduce((n, s) => n + importFirestoreIndexes(copy, s.text), 0);
    return { collections: [], relationships: [], documents: {}, stats: {}, warnings: added ? [] : [t('infer.indexesImported', { count: 0 })], skipped: [] };
  }
  const merged = sources.map((s) => (format === 'mongoose' ? readMongoose(s.text, engine) : readPrisma(s.text, engine)));
  return {
    collections: merged.flatMap((m) => m.collections),
    relationships: merged.flatMap((m) => m.relationships),
    documents: {},
    stats: {},
    warnings: merged.flatMap((m) => m.warnings),
    skipped: merged.flatMap((m) => m.skipped),
  };
};
