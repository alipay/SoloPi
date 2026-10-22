// Stress runs keep the original case IDs for rerun selection and give every
// execution a distinct ID so reports, recordings and progress cannot collide.
function normalizeStressOptions(value) {
  if (!value) return null;
  if (!['rounds', 'duration'].includes(value.mode)) throw new Error('请选择压测模式');
  const amount = Number(value.value);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100000) throw new Error('压测轮数或分钟数须为 1–100000 的整数');
  return { mode: value.mode, value: amount, phoneLog: value.phoneLog === true, glassesLog: value.glassesLog !== false };
}

function createStressExecution(cases, index, caseEdges = {}) {
  const original = structuredClone(cases[index % cases.length]);
  const round = Math.floor(index / cases.length) + 1;
  return { ...original, sourceCaseId: original.id, round,
    id: `${original.id}--stress-${index + 1}`,
    name: `${original.name} · 第 ${round} 轮`,
    edges: structuredClone(caseEdges[original.id] || original.edges) };
}

function shouldRunStressCase(options, index, count, startedAt, now) {
  if (!count) return false;
  if (!options) return index < count;
  return options.mode === 'rounds' ? index < count * options.value : now < startedAt + options.value * 60000;
}

function normalizeStressPayload(payload) {
  const stress = normalizeStressOptions(payload.stress);
  return stress ? { ...payload, stress, startConfigOverride: {
    ...(payload.startConfigOverride || {}),
    recordPhoneScreen: payload.startConfigOverride?.recordPhoneScreen === true,
    recordGlassesScreen: payload.startConfigOverride?.recordGlassesScreen === true,
  } } : payload;
}

module.exports = { normalizeStressOptions, normalizeStressPayload, createStressExecution, shouldRunStressCase };
