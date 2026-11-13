const { isDeepStrictEqual } = require('util');

function configError(message) {
  return Object.assign(new Error(`命令结果断言配置无效：${message}`), { errorCode: 'COMMAND_RESULT_ASSERTION_CONFIG_INVALID', errorType: 'configuration',
    recoveryActions: ['修正 resultAssertions 的 JSON 格式、source 和 conditions；每项条件必须包含 path 与 equals。'] });
}
function parseCommandResultAssertions(value) {
  if (value === undefined || value === null || value === '') return null;
  let config = value;
  if (typeof value === 'string') {
    try { config = JSON.parse(value); } catch { throw configError('需要合法 JSON'); }
  }
  if (!config || Array.isArray(config) || typeof config !== 'object') throw configError('需要配置对象');
  if (Object.keys(config).some(key => !['source', 'conditions'].includes(key))) throw configError('仅支持 source 和 conditions');
  const source = config.source ?? 'stdout';
  if (!['stdout', 'stderr'].includes(source)) throw configError('source 只能为 stdout 或 stderr');
  if (!Array.isArray(config.conditions) || config.conditions.length === 0) throw configError('conditions 不能为空');
  for (const condition of config.conditions) {
    if (!condition || typeof condition.path !== 'string' || !/^(?:\$|\$\.[\w-]+(?:\[\d+\])?(?:\.[\w-]+(?:\[\d+\])?)*|[\w-]+(?:\[\d+\])?(?:\.[\w-]+(?:\[\d+\])?)*)$/.test(condition.path)) throw configError('条件需要有效的 JSON 字段路径');
    if (Object.keys(condition).some(key => !['path', 'equals', 'message'].includes(key))) throw configError('条件仅支持 path、equals 和 message');
    if (!Object.hasOwn(condition, 'equals') || condition.equals === undefined) throw configError('条件需要 equals，按 JSON 类型严格比较');
    if (condition.message !== undefined && typeof condition.message !== 'string') throw configError('message 必须为字符串');
  }
  return { source, conditions: config.conditions };
}
function readPath(root, expression) {
  if (expression === '$') return root;
  const parts = expression.replace(/^\$\./, '').replace(/\[(\d+)\]/g, '.$1').split('.');
  let value = root;
  for (const key of parts) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}
function assertCommandResult(result, config, command = '') {
  if (!config) return;
  let json;
  try { json = JSON.parse(String(result[config.source] || '')); }
  catch {
    throw Object.assign(new Error(`命令结果断言失败：${config.source} 不是合法 JSON`), {
      errorType: 'command-result-assertion',
      recoveryActions: ['确认命令输出完整 JSON，并将工具诊断日志与 JSON 结果分开。', '核对结果位于 stdout 还是 stderr，并正确配置 source。'],
      errorCode: 'COMMAND_RESULT_NOT_JSON', stdout: result.stdout || '', stderr: result.stderr || '',
      exitCode: result.exitCode ?? 0, command, meta: result.meta || {},
      diagnostics: { source: config.source, reason: 'invalid-json' },
    });
  }
  const failures = config.conditions.flatMap(condition => {
    const actual = readPath(json, condition.path);
    return isDeepStrictEqual(actual, condition.equals) ? [] : [{ path: condition.path, expected: condition.equals,
      actual: actual === undefined ? null : actual, missing: actual === undefined, message: condition.message || '' }];
  });
  if (!failures.length) return;
  const summary = failures.map(item => `${item.message ? item.message + '；' : ''}${item.path} 期望 ${JSON.stringify(item.expected)}，实际 ${item.missing ? '字段缺失' : JSON.stringify(item.actual)}`).join('；');
  throw Object.assign(new Error(`命令结果断言失败：${summary}`), {
    errorType: 'command-result-assertion',
    recoveryActions: ['查看 diagnostics.failures 中的字段路径、期望值、实际值及原始输出。', '核对输出契约和上游状态；确认条件确实满足后再执行，不能仅凭进程退出码判断成功。'],
    errorCode: 'COMMAND_RESULT_ASSERTION_FAILED', stdout: result.stdout || '', stderr: result.stderr || '',
    exitCode: result.exitCode ?? 0, command, meta: result.meta || {}, diagnostics: { source: config.source, failures },
  });
}
module.exports = { parseCommandResultAssertions, assertCommandResult };
