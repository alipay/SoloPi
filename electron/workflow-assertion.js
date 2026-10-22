// Assertion policy is local to each workflow node, never to a shared component.
const { ASSERTION_KINDS } = require('./workflow-failure-policy');

function createAssertionTimeoutError(message, timeoutMs, diagnostics = {}) {
  return Object.assign(new Error(message), {
    code: 'ASSERTION_TIMEOUT', errorCode: 'ASSERTION_TIMEOUT',
    timeoutMs, diagnostics,
  });
}

async function executeWorkflowAssertionStep(step, context, execute) {
  const kind = step.type === 'component' ? context.components?.[step.componentId]?.kind : '';
  if (!ASSERTION_KINDS.has(kind)) return execute();
  const blocking = step.config?.assertBlocking !== false && step.config?.assertBlocking !== 'false';
  try {
    const output = await execute();
    return {
      ...output,
      meta: { ...output.meta, assertion: { blocking, outcome: 'matched', passed: true, continued: true } },
    };
  } catch (error) {
    // A nonblocking assertion always permits the workflow to continue.
    // Keep observation/error evidence, but never turn cancellation into success.
    const code = error.errorCode || error.code;
    const timedOut = code === 'ASSERTION_TIMEOUT'
      || (kind === 'tts_assert' && code === 'LOG_TEXT_ASSERT_TIMEOUT')
      || (kind === 'mobile_ui_assert' && code === 'MOBILE_UI_ELEMENT_NOT_FOUND');
    if (blocking || code === 'WORKFLOW_STOPPED' || error.code === 'WORKFLOW_STOPPED') {
      error.meta = {
        ...error.meta,
        assertion: { blocking, outcome: timedOut ? 'timeout' : 'error', passed: false, continued: false },
      };
      throw error;
    }
    return {
      success: true,
      completedAt: error.completedAt,
      command: error.command,
      stdout: [timedOut ? '断言结果：超时未命中（非卡点，按成功继续执行）' : '断言结果：未通过或执行异常（非卡点，按成功继续执行）', error.message, error.stdout].filter(Boolean).join('\n'),
      stderr: error.stderr || '',
      meta: {
        ...error.meta,
        branch: undefined,
        nodeOutput: { ...error.meta?.nodeOutput, success: true },
        assertion: {
          blocking: false, outcome: timedOut ? 'timeout' : 'error', passed: false, continued: true, ignored: true,
          reason: error.message, errorCode: code, timeoutMs: error.timeoutMs,
          diagnostics: error.diagnostics, snapshot: error.snapshot, attempts: error.attempts,
        },
      },
    };
  }
}

module.exports = { ASSERTION_KINDS, createAssertionTimeoutError, executeWorkflowAssertionStep };
