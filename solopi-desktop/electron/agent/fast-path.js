// Only the explicit /tool command grammar bypasses the model.
// Natural-language text never selects an operation.
function planFastPath(message, session) {
  if (message?.role !== 'user' || message.attachments?.length) return null;
  const text = String(message.content || '').trim();
  if (/^\/tool(?:\s|$)/.test(text)) {
    const explicit = /^\/tool[ \t]+([a-zA-Z0-9_-]{1,200})[ \t]+([\s\S]+)$/.exec(text);
    return explicit ? {name:explicit[1],arguments:explicit[2],kind:'explicit'}
      : {name:'',arguments:'',kind:'explicit',syntaxError:'用法：/tool 工具名称 {完整 JSON 参数对象}'};
  }
  return null;
}

function formatFastPathResult(plan, ledger) {
  if(plan.syntaxError)return `❌ ${plan.syntaxError}。本次未执行工具。`;
  const result = ledger?.result;
  if (ledger?.status !== 'done') return `❌ ${plan.name} 未成功：${result?.error || '请查看工具调用明细'}。\n\n原始回执已保留，未自动重试。`;
  if (plan.kind === 'status' && result?.task && !result.previewTruncated) {
    const task=result.task;
    const lines=[`任务：${task.id || ledger.args.taskId}`,`状态：${task.status ?? '回执未提供'}`];
    if(task.summary)lines.push(`整轮统计：${JSON.stringify(task.summary)}`);
    if(task.error)lines.push(`错误：${task.error}`);
    return lines.join('\n\n')+'\n\n以上为查询时状态；查询成功不代表测试通过。';
  }
  const text=JSON.stringify(result ?? null,null,2);
  // The call card/evidence retains the complete receipt. Never print a broken
  // JSON fragment or pass a large result back through a model to summarize it.
  if(text.length>12000)return `✅ ${plan.name} 调用完成，回执已保留在工具调用明细中。${result?.evidenceId ? `完整证据 ID：${result.evidenceId}。` : ''}\n\n这是工具回执，不代表任务或业务验证通过。`;
  const page=result?.task?.nextOffset ?? result?.nextOffset;
  return `✅ ${plan.name} 调用完成（工具回执，不代表业务通过）。\n\n\`\`\`json\n${text}\n\`\`\`${page != null ? `\n\n结果尚有下一页，nextOffset=${page}；未将当前页当作全部结果。` : ''}`;
}
module.exports={planFastPath,formatFastPathResult};
