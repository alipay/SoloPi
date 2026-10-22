// Recovery belongs to a durable Agent request step, not the raw streaming API.
// The caller commits a response and executes its tools only after this returns.
const { setTimeout: delay } = require('node:timers/promises');
const { isRateLimit } = require('./rate-limit-retry');
const { sanitize } = require('../diagnostics');

function recoveryReason(error) {
  const d = error?.diagnostics;
  if (!d || d.category === 'cancelled') return null;
  const codes = new Set((d.causes || []).map(c => c.code));
  for (const code of ['OUTPUT_LIMIT', 'INPUT_BUDGET_EXCEEDED', 'INVALID_TOOL_CALL', 'CONTEXT_WINDOW_EXCEEDED'])
    if (codes.has(code)) return null;
  if (['tls', 'input-budget', 'context-overflow', 'output-limit', 'invalid-tool-call'].includes(d.category)) return null;
  // Permanent quota/billing failures must not become retries merely because an
  // endpoint returns HTTP 429 or an internal HTTP status alongside its code.
  if (/insufficient_quota|billing|credit|spend_limit|usage_limit|quota_exceeded/i.test([d.upstreamCode, d.upstreamType].join(' '))) return null;
  if ([401, 403].includes(d.httpStatus)) return null;
  if (isRateLimit(error)) return 'rate-limit';
  const status = Number(d.upstreamCode ?? d.httpStatus);
  if (status >= 500 && status <= 599) return 'server-error';
  if (d.httpStatus >= 400 && d.httpStatus < 500) return null;
  if (codes.has('MODEL_REQUEST_TIMEOUT')) return d.timeoutKind === 'first-response' ? 'first-response-timeout' : 'model-timeout';
  if (codes.has('EMPTY_RESPONSE')) return 'empty-response';
  if (codes.has('INCOMPLETE_STREAM')) return 'incomplete-response';
  if (['UND_ERR_SOCKET', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ECONNREFUSED', 'EAI_AGAIN'].some(c => codes.has(c))) return 'transport-error';
  return null;
}

async function recoverModelStep(run, { signal, record, onRetry = () => {}, wait = delay, random = Math.random, now = Date.now, budget = { attempts: 0, rateLimits: 0 }, maxRetries = 1, recoveryTimeoutMs = 90000 }) {
  // Single shared budget even when one request changes failure categories.
  maxRetries=Math.max(0,Math.min(5,Number.isSafeInteger(maxRetries)?maxRetries:1));
  recoveryTimeoutMs=Math.max(1,Math.min(300000,Number.isFinite(recoveryTimeoutMs)?recoveryTimeoutMs:90000));
  let current, timer, recoverySignal, lastFailure;
  const controller=new AbortController();
  const activeSignal=()=>recoverySignal || signal;
  const expire=()=>{
    if(controller.signal.aborted)return;
    if(lastFailure)lastFailure.message+=` 模型恢复阶段达到 ${Math.round(recoveryTimeoutMs/1000)} 秒总时限，已停止自动重试。`;
    if(lastFailure?.diagnostics){lastFailure.diagnostics.recoveryBudgetMs=recoveryTimeoutMs;lastFailure.diagnostics.automaticRetryCount=budget.attempts;}
    controller.abort(lastFailure || Error('模型恢复达到总时限'));
  };
  try {
    for (;;) {
      activeSignal()?.throwIfAborted();
      try {
        const result = await run(activeSignal());
        activeSignal()?.throwIfAborted();
        if (budget.attempts) await record({ phase: 'completed', attempt: budget.attempts, time: new Date(now()).toISOString() });
        return result;
      } catch (error) {
        if (signal?.aborted) throw error;
        if(controller.signal.aborted){
          await record({phase:'failed',reason:'recovery-budget-exhausted',attempt:budget.attempts,time:new Date(now()).toISOString(),failure:sanitize(lastFailure?.diagnostics || {})});
          throw controller.signal.reason;
        }
        lastFailure=error;
        const reason = recoveryReason(error);
        const failure = sanitize(error.diagnostics || {});
        const causeCode = error.diagnostics?.causes?.find(c => /^[A-Z0-9_]{1,80}$/.test(c.code || ''))?.code;
        if (causeCode) failure.code = causeCode;
        const time = new Date(now()).toISOString();
        if (!reason || budget.attempts >= maxRetries || (reason === 'rate-limit' && budget.rateLimits >= 3)) {
          await record({ phase: 'failed', reason: reason || 'not-retryable', attempt: budget.attempts, time, failure });
          if (budget.attempts) {
            if (error.diagnostics) error.diagnostics.automaticRetryCount = budget.attempts;
            error.message += ` 已在当前模型请求步骤重试 ${budget.attempts} 次；已完成工具操作保留，本轮不再重试。`;
          }
          throw error;
        }
        if(!recoverySignal){
          budget.recoveryStartedAt ??= now();
          recoverySignal=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
          timer=setTimeout(expire,Math.max(1,recoveryTimeoutMs-(now()-budget.recoveryStartedAt)));timer.unref?.();
        }
        const base = reason === 'rate-limit' ? [5000, 15000, 30000][budget.rateLimits++] : Math.min(10000, 500 * 2 ** budget.attempts);
        const retryAfterMs=error.diagnostics?.retryAfterMs;
        const waitMs = reason === 'rate-limit' ? (Number.isFinite(retryAfterMs)&&retryAfterMs>=0?retryAfterMs:base) : Math.round(base * (0.9 + 0.2 * random()));
        if(now()-budget.recoveryStartedAt+waitMs>=recoveryTimeoutMs){
          expire();
          await record({phase:'failed',reason:'recovery-budget-exhausted',attempt:budget.attempts,time,failure:sanitize(error.diagnostics || {})});
          throw error;
        }
        budget.attempts++;
        current = { reason, attempt: budget.attempts, maxAttempts: maxRetries, retryAt: now() + waitMs };
        if (reason === 'rate-limit') current.maxAttempts = Math.min(maxRetries, budget.attempts + 3 - budget.rateLimits);
        // Durable before countdown. A failed save must prevent another request.
        await record({ ...current, phase: 'scheduled', time, failure, waitMs });
        onRetry(current);
        try{
          await wait(waitMs, undefined, { signal:activeSignal() });
          activeSignal()?.throwIfAborted();
        }catch(error){
          if(controller.signal.aborted&&!signal?.aborted){
            await record({phase:'failed',reason:'recovery-budget-exhausted',attempt:budget.attempts,time:new Date(now()).toISOString(),failure:sanitize(lastFailure?.diagnostics || {})});
            throw controller.signal.reason;
          }
          throw error;
        }
        await record({ ...current, phase: 'started', time: new Date(now()).toISOString() });
        onRetry(null);
      }
    }
  } finally {
    clearTimeout(timer);
    try {
      if (current && signal?.aborted) await record({ phase: 'cancelled', attempt: budget.attempts, time: new Date(now()).toISOString() });
    } finally { onRetry(null); }
  }
}
module.exports = { recoveryReason, recoverModelStep };
