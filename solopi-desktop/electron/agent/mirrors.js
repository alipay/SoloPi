// Use the executing case snapshot, never current editor defaults or model guesses.
function mirrorTargets(task) {
  if (!task || task.source !== 'agent' || !['running', 'submitted'].includes(task.status)) return [];
  const record = task.cases?.find(c => c.status === 'running') || task.cases?.find(c => c.status === 'pending');
  const c = record?.caseSnapshot;
  const config = c?.steps?.find(s => s.type === 'start')?.config || {};
  return ['phone', 'glasses'].flatMap(role => {
    const enabled = config[role === 'phone' ? 'showPhoneScreen' : 'showGlassesScreen'];
    const serial = c?.defaults?.[`${role}Serial`];
    return (enabled === true || enabled === 'true') && serial ? [{ role, serial: String(serial), taskId: task.id }] : [];
  });
}
function newAgentCase(document) {
  return { ...document, reviewStatus: 'draft', tags: [...new Set([...(document.tags || []), 'draft', 'ai-generated'])],
    steps: (document.steps || []).map(step => step.type === 'start' ? { ...step, config: { showPhoneScreen: false, showGlassesScreen: true, ...step.config } } : step) };
}
module.exports = { mirrorTargets, newAgentCase };
