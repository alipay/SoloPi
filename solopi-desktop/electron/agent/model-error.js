// Preserve bounded protocol identifiers, never arbitrary upstream messages or bodies.
function safeIdentifier(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text=String(value);
  return /^[A-Za-z0-9_.:-]{1,160}$/.test(text) ? text : undefined;
}
function upstreamFailure(payload) {
  const detail=payload?.error || payload;
  const upstreamCode=safeIdentifier(detail?.code ?? payload?.code);
  const upstreamType=safeIdentifier(detail?.type);
  const upstreamRequestId=safeIdentifier(payload?.request_id ?? detail?.request_id ?? payload?.requestId ?? detail?.requestId);
  return Object.assign(new Error('Upstream model service returned an error'), {
    code:['context_length_exceeded','CONTEXT_WINDOW_EXCEEDED'].includes(upstreamCode) ? 'CONTEXT_WINDOW_EXCEEDED' : 'UPSTREAM_ERROR',
    upstreamCode,upstreamType,upstreamRequestId,
    upstreamMessage: typeof detail === 'string' ? detail : detail?.message,
  });
}
function modelFailure(error, { url, model, stage, startedAt, status, requestId, aborted, purpose = 'conversation', responseMetadata }) {
  const causes = []; const seen = new Set();
  function visit(e, depth = 0) {
    if (!e || depth > 5 || seen.has(e)) return;
    seen.add(e);
    // Never persist arbitrary upstream messages/stacks: they may include headers or content.
    const code = /^[A-Z0-9_]{1,80}$/.test(e.code || '') ? e.code : undefined;
    const name = /^[A-Za-z0-9_]{1,80}$/.test(e.name || '') ? e.name : 'Error';
    causes.push({ name, ...(code ? { code } : {}) });
    visit(e.cause, depth + 1);
    if (Array.isArray(e.errors)) e.errors.slice(0, 8).forEach(child => visit(child, depth + 1));
  }
  visit(error);
  const codes = causes.map(c => c.code).filter(Boolean);
  let category = 'network', hint = '网络连接失败，请检查网络、代理/VPN及模型服务可达性。';
  if (aborted) { category = 'cancelled'; hint = '模型请求已取消。'; }
  else if(codes.includes('INPUT_BUDGET_EXCEEDED')){category='input-budget';hint='请求超过单次输入预算，未发送。历史与完整证据已保留；请压缩历史、按章节读取资料或调整请求预算。';}
  else if(codes.includes('MODEL_REQUEST_TIMEOUT')){category='timeout';hint=`${responseMetadata?.timeoutKind==='first-response'?'等待首个HTTP响应':responseMetadata?.timeoutKind==='idle'?'模型输出停滞':'模型请求总耗时'}达到 ${Math.round((responseMetadata?.timeoutMs || 0)/1000)} 秒时限，已取消本次请求；已完成操作和原始证据保留。${responseMetadata?.timeoutKind==='idle' && Number.isFinite(responseMetadata?.streamIdleMs)?` 最近收到流数据距今 ${Math.round(responseMetadata.streamIdleMs/1000)} 秒；流连接有数据不代表模型产生了有效输出。`:''}`;}
  else if (codes.includes('OUTPUT_LIMIT')) { category = 'output-limit'; hint = `模型输出达到上限（结束原因 length，输出用量 ${responseMetadata?.completionTokens ?? '未知'} tokens，正文 ${responseMetadata?.outputCharacters ?? 0} 字符，推理 ${responseMetadata?.reasoningCharacters ?? 0} 字符）。本次响应未执行工具；请在模型设置中提高输出上限或调整推理设置。`; }
  else if (codes.includes('EMPTY_RESPONSE')) { category = 'empty-response'; hint = '模型响应没有有效正文或工具调用，未执行操作；请核查模型服务返回。'; }
  else if (codes.includes('INVALID_TOOL_CALL')) { category = 'invalid-tool-call'; hint = '模型返回的工具调用参数不完整或无效，未执行操作。'; }
  else if (codes.includes('CONTEXT_WINDOW_EXCEEDED')) { category = 'context-overflow'; hint = '模型服务确认请求超出上下文容量。'; }
  else if (require('./rate-limit-retry').isRateLimit({diagnostics:{httpStatus:status,upstreamCode:error.upstreamCode,upstreamType:error.upstreamType}})) { category = 'rate-limit'; hint = '模型服务限流，自动重试已用尽；请稍后再试或检查模型额度。'; }
  else if (codes.includes('UPSTREAM_ERROR')) { category = 'upstream'; hint = '模型服务返回错误，详见诊断中的上游错误码和请求 ID。'; }
  else if (status && status >= 400) {
    category = 'http';
    hint = status === 401 ? '模型认证失败，请检查 API Key。' : status === 403 ? '模型服务拒绝访问，请检查账号权限及网关访问策略。' : status === 429 ? '模型服务限流，请稍后再试或检查额度。' : status >= 500 ? '模型服务暂时异常，请稍后再试。' : '模型服务拒绝请求，请检查模型配置与接口兼容性。';
  } else if (codes.some(c => /ENOTFOUND|EAI_AGAIN/.test(c))) { category = 'dns'; hint = '模型域名解析失败，请检查 DNS、网络及 VPN。'; }
  else if (codes.some(c => /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(c))) { category = 'tls'; hint = '模型 HTTPS 证书校验失败，请检查证书链和代理证书配置。'; }
  else if (codes.includes('UND_ERR_CONNECT_TIMEOUT')) { category = 'timeout'; hint = '建立模型连接超时，尚未收到 HTTP 响应；请检查模型网关可达性、代理及网络链路。本次未获得可执行的模型结果。'; }
  else if (codes.some(c => /TIMEOUT|TIMEDOUT/.test(c))) { category = 'timeout'; hint = '连接模型服务或等待响应超时，请检查网络及服务状态。'; }
  else if (codes.some(c => /ECONNRESET|UND_ERR_SOCKET|EPIPE/.test(c))) { category = 'disconnected'; hint = stage === 'connect' ? '等待模型 HTTP 响应期间连接中断，尚未收到响应头；需核查模型网关、代理及网络链路。' : '读取模型响应期间连接中断，本次不完整响应未执行工具；已完成操作保留。'; }
  else if (codes.includes('ECONNREFUSED')) { category = 'refused'; hint = '模型连接被拒绝，请检查服务地址、端口及代理配置。'; }
  else if (codes.includes('INCOMPLETE_STREAM')) { category = purpose === 'compaction' ? 'summary-truncated' : 'response-truncated'; hint = purpose === 'compaction' ? '摘要响应流提前结束，未收到完整结束标记；原始上下文已保留。' : '模型响应流提前结束，本次不完整的工具调用未执行，已完成的操作保留。'; }
  else if (stage === 'parse') { category = 'response'; hint = error instanceof SyntaxError ? '模型返回内容不是有效 JSON，请检查接口或网关响应。' : '读取或解析模型响应失败，请查看诊断记录。'; }
  else if (stage === 'validate') { category = 'response'; hint = error.message; }
  const diagnostics = { time: new Date().toISOString(), service: new URL(url).origin, model, purpose, stage, category, durationMs: Date.now() - startedAt, causes, ...(status ? { httpStatus: status } : {}), ...(requestId && /^[\w.-]{1,160}$/.test(requestId) ? { requestId } : {}) };
  for (const key of ['upstreamCode','upstreamType','upstreamRequestId']) {
    const value=safeIdentifier(error[key]); if(value !== undefined) diagnostics[key]=value;
  }
  if (error.upstreamMessage !== undefined) diagnostics.upstreamMessage = require('./upstream-diagnostics').redactUpstreamMessage(error.upstreamMessage);
  if (responseMetadata) Object.assign(diagnostics, require('../diagnostics').sanitize(responseMetadata));
  const code = diagnostics.upstreamCode || (status >= 400 ? `HTTP ${status}` : codes[0]);
  const result = new Error(`${purpose === 'compaction' ? '上下文压缩请求失败' : '模型请求失败'}${code ? `（${code}）` : ''}：${hint}`);
  result.diagnostics = diagnostics;
  if (codes.includes('CONTEXT_WINDOW_EXCEEDED')) result.code = 'CONTEXT_WINDOW_EXCEEDED';
  return result;
}
module.exports = { modelFailure, upstreamFailure, safeIdentifier };
