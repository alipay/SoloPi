// Provider policy and diagnostics only; the official Harness owns retries/dispatch.
const retryStepMs = 15000;
const retryPolicy = {
  mode: 'normal', maxRetries: 5,
  backoff: {initialDelayMs: retryStepMs, maxDelayMs: retryStepMs * 5, jitterRatio: 0},
};
function installRetrySchedule(ctx) {
  // Register before the native retry middleware. It still owns persistence,
  // retry limits and cancellation; only its per-attempt backoff is adapted.
  ctx.on('agent/request-error', async (payload, next) => {
    const policy = payload.retryPolicy;
    if (policy?.mode !== retryPolicy.mode || policy.maxRetries !== retryPolicy.maxRetries ||
      policy.initialDelayMs !== retryStepMs || policy.maxDelayMs !== retryPolicy.backoff.maxDelayMs || policy.jitterRatio !== 0) return next();
    const policyKey = JSON.stringify([policy.mode, policy.maxRetries, [...policy.retryableCodes].sort(), policy.initialDelayMs, policy.maxDelayMs, policy.jitterRatio]);
    const state = ctx.sessionProjections.stateOf(payload.agent.session, 'llmRetry');
    const retry = (state[JSON.stringify([payload.provider, policyKey])]?.retry ?? 0) + 1;
    // Repeating a failed transport envelope six times never repairs its input.
    // Allow one recovery request; quota cooldown retains the native policy.
    if (['TRANSPORT','TIMEOUT','SERVER'].includes(payload.failure.code) && retry > 1) return;
    // Use the native delay seam while retaining a stable policy identity, so
    // the persisted retry counter and maximum do not reset between attempts.
    payload.failure = {...payload.failure, providerRetryAfterMs: Math.max(payload.failure.providerRetryAfterMs||0,retryStepMs * retry)};
    return next();
  });
}
class RequestFailureTrace {
  constructor() { this.reset(); }
  reset() { this.failures = []; this.requests = 0; this.retries = []; }
  model(record) {
    if (record.event === 'model.start') this.requests++;
    if (record.event === 'model.error') this.failures.push({code: record.category || 'UNKNOWN', requestId: record.requestId, durationMs: record.durationMs});
    this.failures = this.failures.slice(-12);
  }
  event(event) {
    if (event.type === 'step/start' || event.type === 'turn/start') this.reset();
    if (event.type === 'llm/retry') this.retries.push({attempt: event.data.retry, maxRetries: event.data.maxRetries, code: event.data.failure?.code, delayMs: event.data.delayMs});
    this.retries = this.retries.slice(-12);
  }
  decorate(error) {
    const code = error.code;
    const labels = {TRANSPORT: '模型服务连接失败', RATE_LIMIT: '模型服务请求额度超限', TIMEOUT: '模型请求超时', SERVER: '模型服务暂时不可用'};
    if (!labels[code]) return error;
    const rateLimits = this.failures.filter(f => f.code === 'RATE_LIMIT').length;
    const attempts = this.requests ? `本次模型步骤请求 ${this.requests} 次，重试 ${this.retries.length} 次。` : '';
    const history = code !== 'RATE_LIMIT' && rateLimits ? `此前 ${rateLimits} 次请求被限流；最后一次错误为${labels[code]}。` : '';
    const message = `${labels[code]}。${attempts}${history}本轮助手未完成；已完成的工具操作和回执已保留，恢复时请继续原会话。`;
    return Object.assign(new Error(message, {cause: error}), {code, diagnostics: {
      category: code, message, requestCount: this.requests, retryCount: this.retries.length,
      failures: [...this.failures], retries: [...this.retries],
      transportCauseAvailable: !!error.diagnostics?.causes?.length,
    }});
  }
}
module.exports = {retryPolicy, installRetrySchedule, RequestFailureTrace};
