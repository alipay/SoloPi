const diagnostics = require('../diagnostics');
const {randomUUID} = require('node:crypto');
const modelAdapterRevision=require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync(__filename)).digest('hex').slice(0,16);
const { modelFailure, upstreamFailure, safeIdentifier } = require('./model-error');
const { wireMessage } = require('./context');
function endpoint(baseUrl) {
  const value = String(baseUrl || '').replace(/\/+$/, '');
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol)) throw Error('模型地址必须为 HTTP(S)');
  return /\/chat\/completions$/i.test(value) ? value : `${value}${/\/v1$/i.test(value) ? '' : '/v1'}/chat/completions`;
}
async function requestModelOnce({ provider, messages, tools, signal:callerSignal, fetchImpl = fetch, purpose = 'conversation', maxTokens, responseFormat, stream = true, toolChoice, allowArgumentFeedback = false, onProgress = () => {}, onDelta = () => {}, onMetrics=()=>{} }) {
  if (!provider?.model) throw Error('请先在设置中心配置模型名称');
  const url = endpoint(provider.baseUrl), startedAt = Date.now();
  const requestId=randomUUID();
  const policy=provider.requestPolicy && require('./request-policy').requestPolicy(provider.requestPolicy);
  const deadline=policy?require('./request-deadline').requestDeadline(policy):null;
  const signal=deadline ? AbortSignal.any([...(callerSignal?[callerSignal]:[]),deadline.signal]) : callerSignal;
  diagnostics.record({event:'model.start',modelAdapterRevision,streamRequested:stream,requestId,purpose,model:provider.model,messageCount:messages.length,toolCount:tools.length,maxTokens,thinking:provider.thinking,reasoningEffort:provider.reasoningEffort,toolChoice:typeof toolChoice==='string'?toolChoice:toolChoice?'named':'auto'});
  let stage = 'connect', response, responseMetadata;
  const transport = { streamRequested:stream, streamBytes:0 };
  let firstOutputMs;
  const delta=value=>{
    if(value.content || value.reasoning || value.semanticProgress===true){deadline?.progress();if(firstOutputMs===undefined)firstOutputMs=Date.now()-startedAt;}
    onDelta(value);
  };
  let waitingTimer;
  const observation=require('./transport-diagnostics').observeTransport({url,requestId,purpose,metadata:transport});
  try {
  const inputBudget=policy && Math.min(policy.inputBudgetTokens,Number.isSafeInteger(provider.contextWindowTokens)&&provider.contextWindowTokens>0?provider.contextWindowTokens-(maxTokens ?? provider.maxOutputTokens ?? 16384):Infinity);
  if(policy && require('./request-policy').inputEstimate(messages,tools)>inputBudget)
    throw Object.assign(Error('请求超过单次输入预算，未发送；请压缩历史或按章节读取资料'),{code:'INPUT_BUDGET_EXCEEDED'});
  const serializeStartedAt = Date.now();
  const requestBody = JSON.stringify({ model: provider.model, ...(responseFormat ? { response_format: responseFormat } : {}), ...(maxTokens ? { max_tokens: maxTokens } : {}), messages: require('./request-history').requestHistory(messages).map(m => require('./attachments').attachmentMessage(wireMessage(m, provider.reasoningReplay === 'current_turn'), purpose !== 'compaction')), ...(['disabled', 'enabled'].includes(provider.thinking) ? { thinking: { type: provider.thinking } } : {}), ...(provider.reasoningEffort ? { reasoning_effort: provider.reasoningEffort } : {}), tools: tools.length ? tools : undefined, stream, ...(toolChoice ? { tool_choice: toolChoice } : {}) });
  Object.assign(transport,{requestBytes:Buffer.byteLength(requestBody),serializeMs:Date.now()-serializeStartedAt});
  onDelta({stage:'waiting'});
  diagnostics.record({event:'model.dispatch',requestId,purpose,...transport});
  waitingTimer=setInterval(()=>diagnostics.record({event:'model.waiting-headers',requestId,purpose,durationMs:Date.now()-startedAt,...transport}),30000);
  waitingTimer.unref?.();
  response = await observation.run(()=>fetchImpl(url, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', ...(provider.apiKey ? {Authorization: `Bearer ${provider.apiKey}`} : {}) },
    body: requestBody,
  }));
  clearInterval(waitingTimer);
  deadline?.headers();
  transport.headersMs = Date.now()-startedAt;
  if (!response.ok) {
    const retryAfter=response.headers?.get?.('retry-after');
    if(retryAfter){
      const ms=/^\d+(?:\.\d+)?$/.test(retryAfter.trim())?Number(retryAfter)*1000:Date.parse(retryAfter)-Date.now();
      if(Number.isFinite(ms))transport.retryAfterMs=Math.max(0,ms);
    }
    // Only an explicit provider error code confirms overflow; never infer it from
    // HTTP 400, a timeout, or arbitrary error text. Do not persist the raw body.
    const failure = await Promise.resolve().then(() => response.json()).catch(() => ({}));
    if (failure?.error || failure?.code !== undefined) throw upstreamFailure(failure);
    throw Error(`模型请求失败（HTTP ${response.status}）`);
  }
  transport.headersMs = Date.now()-startedAt;
  diagnostics.record({event:'model.headers',requestId,purpose,httpStatus:response.status,...transport});
  onDelta({stage:'receiving'});
  stage = 'parse'; transport.transportPhase='receiving-response';
  const data = stream && /text\/event-stream/i.test(response.headers?.get?.('content-type') || '') ? await readStream(response, signal, progress => { if(progress.streamBytes>transport.streamBytes)deadline?.transportProgress(); Object.assign(transport,progress,...(progress.streamBytes>0?[{transportPhase:'receiving-stream'}]:[])); onProgress(progress); }, delta) : await response.json();
  signal?.throwIfAborted();
  if (data?.error) throw upstreamFailure(data);
  stage = 'validate';
  const message = data.choices?.[0]?.message;
  if(!stream && firstOutputMs===undefined)firstOutputMs=Date.now()-startedAt;
  diagnostics.record({event:'model.response',upstreamRequestId:response.headers?.get?.('x-request-id'),contentType:typeof message?.content,requestId,purpose,model:provider.model,httpStatus:response.status,durationMs:Date.now()-startedAt,firstOutputMs,headersMs:transport.headersMs,requestBytes:transport.requestBytes,responseFields:Object.keys(data || {}),messageFields:Object.keys(message || {}),choiceCount:data.choices?.length,finishReason:data.choices?.[0]?.finish_reason,thinkingDisabledRequested:provider.thinking==='disabled',reasoningReturnedWhileDisabled:provider.thinking==='disabled' && !!message?.reasoning_content,outputCharacters:typeof message?.content==='string'?message.content.length:0,reasoningCharacters:typeof message?.reasoning_content==='string'?message.reasoning_content.length:0,promptTokens:data.usage?.prompt_tokens,completionTokens:data.usage?.completion_tokens,totalTokens:data.usage?.total_tokens});
  diagnostics.record({event:'model.tool-frames',modelAdapterRevision,requestId,purpose,wireFinishReason:transport.wireFinishReason,wireDone:transport.wireDone,wireToolCallFragments:transport.wireToolCallFragments,unexpectedToolCallFrames:transport.unexpectedToolCallFrames,parsedToolCalls:message?.tool_calls?.length || 0});
  responseMetadata = {finishReason:data.choices?.[0]?.finish_reason,maxTokens,
    outputCharacters:typeof message?.content==='string'?message.content.length:0,
    reasoningCharacters:typeof message?.reasoning_content==='string'?message.reasoning_content.length:0,
    promptTokens:data.usage?.prompt_tokens,completionTokens:data.usage?.completion_tokens,totalTokens:data.usage?.total_tokens};
  if (purpose !== 'compaction' && responseMetadata.finishReason === 'length')
    throw Object.assign(Error('模型输出达到上限'), {code:'OUTPUT_LIMIT'});
  if (!message || (purpose !== 'compaction' && !(typeof message.content === 'string' && message.content.trim()) && !message.tool_calls?.length))
    throw Object.assign(Error('模型未返回文本或工具调用'), {code:'EMPTY_RESPONSE'});
  if (purpose !== 'compaction') {
    const ids = new Set();
    for (const [toolIndex, c] of (message.tool_calls || []).entries()) {
      let validationReason;
      if (!c?.id || typeof c.id !== 'string' || ids.has(c.id) || c.type !== 'function' || !c.function?.name || typeof c.function.name !== 'string')
        validationReason = 'invalid-envelope';
      else {
        ids.add(c.id);
        try {
          if (typeof c.function.arguments !== 'string') throw Error();
          const args = JSON.parse(c.function.arguments);
          if (!args || Array.isArray(args) || typeof args !== 'object') validationReason = 'arguments-not-object';
        } catch { validationReason = 'invalid-arguments-json'; }
      }
      if (validationReason) {
        const detail = {validationReason, toolIndex, argumentCharacters: typeof c?.function?.arguments === 'string' ? c.function.arguments.length : 0};
        diagnostics.record({event:'model.tool-validation', requestId, purpose, ...detail});
        responseMetadata = {...responseMetadata, ...detail};
        if (!allowArgumentFeedback || validationReason === 'invalid-envelope')
          throw Object.assign(Error('模型返回的工具调用参数不完整或无效，未执行'), {code:'INVALID_TOOL_CALL'});
      }
    }
  }

  if (message.tool_calls?.length > 16) throw Error('单轮工具调用超过限制');
  onMetrics({durationMs:Date.now()-startedAt,headersMs:transport.headersMs,firstOutputMs,requestBytes:transport.requestBytes,promptTokens:data.usage?.prompt_tokens,completionTokens:data.usage?.completion_tokens});
  return { ...(purpose !== 'compaction' ? {usageAnchor:require('./usage-anchor').usageAnchor(data,{provider,messages,tools,maxTokens})} : {}), ...(purpose === 'compaction' ? { finish_reason: data.choices[0].finish_reason, usage: data.usage } : {}), role: 'assistant', content: message.content || null, ...(typeof message.reasoning_content === 'string' ? { reasoning_content: message.reasoning_content } : {}), ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) };
  } catch (error) {
    if(!callerSignal?.aborted && deadline?.signal.aborted){error=Object.assign(Error('Model request deadline exceeded'),{code:'MODEL_REQUEST_TIMEOUT'});Object.assign(transport,deadline.snapshot());}
    onMetrics({durationMs:Date.now()-startedAt,headersMs:transport.headersMs,firstOutputMs,requestBytes:transport.requestBytes});
    clearInterval(waitingTimer);
    observation.finish();
    const seenCauses=new Set();
    for(let cause=error,depth=0;cause && depth<6 && !seenCauses.has(cause);cause=cause.cause,depth++) {
      seenCauses.add(cause);
      for(const key of ['bytesWritten','bytesRead']) {
        const value=cause.socket?.[key];
        if(Number.isSafeInteger(value) && value>=0) transport[key==='bytesWritten'?'socketBytesWritten':'socketBytesRead']=value;
      }
    }
    const {redactUpstreamMessage,requestIdentifiers}=require('./upstream-diagnostics');
    const identifiers=requestIdentifiers(response?.headers);
    const echoed=[provider.apiKey,...messages.flatMap(m=>[typeof m.content==='string'?m.content:JSON.stringify(m.content),...(m.tool_calls||[]).map(c=>c.function?.arguments)])];
    error.upstreamMessage=redactUpstreamMessage(error.upstreamMessage,echoed);
    diagnostics.record({event:'model.error',requestId,purpose,stage,durationMs:Date.now()-startedAt,...transport,httpStatus:response?.status,code:error.cause?.code || error.code,upstreamCode:error.upstreamCode,upstreamType:error.upstreamType,upstreamRequestId:identifiers.requestId || error.upstreamRequestId,upstreamTraceId:identifiers.traceId,upstreamMessage:error.upstreamMessage});
    throw modelFailure(error, { url, model: provider.model, purpose, stage, startedAt, status: response?.status, requestId: identifiers.requestId, aborted: callerSignal?.aborted, responseMetadata: {...responseMetadata,...transport,clientRequestId:requestId,upstreamTraceId:identifiers.traceId} });
  } finally { deadline?.close();observation.finish(); }
}
// Incremental SSE parsing handles arbitrary UTF-8/line chunk boundaries. A socket EOF
// without a terminal choice is not a successful summary, even when text was received.
async function readStream(response, signal, onProgress = () => {}, onDelta = () => {}) {
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', dataLines = [], content = '', reasoning = '', finish, usage, terminal = false;
  const calls = new Map();
  let streamBytes = 0, eventName = '',sseDataEventCount=0,sseCommentCount=0,semanticDeltaCount=0,wireToolCallFragments=0,unexpectedToolCallFrames=0;
  const startedAt = Date.now();
  const dispatch = () => {
    if (!dataLines.length) return;
    const raw = dataLines.join('\n'); dataLines = [];
    const event = eventName; eventName = '';
    if (raw === '[DONE]') { terminal = true; return; }
    sseDataEventCount++;
    const value = JSON.parse(raw);
    if (value.error || event === 'error') throw upstreamFailure(value);
    usage = value.usage || usage;
    if(value.tool_calls?.length)unexpectedToolCallFrames++;
    const choice = value.choices?.find(c => c.index === 0) || value.choices?.[0];
    if (!choice) return;
    const delta = choice.delta || {};
    wireToolCallFragments+=Array.isArray(delta.tool_calls)?delta.tool_calls.length:0;
    if(choice.message?.tool_calls?.length || delta.function_call || choice.function_call)unexpectedToolCallFrames++;
    if (typeof delta.content === 'string') content += delta.content;
    if (typeof delta.reasoning_content === 'string') reasoning += delta.reasoning_content;
    for (const c of delta.tool_calls || []) {
      const old = calls.get(c.index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
      if (c.id) old.id = c.id;
      old.function.name += c.function?.name || ''; old.function.arguments += c.function?.arguments || '';
      calls.set(c.index, old);
    }
    const semanticProgress=!!(delta.content || delta.reasoning_content || delta.tool_calls?.some(c=>c.id || c.function?.name || c.function?.arguments));
    if(semanticProgress)semanticDeltaCount++;
    if (typeof delta.content === 'string' || typeof delta.reasoning_content === 'string' || delta.tool_calls?.length) onDelta({stage:'receiving',content:delta.content || '',reasoning:delta.reasoning_content || '',toolCallCount:calls.size,semanticProgress});
    if (choice.finish_reason != null) finish = choice.finish_reason;
  };
  const line = value => {
    if (!value) { dispatch(); eventName = ''; }
    else if (value.startsWith(':')) sseCommentCount++;
    else if (value.startsWith('event:')) eventName = value.slice(6).trim();
    else if (value.startsWith('data:')) dataLines.push(value.slice(5).replace(/^ /, ''));
  };
  try {
    while (!terminal) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      if (value?.length) { streamBytes += value.length; }
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) { line(buffer.slice(0, index).replace(/\r$/, '')); buffer = buffer.slice(index + 1); }
      onProgress({wireFinishReason:finish,wireDone:terminal,sseDataEventCount,sseCommentCount,semanticDeltaCount,wireToolCallFragments,unexpectedToolCallFrames,parsedToolCalls:calls.size,streamBytes, streamElapsedMs:Date.now()-startedAt, outputCharacters:content.length, reasoningCharacters:reasoning.length});
      if (done) { if (buffer) line(buffer.replace(/\r$/, '')); dispatch(); break; }
    }
    if (!finish) throw Object.assign(Error('模型响应流提前结束，未收到结束原因'), { code: 'INCOMPLETE_STREAM' });
    if(unexpectedToolCallFrames && !calls.size)throw Object.assign(Error('响应含不支持的工具调用帧，未执行；不能将其当作普通文本完成'),{code:'INVALID_TOOL_CALL'});
    return { choices: [{ message: { content, reasoning_content: reasoning, ...(calls.size ? { tool_calls: [...calls.values()] } : {}) }, finish_reason: finish }], usage };
  } finally { onProgress({wireFinishReason:finish,wireDone:terminal,sseDataEventCount,sseCommentCount,semanticDeltaCount,wireToolCallFragments,unexpectedToolCallFrames,parsedToolCalls:calls.size,streamBytes,streamElapsedMs:Date.now()-startedAt,outputCharacters:content.length,reasoningCharacters:reasoning.length}); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function requestModel(options) {
  const run=()=>require('./request-scheduler').scheduledRequest(options,()=>requestModelOnce(options));
  if(options.retry===false)return run();
  const onRetry=state=>{
    if(state) diagnostics.record({event:'model.retry-wait',purpose:options.purpose || 'conversation',category:state.reason || 'rate-limit',attempt:state.attempt,timeoutMs:Math.max(0,state.retryAt-Date.now())});
    options.onRetry?.(state);
  };
  // One establishment retry for the whole request, not one per 429 attempt.
  let connectionRecoveryUsed=false;
  const recover=()=>require('./connect-retry').withConnectRetry(run,{...options,onRetry:state=>{
    if(state){if(connectionRecoveryUsed)throw Error('Connection recovery budget exhausted');connectionRecoveryUsed=true;}
    onRetry(state);
  }});
  return require('./rate-limit-retry').withRateLimitRetry(()=>connectionRecoveryUsed?run():recover(),{...options,onRetry});
}
module.exports = { requestModel, endpoint, readStream };
