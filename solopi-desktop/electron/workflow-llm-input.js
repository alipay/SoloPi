// Scope evidence by the original template, before interpolation erases references.
function assertionVariables(template, variables = {}) {
  const expressions = [...String(template || '').matchAll(/\$\{([^}]+)\}|\{\{([^}]+)\}\}/g)]
    .filter(m => m[1] || m[2].startsWith('variables.'))
    .map(m => (m[1] || m[2]).trim());
  const selected = Object.create(null);
  for (const expression of expressions) {
    if (expression === 'variables') return structuredClone(variables);
    if (!expression.startsWith('variables.')) continue;
    const parts = expression.slice(10).split('.');
    let value = variables;
    for (const part of parts) {
      if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) { value = undefined; break; }
      value = value[part];
    }
    if (value === undefined) continue;
    let target = selected;
    for (const [index, part] of parts.slice(0, -1).entries()) {
      if (!Object.hasOwn(target, part)) target[part] = /^\d+$/.test(parts[index + 1]) ? [] : Object.create(null);
      target = target[part];
    }
    // Own properties avoid prototype setters; no input object is modified.
    Object.defineProperty(target, parts.at(-1), {value: structuredClone(value), enumerable: true, configurable: true, writable: true});
  }
  return selected;
}
function createPayload(assertion, variables, log, template) {
  return {assertion, variables: assertionVariables(template, variables),
    currentLog: log.line, currentExtractedContent: log.extractedContent,
    currentJson: log.parsedContent || undefined};
}
module.exports = {assertionVariables, createPayload};
