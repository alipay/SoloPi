function createBudgets(logMs, modelValue, now = Date.now) {
  const modelMs = modelValue === undefined || modelValue === null || modelValue === '' ? 15000 : Number(modelValue);
  if (!Number.isFinite(modelMs) || modelMs < 1 || modelMs > 300000) throw new Error('LLM 判断超时必须为 1–300000 毫秒');
  const limits = { log: logMs, model: modelMs }, used = { log: 0, model: 0 };
  return {
    remaining: phase => phase === 'model' ? modelMs : Math.max(0, limits[phase] - used[phase]),
    async measure(phase, action) {
      const start = now();
      try { return await action(phase === 'model' ? modelMs : Math.max(1, limits[phase] - used[phase])); }
      finally { used[phase] += Math.max(0, now() - start); }
    },
    snapshot: () => ({ logTimeoutMs: logMs, logElapsedMs: used.log, modelTimeoutMs: modelMs, modelTimeoutScope: 'per-request', maxCandidateJudgments: 3, maxAttemptsPerCandidate: 3, modelElapsedMs: used.model }),
  };
}
function formatTiming(budgets, judgments) {
  const lines = [
    `日志等待：累计 ${budgets.logElapsedMs}ms / ${budgets.logTimeoutMs}ms（不含模型请求）`,
    `LLM：每次请求独立 ${budgets.modelTimeoutMs}ms；每条候选最多 3 次请求（含首次）；最多判断 3 条候选`,
    `模型阶段总耗时：${budgets.modelElapsedMs}ms（含重试间隔，不是单次请求超时）`,
  ];
  for (const j of judgments) {
    lines.push(`候选 ${j.candidate}：${j.durationMs}ms，${j.errorCode || (j.pass ? '通过' : '未通过')}`);
    for (const a of j.retry?.attempts || []) lines.push(`  请求 ${a.attempt}：${a.durationMs}ms / ${a.timeoutMs ?? budgets.modelTimeoutMs}ms，${a.code || a.status}${a.response ? `，输出上限${a.response.requestedMaxTokens ?? '-'} token，完成token ${a.response.usage?.completion_tokens ?? '-'}，答案${a.response.outputCharacters ?? '-'}字符，思考${a.response.reasoningCharacters ?? '-'}字符` : ''}`);
  }
  return lines.join('\n');
}
module.exports = { createBudgets, formatTiming };
