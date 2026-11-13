/** Helpers to turn collection names into field, model and type names. */

const ascii = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '');

const words = (text: string) =>
  ascii(text)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);

export const camelCase = (text: string) => {
  const parts = words(text);
  if (parts.length === 0) return text;
  return parts.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('');
};

export const snakeCase = (text: string) => words(text).map((w) => w.toLowerCase()).join('_') || text;

export const pascalCase = (text: string) => {
  const camel = camelCase(text);
  return camel ? camel[0].toUpperCase() + camel.slice(1) : 'Model';
};

/** Rough singular for English, Spanish, French and Portuguese plurals. */
export const singular = (name: string) => {
  const rules: [RegExp, string][] = [
    [/ies$/i, 'y'],
    [/(ss|x|z|ch|sh)es$/i, '$1'],
    [/iones$/i, 'ion'],
    [/oes$/i, 'ao'],
    [/(or|ad|al|el|il|ol|ul|ar|er)es$/i, '$1'],
    [/([^s])s$/i, '$1'],
  ];
  for (const [re, to] of rules) if (re.test(name)) return name.replace(re, to);
  return name;
};

/** Valid identifier for generated code. */
export const identifier = (text: string) => {
  const camel = camelCase(text) || 'field';
  return /^[0-9]/.test(camel) ? `_${camel}` : camel;
};

export const isIdentifier = (text: string) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text);
