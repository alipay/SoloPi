// Transport adapter only: schemas and execution belong to the native tool registry.
const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv');
const { fingerprint, executeOperation } = require('./agent/operation-receipts');
const HOST_TOOLS = new Set(['run_command', 'run_commands', 'read_command_help', 'update_work_state',
  'install_skill', 'download_file', 'read_attachment', 'watch_operation', 'list_skills',
  'read_skill', 'read_skill_reference', 'save_extensions', 'describe_capabilities']);
const isPlatformTool = name => !HOST_TOOLS.has(name) && !name.startsWith('mcp_');
const validId = id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
function transportResult(result, requestId, extra = {}) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return { success: true, result, requestId, ...extra };
  return { ...(result.success === undefined && result.error ? { success: false } : {}), ...result,
    ...(result.requestId !== undefined ? { toolRequestId: result.requestId } : {}), requestId, ...extra };
}
function createPlatformToolApi({ tools, directory }) {
  const ajv = new Ajv({ strict: false, allErrors: true });
  const active = new Map();
  const root = () => path.join(directory(), 'cli-tool-receipts');
  const file = id => path.join(root(), id + '.json');
  const save = record => {
    fs.mkdirSync(root(), { recursive: true, mode: 0o700 });
    const target = file(record.requestId), temporary = target + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 });
    fs.renameSync(temporary, target);
  };
  const failure = (errorCode, error, extra = {}) => ({ success: false, errorCode, error, ...extra });
  return async function platformToolApi(request, event, signal) {
    if (!request || !['list', 'describe', 'call', 'result'].includes(request.action))
      return failure('PLATFORM_TOOL_ACTION_INVALID', 'tools 支持 list/describe/call/result');
    const { action, name, requestId } = request;
    if (['call', 'result'].includes(action) && !validId(requestId))
      return failure('PLATFORM_TOOL_REQUEST_ID_INVALID', 'requestId 必须是 UUID v4');
    if (action === 'result') {
      if (!fs.existsSync(file(requestId))) return failure('PLATFORM_TOOL_RECEIPT_NOT_FOUND', '未找到该操作回执', { requestId });
      const record = JSON.parse(fs.readFileSync(file(requestId), 'utf8'));
      return { success: true, successScope: 'receipt-query', requestId, name: record.name,
        status: record.status, result: record.result, lookupTaskId: record.lookupTaskId };
    }
    const available = (await tools(event, signal)).filter(tool => isPlatformTool(tool.name));
    const metadata = tool => ({ name: tool.name, description: tool.description, write: !!tool.confirm, parameters: tool.schema });
    if (action === 'list') return { success: true, schemaVersion: 'solopi.platform-tools.v1', tools: available.map(tool => ({ name: tool.name, description: tool.description, write: !!tool.confirm })) };
    const tool = available.find(tool => tool.name === name);
    if (!tool) return failure('PLATFORM_TOOL_NOT_FOUND', '工具不存在或属于 Agent 宿主能力', { name });
    if (action === 'describe') return { success: true, tool: metadata(tool) };
    const args = request.arguments === undefined ? {} : request.arguments;
    if (!ajv.validate(tool.schema, args)) return failure('PLATFORM_TOOL_ARGUMENTS_INVALID', '参数不符合当前工具 schema', {
      name, issues: ajv.errors.map(e => ({ path: e.instancePath, keyword: e.keyword, message: e.message })), parameters: tool.schema,
    });
    const argsHash = fingerprint({ name, args });
    const prior = active.get(requestId) || (fs.existsSync(file(requestId)) ? JSON.parse(fs.readFileSync(file(requestId), 'utf8')) : undefined);
    if (prior) {
      if (prior.argsHash !== argsHash) return failure('PLATFORM_TOOL_REQUEST_ID_CONFLICT', '同一 requestId 不能用于不同工具或参数', { requestId });
      if (prior.status === 'done') return transportResult(prior.result, requestId, { reused: true,
        ...(Object.hasOwn(prior.result || {}, 'submitted') ? { submitted: false } : {}) });
      return failure('OPERATION_OUTCOME_UNKNOWN', '操作已派发，未重复执行；请回读原回执或查询原任务', { requestId, lookupTaskId: prior.lookupTaskId });
    }
    signal?.throwIfAborted();
    const record = { requestId, name, argsHash, status: 'dispatching', startedAt: new Date().toISOString(),
      lookupTaskId: tool.taskIdForOperation?.(requestId) };
    save(record); // Must persist before a write can occur.
    active.set(requestId, record);
    try {
      const result = await executeOperation({ session: record, save: () => save(record), scope: requestId,
        tool, args, context: { signal, operationId: requestId } });
      record.result = result; record.status = result?.submissionOutcome === 'unknown' ? 'unknown' : 'done';
      record.finishedAt = new Date().toISOString(); save(record);
      return transportResult(result, requestId);
    } catch (error) {
      record.status = !tool.confirm || error.submissionOutcome === 'not-submitted' ? 'done' : 'unknown';
      record.result = failure(error.code || 'PLATFORM_TOOL_FAILED', error.message, { submissionOutcome: error.submissionOutcome });
      try { save(record); } catch { /* The durable dispatch record forbids replay. */ }
      return { ...record.result, requestId, lookupTaskId: record.lookupTaskId };
    } finally { active.delete(requestId); }
  };
}
module.exports = { createPlatformToolApi, isPlatformTool };
