const { createHash } = require('node:crypto');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const scope = session => session.messages.findLastIndex(m => m.role === 'user' && m.source !== 'platform');
const selectionFields = ['libraryId', 'folderId', 'query', 'excludeFolderIds', 'excludeCaseIds'];
const optionsFields = ['devices', 'startOptions', 'performanceOptions', 'stress'];
const pick = (value, fields) => Object.fromEntries(fields.filter(key => value?.[key] !== undefined).map(key => [key, structuredClone(value[key])]));
function state(session) {
  return session.taskExecutionState ||= { version: 1, selections: [], submissions: [] };
}
function selectionKey(ids) { return hash([...new Set(ids)].sort()); }
function observeSelection(session, call, result) {
  // A receipt carries the full membership fingerprint even when display IDs
  // are paginated. Legacy results still require all IDs, never a preview.
  if (result?.success !== true || !Array.isArray(result.caseIds) || (result.total !== result.caseIds.length && !result.selectionId) || !result.caseIds.every(id => typeof id === 'string')) return;
  const s = state(session);
  s.selections = [...s.selections.filter(item => item.callId !== call.modelCallId), {
    callId: call.modelCallId, sourceUserIndex: call.scopeUserIndex ?? scope(session),
    selectors: pick(call.args, selectionFields), count: result.total,
    selectionId:result.selectionId, selectionRevision: result.selectionRevision, membership: result.selectionId ? result.selectionRevision : selectionKey(result.caseIds),
  }].slice(-6);
}
function requestKey(session, args) {
  // Only complete, matching discovery receipts can unify folder and explicit
  // IDs. No natural-language intent or permission inference happens here.
  const selection = args.selectionId ? session.taskExecutionState?.selections.findLast(item=>item.selectionId===args.selectionId) : session.taskExecutionState?.selections.findLast(item => args.expectedSelectionRevision && item.selectionRevision === args.expectedSelectionRevision
    && item.selectors.libraryId === args.libraryId && item.selectors.folderId === args.folderId
    && hash(item.selectors.excludeFolderIds || []) === hash(args.excludeFolderIds || [])
    && hash(item.selectors.excludeCaseIds || []) === hash(args.excludeCaseIds || []) && !item.selectors.query);
  const normalized = structuredClone(args);
  delete normalized.taskName; delete normalized.editScope;
  for (const key of ['caseIds', 'excludeCaseIds', 'excludeFolderIds']) if (Array.isArray(normalized[key])) normalized[key].sort();
  const membership = Array.isArray(args.caseIds) ? selectionKey(args.caseIds) : selection?.membership;
  if (membership) {
    delete normalized.selectionId; delete normalized.expectedSelectionRevision; delete normalized.expectedCaseCount;
    for (const key of [...selectionFields, 'caseIds']) delete normalized[key];
    normalized.membership = membership;
  }
  return hash(normalized);
}
function definitionRevision(snapshot, args, domain='') {
  const ids = require('./case-selection').resolveCaseSelection(snapshot, args, domain);
  const cases=[...ids].sort().map(id=>snapshot.cases.find(c=>c.id===id));
  const referenced=new Set(cases.flatMap(c=>(c.steps || []).filter(step=>step.componentId&&!(c.components || []).some(p=>p.id===step.componentId)).map(step=>step.componentId)));
  return hash({cases,components:(snapshot.components || []).filter(c=>referenced.has(c.id)).sort((a,b)=>a.id.localeCompare(b.id)),
    caseEdges:Object.fromEntries([...ids].sort().map(id=>[id,snapshot.caseEdges?.[id] || null]))});
}
function observeSave(session,call,result){
  if(call.args?.dryRun || result?.dryRun || !Array.isArray(result?.saved) || !result.saved.length)return;
  const s=state(session);
  s.latestSave={callId:call.modelCallId,sourceUserIndex:call.scopeUserIndex ?? scope(session),saved:[...result.saved],libraries:result.savedScopeSummary || []};
}
function guard(session, call) {
  const saved=session.taskExecutionState?.latestSave;
  if(saved){
    const edit=call.args.editScope;
    if(!edit || edit.saveCallId!==saved.callId)return {success:false,code:'TASK_EDIT_SCOPE_REQUIRED',message:'存在修改成功的用例：修改后重跑必须绑定最新保存回执并取saved与用户指定范围的交集；明确独立任务才标记independent-task。未提交。',saveCallId:saved.callId,savedScopeSummary:saved.libraries};
    if(edit.mode==='saved-cases'){
      const allowed=new Set(saved.saved),extra=(call.resolvedCaseIds || []).filter(id=>!allowed.has(id));
      if(!call.resolvedCaseIds?.length || extra.length)return {success:false,code:'TASK_EDIT_SCOPE_EXCEEDED',message:'提交包含本次未修改成功的用例；使用saved与指定库的交集，不使用整个库或导出清单。未提交。',extraCaseIds:extra,savedScopeSummary:saved.libraries};
    }else if(edit.mode!=='independent-task')return {success:false,code:'TASK_EDIT_SCOPE_INVALID',message:'无效的修改后执行范围'};
  }
  const key = requestKey(session, call.args);
  const previous = session.taskExecutionState?.submissions.findLast(item => item.callId !== call.modelCallId
    && (item.sourceUserIndex === (call.scopeUserIndex ?? scope(session)) || ['unknown', 'dispatching'].includes(item.status))
    && item.key === key && (item.status !== 'submitted' || item.definitionRevision === call.definitionRevision)
    && ['submitted', 'unknown', 'dispatching'].includes(item.status));
  if (!previous) return null;
  if (previous.status === 'submitted') return { success: true, submitted: false, reused: true, taskId: previous.taskId,
    originalCallId: previous.callId, message: '同一用户请求的相同任务已有成功回执，本次未重复提交；请使用原taskId查询或订阅。' };
  return { success: false, code: 'TASK_SUBMISSION_OUTCOME_UNKNOWN', originalCallId: previous.callId, lookupTaskId: previous.lookupTaskId,
    message: '同一用户请求的相同提交结果尚未核实，本次未执行；请先核对原调用回执与真实任务状态。' };
}
function begin(session, call, lookupTaskId) {
  const s = state(session);
  s.submissions = [...s.submissions.filter(item => item.callId !== call.modelCallId), {
    callId: call.modelCallId, sourceUserIndex: call.scopeUserIndex ?? scope(session), key: requestKey(session, call.args), definitionRevision: call.definitionRevision,
    selectors: pick(call.args, selectionFields), ...(call.args.caseIds ? { caseCount: call.args.caseIds.length, membership: selectionKey(call.args.caseIds) } : {}),
    expectedCaseCount: call.args.expectedCaseCount, selectionRevision: call.args.expectedSelectionRevision,
    requestedOptions: pick(call.args, optionsFields), status: 'dispatching', ...(lookupTaskId ? { lookupTaskId } : {}),
  }].slice(-8);
}
function settle(session, call, result, dispatched, threw) {
  const entry = session.taskExecutionState?.submissions.find(item => item.callId === call.modelCallId);
  if (!entry) return;
  entry.status = result?.success === true && typeof result.taskId === 'string' ? 'submitted'
    : result?.submissionOutcome === 'unknown' ? 'unknown'
    : !dispatched || !threw && result?.success === false ? 'failed' : 'unknown';
  if (entry.status === 'submitted') {
    entry.taskId = result.taskId;
    entry.acknowledgedOptions = pick(result, optionsFields);
    entry.caseCount = result.caseCount ?? entry.caseCount;
  }
}
function observeTask(session, call, result) {
  if (result?.success !== true || typeof call.args?.taskId !== 'string') return;
  const receipt = result.executionReceipt || result.task || result;
  const taskId = receipt.taskId || receipt.id;
  if (taskId !== call.args.taskId) return;
  for (const entry of session.taskExecutionState?.submissions || []) {
    if (entry.taskId !== taskId && entry.lookupTaskId !== taskId) continue;
    entry.status = 'submitted'; entry.taskId = taskId;
    entry.observedTaskStatus = receipt.status; entry.observedByCallId = call.modelCallId;
  }
}
function frame(session) {
  const s = session.taskExecutionState;
  if (!s) return '';
  const currentUserIndex = scope(session);
  const selections = s.selections.map(item => ({ ...item,
    equivalentSelectionCallIds: s.selections.filter(other => other.callId !== item.callId && other.membership === item.membership).map(other => other.callId) }));
  return '\n<task-execution-state>以下由执行器从实际工具调用保留，不是模型生成的授权。latestSave是实际保存成功集合；修改后重跑须用editScope绑定该回执并与用户指定库取交集。用户缩小范围不能扩大为整库；同名不同ID是不同用例。仅原始用户明确要求独立于本次修改的任务才标记independent-task，不能用于绕过范围错误。selection是已查询集合；requestedOptions是曾请求的参数，acknowledgedOptions才是提交回执返回的参数，两者均不能代替原始用户授权。sourceUserIndex可用read_user_messages回读。不同来源用户消息可能是延续、更正、暂停或新任务，不能自动沿用或自动恢复；先核对原文。已有taskId只查询订阅，不重复提交；dispatching/unknown先核实实际状态，failed不代表已有任务。\n'
    + JSON.stringify({ version: s.version, currentUserIndex, latestSave:s.latestSave || null, selections, submissions: s.submissions,
      conversationInterruption: session.lastInterruption || null }) + '\n</task-execution-state>';
}
module.exports = { scope, observeSave, observeSelection, requestKey, definitionRevision, guard, begin, settle, observeTask, frame };
