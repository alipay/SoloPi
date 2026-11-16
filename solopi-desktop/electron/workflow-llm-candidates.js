// Waiting states are explicitly configured by the case, never inferred from its expected result.
function createCandidateFilter(value) {
  let rules;
  try { rules = typeof value === 'string' ? JSON.parse(value.trim() || '[]') : (value ?? []); }
  catch { throw new Error('LLM 等待状态必须是 JSON 数组'); }
  const scalar = v => v === null || ['string', 'boolean'].includes(typeof v) || (typeof v === 'number' && Number.isFinite(v));
  if (!Array.isArray(rules) || rules.length > 32) throw new Error('LLM 等待状态必须是最多 32 条规则的数组');
  const compiled = rules.map(rule => {
    if (!rule || typeof rule.path !== 'string' || !/^[A-Za-z_][\w]*(?:\.[\w]+)*$/.test(rule.path)
      || rule.path.split('.').some(key => ['__proto__', 'prototype', 'constructor'].includes(key))
      || !Array.isArray(rule.values) || !rule.values.length || rule.values.length > 100 || !rule.values.every(scalar)
      || Object.keys(rule).some(key => !['path', 'values'].includes(key))) {
      throw new Error('LLM 等待状态规则需要 path 和非空 values 数组，例如 [{"path":"status","values":["pending"]}]');
    }
    return { keys: rule.path.split('.'), values: rule.values };
  });
  return payload => compiled.some(rule => {
    let current = payload;
    for (const key of rule.keys) {
      if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, key)) return false;
      current = current[key];
    }
    return rule.values.some(value => value === current);
  });
}
module.exports = { createCandidateFilter };
