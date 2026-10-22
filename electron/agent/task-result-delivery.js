// Read only confirmed, structured receipts already in this turn's operation ledger.
// No model, task submission, command execution, user-text classification or retry.
function taskResultDelivery(session) {
  let start = session.messages.length - 1;
  while (start >= 0 && session.messages[start].role !== 'user') start--;
  const ids = new Set(session.messages.slice(Math.max(0, start)).flatMap(m => (m.tool_calls || []).map(c => c.id)));
  const receipts = new Map();
  const platform = session.messages[start];
  if (platform?.source === 'platform' && platform.executionReceipt?.schemaVersion === 'glassbox.task.result.v1') {
    receipts.set(platform.executionReceipt.taskId, platform.executionReceipt);
  }
  for (const call of session.calls || []) {
    if (!ids.has(call.modelCallId) || call.status !== 'done' || call.result?.success !== true) continue;
    if (!['read_task_result', 'read_task_report'].includes(call.routedTo || call.name)) continue;
    const receipt = call.result.executionReceipt || call.result;
    if (receipt.schemaVersion !== 'glassbox.task.result.v1' || receipt.successScope !== 'query' || !receipt.taskId || typeof receipt.deliveryText !== 'string') continue;
    receipts.set(receipt.taskId, {...receipt, ...((call.routedTo || call.name) === 'read_task_report' && call.result.task ? {
      reportFailurePage: {statuses:call.result.task.filters?.statuses, selectionComplete:call.result.task.selectionComplete,
        returnedCaseCount:call.result.task.returnedCaseCount, nextOffset:call.result.task.nextOffset}
    } : {})});
  }
  if (!receipts.size) return null;
  const results = [...receipts.values()].filter(receipt => !session.messages.slice(Math.max(0,start)).some(m =>
    m.source === 'platform-result' && m.taskResults?.some(r => r.taskId === receipt.taskId && r.observedAt === receipt.observedAt)));
  if (!results.length) return null;
  return { role: 'assistant', source: 'platform-result', createdAt: new Date().toISOString(),
    content: '模型后续回复未完成；以下是本轮已保存的任务回执，未生成新的根因结论。以回执时间为准，后续状态可按同一 taskId 查询。\n\n'
      + results.map(r => r.deliveryText + `\n回执时间：${r.observedAt}` + (r.reportPackagePath ? `\n报告：${r.reportPackagePath}` : '')
        + (r.reportFailurePage?.selectionComplete && r.reportFailurePage.statuses?.includes('failed') ? '\n本次任务报告已返回完整匹配失败清单；根因分析尚未完成。' : Number.isInteger(r.nextOffset) ? '\n执行回执仅展示部分失败摘要；完整清单以任务报告为准。' : '')
        + `\n后续可按同一 taskId 查询：solopi-desktop tasks result ${r.taskId} --json；无需重新提交。`).join('\n\n'),
    taskResults: results };
}
function taskCompletionDelivery(receipt) {
  return { role: 'assistant', source: 'platform-result', createdAt: new Date().toISOString(), taskResults: [receipt],
    content: receipt.deliveryText + (receipt.reportPackagePath ? `\n报告：${receipt.reportPackagePath}` : '')
      + '\n以上为测试执行回执；根因分析与执行结果分开，不需要等待模型完成分析才能查看。' };
}
module.exports = { taskResultDelivery, taskCompletionDelivery };
