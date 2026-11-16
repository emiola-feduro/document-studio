import type { Locale } from '../i18n';
import { createCollection, createField, createProject, uid } from './model';
import { createRelationship } from './relationships';
import { suggestIndexName } from './indexes';
import { generateAllDocuments, type Rng } from './random-values';
import type { Cardinality, Collection, EngineId, Field, FieldType, Project } from './types';

/** Text in Spanish, English, French and Portuguese. */
type L = readonly [string, string, string, string];

const LOCALE_INDEX: Record<Locale, number> = { es: 0, en: 1, fr: 2, pt: 3 };
const pickName = (l: L, locale: Locale) => l[LOCALE_INDEX[locale]];

type FieldSpec = {
  name: L;
  type: FieldType;
  required?: boolean;
  nullable?: boolean;
  enum?: L[];
  children?: FieldSpec[];
  items?: FieldSpec;
  maxItems?: number;
  minItems?: number;
  uniqueItems?: boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  unique?: boolean;
  indexed?: boolean;
};

type CollectionSpec = {
  key: string;
  name: L;
  fields: FieldSpec[];
  /** MongoDB time series on this field. */
  timeField?: L;
  metaField?: L;
  /** In Firestore, nested under this collection. */
  subOf?: string;
};

type RelationSpec = { from: string; to: string; kind: 'embed' | 'reference'; cardinality: Cardinality; maxItems?: number; embed?: string[] };

export type ThemeSpec = { id: string; name: L; collections: CollectionSpec[]; relationships: RelationSpec[] };

const f = (name: L, type: FieldType, extra: Omit<FieldSpec, 'name' | 'type'> = {}): FieldSpec => ({ name, type, ...extra });

const N = {
  name: ['nombre', 'name', 'nom', 'nome'],
  email: ['email', 'email', 'email', 'email'],
  createdAt: ['creadoEn', 'createdAt', 'creeLe', 'criadoEm'],
  price: ['precio', 'price', 'prix', 'preco'],
  status: ['estado', 'status', 'statut', 'status'],
  title: ['titulo', 'title', 'titre', 'titulo'],
  text: ['contenido', 'content', 'contenu', 'conteudo'],
  description: ['descripcion', 'description', 'description', 'descricao'],
  city: ['ciudad', 'city', 'ville', 'cidade'],
  street: ['calle', 'street', 'rue', 'rua'],
  zip: ['codigoPostal', 'zipCode', 'codePostal', 'cep'],
  address: ['direccion', 'address', 'adresse', 'endereco'],
  tags: ['etiquetas', 'tags', 'etiquettes', 'tags'],
  date: ['fecha', 'date', 'date', 'data'],
  quantity: ['cantidad', 'quantity', 'quantite', 'quantidade'],
  stock: ['stock', 'stock', 'stock', 'estoque'],
  total: ['total', 'total', 'total', 'total'],
  rating: ['calificacion', 'rating', 'note', 'nota'],
  phone: ['telefono', 'phone', 'telephone', 'telefone'],
  active: ['activo', 'active', 'actif', 'ativo'],
  location: ['ubicacion', 'location', 'position', 'localizacao'],
  value: ['valor', 'value', 'valeur', 'valor'],
  unit: ['unidad', 'unit', 'unite', 'unidade'],
  sku: ['sku', 'sku', 'sku', 'sku'],
  bio: ['bio', 'bio', 'bio', 'bio'],
  username: ['usuario', 'username', 'pseudo', 'usuario'],
  slug: ['slug', 'slug', 'slug', 'slug'],
  publishedAt: ['publicadoEn', 'publishedAt', 'publieLe', 'publicadoEm'],
  likes: ['meGusta', 'likes', 'jaime', 'curtidas'],
  sentAt: ['enviadoEn', 'sentAt', 'envoyeLe', 'enviadoEm'],
  readBy: ['leidoPor', 'readBy', 'luPar', 'lidoPor'],
  attributes: ['atributos', 'attributes', 'attributs', 'atributos'],
  key: ['clave', 'key', 'cle', 'chave'],
  kind: ['tipo', 'kind', 'genre', 'tipo'],
  severity: ['severidad', 'severity', 'gravite', 'severidade'],
  firmware: ['firmware', 'firmware', 'firmware', 'firmware'],
  measuredAt: ['medidoEn', 'measuredAt', 'mesureLe', 'medidoEm'],
  metadata: ['metadatos', 'metadata', 'metadonnees', 'metadados'],
  sensor: ['sensor', 'sensor', 'capteur', 'sensor'],
  members: ['miembros', 'members', 'membres', 'membros'],
  private: ['privada', 'private', 'privee', 'privada'],
  avatar: ['avatarUrl', 'avatarUrl', 'avatarUrl', 'avatarUrl'],
  schemaVersion: ['schemaVersion', 'schemaVersion', 'schemaVersion', 'schemaVersion'],
  country: ['pais', 'country', 'pays', 'pais'],
  variants: ['variantes', 'variants', 'variantes', 'variantes'],
  color: ['color', 'color', 'couleur', 'cor'],
  size: ['talla', 'size', 'taille', 'tamanho'],
} as const satisfies Record<string, L>;

const status = (...values: L[]) => f(N.status, 'enum', { required: true, enum: values, indexed: true });

const address = () =>
  f(N.address, 'object', { children: [f(N.street, 'string', { maxLength: 120 }), f(N.city, 'string', { required: true, maxLength: 80 }), f(N.zip, 'string', { pattern: '^[0-9]{5}$' })] });

export const THEMES: ThemeSpec[] = [
  {
    id: 'store',
    name: ['Tienda en línea', 'Online store', 'Boutique en ligne', 'Loja online'],
    collections: [
      {
        key: 'customers',
        name: ['clientes', 'customers', 'clients', 'clientes'],
        fields: [
          f(N.name, 'string', { required: true, maxLength: 120 }),
          f(N.email, 'string', { required: true, unique: true, maxLength: 160, pattern: '^[^@\\s]+@[^@\\s]+\\.[a-z]{2,}$' }),
          f(N.phone, 'string', { maxLength: 30 }),
          address(),
          f(N.createdAt, 'date', { required: true }),
        ],
      },
      {
        key: 'products',
        name: ['productos', 'products', 'produits', 'produtos'],
        fields: [
          f(N.sku, 'string', { required: true, unique: true, pattern: '^[A-Z]{3}-[0-9]{4}$' }),
          f(N.name, 'string', { required: true, maxLength: 120 }),
          f(N.price, 'decimal', { required: true, minimum: 0, maximum: 5000 }),
          f(N.stock, 'int', { required: true, minimum: 0, maximum: 1000 }),
          f(N.tags, 'array', { items: f(['', '', '', ''], 'string', { maxLength: 30 }), maxItems: 8 }),
        ],
      },
      {
        key: 'orders',
        name: ['pedidos', 'orders', 'commandes', 'pedidos'],
        fields: [
          f(N.date, 'date', { required: true }),
          status(['pendiente', 'pending', 'en attente', 'pendente'], ['pagado', 'paid', 'payee', 'pago'], ['enviado', 'shipped', 'expediee', 'enviado']),
          f(N.total, 'decimal', { required: true, minimum: 0, maximum: 100000 }),
        ],
      },
      {
        key: 'reviews',
        name: ['resenas', 'reviews', 'avis', 'avaliacoes'],
        fields: [f(N.rating, 'int', { required: true, minimum: 1, maximum: 5 }), f(N.text, 'string', { maxLength: 1000 }), f(N.date, 'date', { required: true })],
      },
    ],
    relationships: [
      { from: 'orders', to: 'customers', kind: 'reference', cardinality: '1:N' },
      { from: 'orders', to: 'products', kind: 'embed', cardinality: '1:N', maxItems: 50, embed: ['sku', 'name', 'price'] },
      { from: 'reviews', to: 'customers', kind: 'reference', cardinality: '1:N' },
    ],
  },
  {
    id: 'blog',
    name: ['Blog', 'Blog', 'Blog', 'Blog'],
    collections: [
      {
        key: 'authors',
        name: ['autores', 'authors', 'auteurs', 'autores'],
        fields: [f(N.name, 'string', { required: true, maxLength: 80 }), f(N.email, 'string', { required: true, unique: true, maxLength: 160 }), f(N.bio, 'string', { maxLength: 500 })],
      },
      {
        key: 'posts',
        name: ['publicaciones', 'posts', 'articles', 'publicacoes'],
        fields: [
          f(N.title, 'string', { required: true, maxLength: 160 }),
          f(N.slug, 'string', { required: true, unique: true, pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' }),
          f(N.text, 'string', { required: true, maxLength: 20000 }),
          f(N.tags, 'array', { items: f(['', '', '', ''], 'string', { maxLength: 30 }), maxItems: 10, uniqueItems: true }),
          status(['borrador', 'draft', 'brouillon', 'rascunho'], ['publicado', 'published', 'publie', 'publicado']),
          f(N.publishedAt, 'date', { nullable: true }),
        ],
      },
      {
        key: 'comments',
        name: ['comentarios', 'comments', 'commentaires', 'comentarios'],
        subOf: 'posts',
        fields: [f(N.username, 'string', { required: true, maxLength: 60 }), f(N.text, 'string', { required: true, maxLength: 2000 }), f(N.date, 'date', { required: true })],
      },
    ],
    relationships: [
      { from: 'posts', to: 'authors', kind: 'reference', cardinality: '1:N' },
      { from: 'comments', to: 'posts', kind: 'reference', cardinality: '1:N' },
    ],
  },
  {
    id: 'social',
    name: ['Red social', 'Social network', 'Réseau social', 'Rede social'],
    collections: [
      {
        key: 'users',
        name: ['usuarios', 'users', 'utilisateurs', 'usuarios'],
        fields: [
          f(N.username, 'string', { required: true, unique: true, pattern: '^[a-z0-9_]{3,20}$' }),
          f(N.name, 'string', { required: true, maxLength: 80 }),
          f(N.bio, 'string', { maxLength: 300 }),
          f(N.avatar, 'string', { maxLength: 300 }),
          f(N.location, 'geoPoint'),
          f(N.createdAt, 'date', { required: true }),
        ],
      },
      {
        key: 'posts',
        name: ['publicaciones', 'posts', 'publications', 'postagens'],
        fields: [f(N.text, 'string', { required: true, maxLength: 2000 }), f(N.likes, 'int', { required: true, minimum: 0 }), f(N.publishedAt, 'date', { required: true })],
      },
      {
        key: 'follows',
        name: ['seguimientos', 'follows', 'abonnements', 'seguidores'],
        fields: [f(N.date, 'date', { required: true })],
      },
    ],
    relationships: [
      { from: 'posts', to: 'users', kind: 'reference', cardinality: '1:N' },
      { from: 'follows', to: 'users', kind: 'reference', cardinality: '1:N' },
    ],
  },
  {
    id: 'iot',
    name: ['Sensores IoT', 'IoT sensors', 'Capteurs IoT', 'Sensores IoT'],
    collections: [
      {
        key: 'devices',
        name: ['dispositivos', 'devices', 'appareils', 'dispositivos'],
        fields: [
          f(N.name, 'string', { required: true, maxLength: 80 }),
          f(N.firmware, 'string', { required: true, pattern: '^v[0-9]\\.[0-9]{1,2}\\.[0-9]{1,2}$' }),
          f(N.location, 'geoPoint', { required: true }),
          f(N.active, 'bool', { required: true }),
        ],
      },
      {
        key: 'readings',
        name: ['lecturas', 'readings', 'mesures', 'leituras'],
        timeField: N.measuredAt,
        metaField: N.metadata,
        fields: [
          f(N.measuredAt, 'date', { required: true }),
          f(N.metadata, 'object', { required: true, children: [f(N.sensor, 'enum', { required: true, enum: [['temperatura', 'temperature', 'temperature', 'temperatura'], ['humedad', 'humidity', 'humidite', 'umidade']] })] }),
          f(N.value, 'double', { required: true, minimum: -40, maximum: 120 }),
          f(N.unit, 'enum', { required: true, enum: [['C', 'C', 'C', 'C'], ['%', '%', '%', '%']] }),
        ],
      },
      {
        key: 'alerts',
        name: ['alertas', 'alerts', 'alertes', 'alertas'],
        fields: [
          f(N.severity, 'enum', { required: true, enum: [['baja', 'low', 'faible', 'baixa'], ['alta', 'high', 'elevee', 'alta']], indexed: true }),
          f(N.description, 'string', { required: true, maxLength: 300 }),
          f(N.date, 'date', { required: true }),
        ],
      },
    ],
    relationships: [
      { from: 'readings', to: 'devices', kind: 'reference', cardinality: '1:N' },
      { from: 'alerts', to: 'devices', kind: 'reference', cardinality: '1:N' },
    ],
  },
  {
    id: 'chat',
    name: ['Chat', 'Chat', 'Messagerie', 'Chat'],
    collections: [
      {
        key: 'users',
        name: ['usuarios', 'users', 'utilisateurs', 'usuarios'],
        fields: [f(N.username, 'string', { required: true, unique: true, pattern: '^[a-z0-9_]{3,20}$' }), f(N.name, 'string', { required: true, maxLength: 80 })],
      },
      {
        key: 'rooms',
        name: ['salas', 'rooms', 'salons', 'salas'],
        fields: [f(N.name, 'string', { required: true, maxLength: 80 }), f(N.private, 'bool', { required: true }), f(N.createdAt, 'date', { required: true })],
      },
      {
        key: 'messages',
        name: ['mensajes', 'messages', 'messages', 'mensagens'],
        subOf: 'rooms',
        fields: [f(N.text, 'string', { required: true, maxLength: 4000 }), f(N.sentAt, 'date', { required: true })],
      },
    ],
    relationships: [
      { from: 'rooms', to: 'users', kind: 'reference', cardinality: 'N:M', maxItems: 200 },
      { from: 'messages', to: 'users', kind: 'reference', cardinality: '1:N' },
      { from: 'messages', to: 'rooms', kind: 'reference', cardinality: '1:N' },
    ],
  },
  {
    id: 'catalog',
    name: ['Catálogo con atributos', 'Catalog with attributes', 'Catalogue à attributs', 'Catálogo com atributos'],
    collections: [
      {
        key: 'categories',
        name: ['categorias', 'categories', 'categories', 'categorias'],
        fields: [f(N.name, 'string', { required: true, unique: true, maxLength: 60 }), f(N.slug, 'string', { required: true, pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' })],
      },
      {
        key: 'items',
        name: ['articulos', 'items', 'articles', 'itens'],
        fields: [
          f(N.name, 'string', { required: true, maxLength: 120 }),
          f(N.kind, 'enum', { required: true, enum: [['libro', 'book', 'livre', 'livro'], ['ropa', 'clothing', 'vetement', 'roupa'], ['equipo', 'gear', 'materiel', 'equipamento']], indexed: true }),
          f(N.price, 'decimal', { required: true, minimum: 0, maximum: 3000 }),
          // Attribute pattern: varying properties as key and value pairs, indexable together.
          f(N.attributes, 'array', { maxItems: 20, items: f(['', '', '', ''], 'object', { children: [f(N.key, 'string', { required: true, maxLength: 40 }), f(N.value, 'string', { required: true, maxLength: 120 })] }) }),
          f(N.variants, 'array', { maxItems: 12, items: f(['', '', '', ''], 'object', { children: [f(N.color, 'string', { maxLength: 30 }), f(N.size, 'string', { maxLength: 10 }), f(N.stock, 'int', { required: true, minimum: 0, maximum: 500 })] }) }),
          f(N.schemaVersion, 'int', { required: true, minimum: 1, maximum: 3 }),
        ],
      },
      {
        key: 'suppliers',
        name: ['proveedores', 'suppliers', 'fournisseurs', 'fornecedores'],
        fields: [f(N.name, 'string', { required: true, maxLength: 120 }), f(N.country, 'string', { required: true, maxLength: 60 }), f(N.email, 'string', { maxLength: 160 })],
      },
    ],
    relationships: [
      { from: 'items', to: 'categories', kind: 'reference', cardinality: '1:N' },
      { from: 'items', to: 'suppliers', kind: 'reference', cardinality: '1:N' },
    ],
  },
];

export const MIN_COLLECTIONS = 2;
export const maxCollections = (themeId?: string) => Math.max(...THEMES.filter((t) => !themeId || t.id === themeId).map((t) => t.collections.length));
export const themeName = (theme: ThemeSpec, locale: Locale) => pickName(theme.name, locale);

const buildField = (spec: FieldSpec, locale: Locale): Field => {
  const field = createField({ name: pickName(spec.name, locale), type: spec.type, required: Boolean(spec.required), nullable: Boolean(spec.nullable) });
  if (spec.enum) field.enumValues = spec.enum.map((v) => pickName(v, locale));
  if (spec.children) field.children = spec.children.map((c) => buildField(c, locale));
  if (spec.items) field.items = { ...buildField(spec.items, locale), name: '', required: true };
  for (const key of ['maxItems', 'minItems', 'minLength', 'maxLength', 'minimum', 'maximum', 'pattern', 'uniqueItems'] as const) {
    if ((spec as Record<string, unknown>)[key] !== undefined) (field as Record<string, unknown>)[key] = (spec as Record<string, unknown>)[key];
  }
  return field;
};

export type RandomModelOptions = {
  engine: EngineId;
  themeId?: string;
  collectionCount: number;
  namesLocale?: Locale;
  documentsPerCollection?: number;
  name?: string;
  databaseName?: string;
  rng?: Rng;
};

/** A ready model for a theme: collections, relationships, indexes on unique and reference fields, and optional documents. */
export const generateRandomModel = (options: RandomModelOptions): Project => {
  const { engine, namesLocale: locale = 'es', rng = Math.random } = options;
  const theme = THEMES.find((t) => t.id === options.themeId) ?? THEMES[Math.floor(rng() * THEMES.length)];
  const count = Math.max(MIN_COLLECTIONS, Math.min(options.collectionCount, theme.collections.length));
  const specs = theme.collections.slice(0, count);
  const project = createProject(options.name?.trim() || themeName(theme, locale), engine, options.databaseName);
  project.namesLocale = locale;
  const byKey = new Map<string, Collection>();

  specs.forEach((spec, i) => {
    const collection = createCollection(engine, pickName(spec.name, locale), { x: i * 360, y: 0 });
    collection.fields.push(...spec.fields.map((s) => buildField(s, locale)));
    for (const s of spec.fields.filter((x) => x.unique || x.indexed)) {
      const path = pickName(s.name, locale);
      const keys = [{ path, order: 1 as const }];
      collection.indexes.push({ id: uid(), name: suggestIndexName(keys), nameIsCustom: false, keys, ...(s.unique ? { unique: true } : {}) });
    }
    if (engine === 'mongodb' && spec.timeField) {
      collection.options.timeseries = { timeField: pickName(spec.timeField, locale), metaField: spec.metaField ? pickName(spec.metaField, locale) : undefined, granularity: 'minutes' };
    }
    if (engine === 'couchdb') collection.options.typeDiscriminator = { field: 'type', value: collection.name };
    if (engine === 'firestore' && spec.subOf && byKey.has(spec.subOf)) {
      collection.kind = 'subcollection';
      collection.parentId = byKey.get(spec.subOf)!.id;
    }
    byKey.set(spec.key, collection);
    project.collections.push(collection);
  });

  for (const rel of theme.relationships) {
    const from = byKey.get(rel.from);
    const to = byKey.get(rel.to);
    if (!from || !to) continue;
    // A Firestore subcollection already sits under its parent; no field needed.
    if (from.kind === 'subcollection' && from.parentId === to.id) continue;
    const embedFieldIds = rel.embed
      ? to.fields.filter((fld) => rel.embed!.some((k) => pickName((N as Record<string, L>)[k] ?? ['', '', '', ''], locale) === fld.name)).map((fld) => fld.id)
      : undefined;
    const created = createRelationship(project, { kind: rel.kind, fromId: from.id, toId: to.id, cardinality: rel.cardinality, embedFieldIds });
    const field = created && from.fields.find((x) => x.name === created.from.fieldPath);
    if (field && field.type === 'array') field.maxItems = rel.maxItems ?? 50;
    // Reference fields are what queries filter by.
    if (created?.kind === 'reference' && engine !== 'firestore') {
      const keys = [{ path: created.from.fieldPath, order: 1 as const }];
      from.indexes.push({ id: uid(), name: suggestIndexName(keys), nameIsCustom: false, keys });
    }
  }

  if (options.documentsPerCollection) {
    project.documents = generateAllDocuments(project, { count: options.documentsPerCollection, locale, rng });
  }
  return project;
};
