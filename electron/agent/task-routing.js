// Current request scope only: older unrelated conversations must not pin future browsing.
function taskScope(session) {
  let start = session.messages.length - 1;
  while (start >= 0 && session.messages[start].role !== 'user') start--;
  const recent = session.messages.slice(Math.max(0, start));
  const ids = new Set(recent.flatMap(m => m.tool_calls?.map(c => c.id) || []));
  const targets = new Set();
  for (const call of session.calls) {
    if (ids.has(call.modelCallId) && call.result?.taskId && call.result.success !== false) targets.add(call.result.taskId);
    if (ids.has(call.modelCallId) && call.args?.taskId) targets.add(call.args.taskId);
  }
  if (session.watch?.kind === 'task') targets.add(session.watch.id);
  return [...targets];
}
function taskRoute(session, name, args) {
  if (name === 'read_evidence') {
    const source = session.calls.find(c => c.result?.evidenceId === args.evidenceId);
    if (source?.name === 'list_tasks' && !source.routedTo) return { result: { success: false, error: '任务列表证据不允许全文检索。已知taskId使用read_task_report；查找任务使用list_tasks的query和分页。', taskIds: taskScope(session) } };
  }
  if (name !== 'list_tasks') return null;
  // Explicit search/filter/paging is a new list request, not a request to observe
  // the previously submitted task. Preserve the user's chosen query.
  if (!args.taskId && Object.keys(args).some(key=>args[key]!==undefined))return null;
  const ids = args.taskId ? [args.taskId] : taskScope(session);
  if (ids.length === 1) return { name: 'read_task_report', args: { taskId: ids[0] } };
  if (ids.length > 1) return { result: { success: false, error: '当前请求已关联多个任务，请选择下列taskId精确读取报告，不能回退扫描任务列表。', taskIds: ids } };
  return null;
}
module.exports = { taskScope, taskRoute };
