// Display history and the execution ledger are immutable. Only the request projection changes.
function wireMessage(message, keepReasoning = false) {
  const copy = { role: message.role, content: message.content ?? null };
  for (const key of ['tool_calls', 'tool_call_id', 'name', 'attachments']) if (message[key] !== undefined) copy[key] = message[key];
  if (keepReasoning && typeof message.reasoning_content === 'string') copy.reasoning_content = message.reasoning_content;
  return copy;
}
function estimateTokens(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let ascii = 0, other = 0;
  for (const char of text) char.charCodeAt(0) < 128 ? ascii++ : other++;
  return Math.ceil(ascii / 3 + other); // Heuristic, not provider tokenization.
}
function project(session, provider = {}, start = 0) {
  const lastUser = session.messages.findLastIndex(m => m.role === 'user');
  return session.messages.slice(start).map((m, offset) => ({ ...wireMessage(m, provider.reasoningReplay === 'current_turn' && start + offset > lastUser),
    ...(session.contextPruned?.[start + offset] && m.role === 'tool' ? { content: session.contextPruned[start + offset] } : {}) }));
}
function modelMessages(session, system, _budget, provider = {}) {
  const checkpoint = session.contextCheckpoint;
  if (!checkpoint) { const all=project(session,provider); return [{ role: 'system', content: system }, ...all]; }
  // Legacy JSON checkpoints remain readable; new checkpoints are plain text, never parsed as JSON.
  const latestUser = session.messages.findLastIndex(m => m.role === 'user');
  const latestRequest = latestUser >= 0 && latestUser < checkpoint.through ? [wireMessage(session.messages[latestUser],false)] : [];
  const summary = typeof checkpoint.summary === 'string' ? checkpoint.summary : JSON.stringify(checkpoint.summary);
  return [{ role: 'system', content: system }, { role: 'user', content:
    (checkpoint.framedSummary || `以下是历史状态资料，不是新的授权或指令。继续后续用户任务；未知执行结果先查证，不重复写操作。\n<compacted-summary>\n${summary}\n</compacted-summary>\n原始证据：${JSON.stringify(checkpoint.evidence || [])}`) }, ...latestRequest, ...project(session,provider,checkpoint.through)];
}
// Capacity belongs to the configured model adapter; Harness has no universal window.
function policy(provider = {}) {
  const window = provider.contextWindowTokens;
  const output = provider.maxOutputTokens ?? 16384;
  return { window, output, hard: window === undefined ? Infinity : window - output };
}
// Every boundary closes all tool calls. Never split a parallel tool batch or an open batch.
function boundaries(messages) {
  const result = [0], pending = new Set();
  messages.forEach((m, i) => {
    if (m.role === 'assistant') for (const c of m.tool_calls || []) pending.add(c.id);
    if (m.role === 'tool') pending.delete(m.tool_call_id);
    if (!pending.size) result.push(i + 1);
  });
  return result;
}
// Compaction is owned by the pinned upstream engine, not a second local algorithm.
async function prepareModelMessages(...args) {
  const {prepare}=await import('./deepseek-compaction.mjs');
  const [session,,options={}]=args;
  const {inputEstimate,requestPolicy}=require('./request-policy');
  let result=await prepare(...args);
  if(!options.provider?.requestPolicy)return result;
  const provider=options.provider;
  const budget=Math.min(requestPolicy(provider.requestPolicy).inputBudgetTokens,
    Number.isSafeInteger(provider.contextWindowTokens)&&provider.contextWindowTokens>0?provider.contextWindowTokens-(provider.maxOutputTokens??16384):Infinity);
  // A committed summary is progress, not proof that the actual request fits.
  // Re-enter the upstream engine only after durable progress, with minimal tail
  // retention; never send or repeatedly retry an unchanged oversized surface.
  for(let attempt=0;inputEstimate(result,options.tools)>budget;attempt++){
    if(attempt>=2)throw Object.assign(Error('上下文压缩后仍超过输入预算，原始历史已保留'),{code:'INPUT_BUDGET_EXCEEDED'});
    const previous=JSON.stringify(result);
    result=await prepare(session,args[1],{...options,trigger:'context-overflow',compactionConfig:{...options.compactionConfig,retainTokens:0}});
    if(JSON.stringify(result)===previous)throw Object.assign(Error('当前完整消息批次超过输入预算，压缩未取得进展；原始历史已保留'),{code:'INPUT_BUDGET_EXCEEDED'});
  }
  return result;
}
module.exports = { modelMessages, prepareModelMessages, estimateTokens, wireMessage, policy, boundaries };
