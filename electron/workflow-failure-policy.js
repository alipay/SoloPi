// Browser-safe shared persistence contract. Assertions have exactly one policy.
const ASSERTION_KINDS = new Set(['tts_assert', 'json_assert', 'llm_assert', 'mobile_ui_assert']);
function normalizeCaseFailurePolicy(testCase, components = []) {
  if (!testCase || !Array.isArray(testCase.steps)) return testCase;
  const effective = new Map(components.map(c => [c.id, c]));
  for (const c of testCase.components || []) effective.set(c.id, c);
  let changed = false;
  const steps = testCase.steps.map(step => {
    if (step.type !== 'component' || !ASSERTION_KINDS.has(effective.get(step.componentId)?.kind)) return step;
    const config = step.config || {};
    const blocking = config.assertBlocking !== false && config.assertBlocking !== 'false';
    if (config.assertBlocking === blocking && !Object.hasOwn(step, 'continueOnError') && !Object.hasOwn(step, 'onError')
      && !Object.hasOwn(config, 'continueOnError') && !Object.hasOwn(config, 'onError')) return step;
    changed = true;
    const next = { ...step, config: { ...config, assertBlocking: blocking } };
    delete next.continueOnError; delete next.onError;
    delete next.config.continueOnError; delete next.config.onError;
    return next;
  });
  return changed ? { ...testCase, steps } : testCase;
}
function normalizeStateFailurePolicies(state) {
  if (!state || !Array.isArray(state.cases)) return state;
  const cases = state.cases.map(c => normalizeCaseFailurePolicy(c, state.components || []));
  return cases.some((c, i) => c !== state.cases[i]) ? { ...state, cases } : state;
}
module.exports = { ASSERTION_KINDS, normalizeCaseFailurePolicy, normalizeStateFailurePolicies };
