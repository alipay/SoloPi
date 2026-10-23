// solopi-desktop storage / Chat Completions adapter. Policy, selection, summarization,
// checkpoint framing, transactions and pruning are the unmodified DeepSeek packages.
import { Context } from '@deepseek-ai/cordis';
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic';
import { ToolResultPruner } from '@deepseek-ai/dsh-compaction-tool-result-pruner';
import { Session } from '@deepseek-ai/dsh-session';
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
import { TokenMeter } from '@deepseek-ai/dsh-token-meter';
import { createMessage, createSystemMessage } from '@deepseek-ai/dsh-llm';
import usageAnchors from './usage-anchor.js';
import { randomUUID,createHash } from 'node:crypto';
import context from './context.js';
import reasoning from './reasoning.js';
import deadlines from './summary-deadline.js';
import runtimeDiagnostics from '../diagnostics.js';
import requestPolicies from './request-policy.js';
import boundedSummaries from './bounded-summary.js';
import duplicateResults from './duplicate-results.js';
const { modelMessages, policy, boundaries } = context;
const VERSION = 'deepseek-harness/0.2.1-alpha.2';
const active = new WeakSet();
// Match upstream's stable-surface check without retaining a second full history JSON string.
function historyFingerprint(messages) {
  const hash=createHash('sha256');hash.update(String(messages.length));
  for(const message of messages)hash.update('\0').update(JSON.stringify(message));
  return hash.digest('hex');
}
const text = blocks => blocks.filter(b => b.type === 'text').map(b => b.text).join('');
function blocks(m) {
  const content = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (m.content || []).map(b => b.type === 'text' ? b : { type: 'text', text: JSON.stringify(b) });
  for (const c of m.tool_calls || []) content.push({ type: 'tool-call', id: c.id, name: c.function?.name || '', arguments: c.function?.arguments || '{}' });
  // Attachments are durable references; image bytes never enter the compaction surface.
  if (m.attachments?.length) content.push({type:'text',text:`\nAttachment references: ${JSON.stringify(m.attachments)}`});
  return content;
}
function wire(m) {
  const result = {role:m.role, content:text(m.content) || null};
  const calls = m.content.filter(b => b.type === 'tool-call');
  if(calls.length) result.tool_calls = calls.map(c => ({id:c.id,type:'function',function:{name:c.name,arguments:c.arguments}}));
  if(m.role === 'tool') result.tool_call_id = m.toolCallId;
  return result;
}
function diagnostic(error, response) {
  const category = error.diagnostics?.category || (error.constructor?.name === 'TargetPressureConfigError' ? 'compaction-config' : error.code === 'MAX_TOKENS' ? 'summary-truncated'
    : /no text summary/.test(error.message) ? 'summary-empty'
    : /not smaller/.test(error.message) ? 'summary-no-shrink'
    : /surface changed/.test(error.message) ? 'context-changed'
    : /above threshold/.test(error.message) ? 'context-capacity' : 'compaction');
  return {...error.diagnostics,purpose:'compaction',category,finishReason:response?.finish_reason ?? error.diagnostics?.finishReason,
    outputCharacters:response?.content?.length ?? error.diagnostics?.outputCharacters ?? 0,reasoningCharacters:response?.reasoning_content?.length ?? error.diagnostics?.reasoningCharacters ?? 0,
    completionTokens:response?.usage?.completion_tokens ?? error.diagnostics?.completionTokens};
}
export async function prepare(session, system, {provider={},model,signal=new AbortController().signal,store,save=()=>{},emit=()=>{},tools=[],compactionConfig={},summaryTimeoutMs, summaryMaxDurationMs, trigger='pressure'}) {
  if(active.has(session)) throw Error('上下文压缩正在进行');
  active.add(session);
  const ctx = new Context();
  let response;
  try {
    signal.throwIfAborted();
    usageAnchors.normalizeUsageAnchors(session);
    if(provider.requestPolicy)provider={...provider,requestPolicy:requestPolicies.requestPolicy(provider.requestPolicy)};
    const p = policy(requestPolicies.boundedProvider(provider));
    new SessionProjectionRegistry(ctx);
    const meter = new TokenMeter(ctx);
    const ds = Session.create(session.id || randomUUID());
    const route = {provider:'solopi-desktop',model:provider.model || 'configured-model'};
    // Match the actual JSON HTTP payload: optional undefined schema fields are omitted.
    const schemas = JSON.parse(JSON.stringify(tools.map(t => t.function || t)));
    ds.append('turn/start',{turn:1});
    const header={config:{...route,maxTokens:p.output},...(schemas.length?{tools:schemas}:{})};
    const headerDigest=usageAnchors.headerHash(header);
    ds.append('request/header',{reason:'initial',header});
    const origin = new Map();
    const beforeCheckpoint = session.contextCheckpoint;
    if(provider.requestPolicy && provider.reasoningReplay!=='current_turn')duplicateResults.deduplicateResults(session,store);
    const latestUser = session.messages.findLastIndex(m=>m.role==='user');
    const latestBatch=session.messages.findLastIndex(m=>m.role==='assistant' && m.tool_calls?.length);
    if(provider.requestPolicy && latestBatch>latestUser)for(const key of Object.keys(session.contextPruned || {}))if(Number(key)>latestBatch)delete session.contextPruned[key];
    const initial = modelMessages(session,system,undefined,provider);
    const start = beforeCheckpoint?.through || 0;
    const prefixCount = beforeCheckpoint ? 2 + (latestUser >= 0 && latestUser < start ? 1 : 0) : 1;
    for(let i=0;i<initial.length;i++) {
      const m=initial[i], index=i < prefixCount ? (i===1 ? start-1 : -1) : start+i-prefixCount;
      const message=m.role==='system'?createSystemMessage(m.content):createMessage({role:m.role,content:blocks(m),
        source:m.role==='assistant'?{kind:'model',...route}:m.role==='tool'?{kind:'tool',callId:m.tool_call_id}:{kind:'user'},
        ...(m.role==='tool'?{toolCallId:m.tool_call_id}:{})});
      const type=m.role==='tool'?'tool/result':`${m.role}/message`;
      const anchor=session.messages[index]?.usageAnchor;
      const usage=m.role==='assistant' && anchor?.headerHash===headerDigest && anchor.requestHash===usageAnchors.requestHash(initial.slice(0,i)) ? anchor.usage : undefined;
      if(m.role==='assistant') ds.append('step/start',{turn:1,step:i+1});
      const event=ds.append(type,m.role==='user'?message:{turn:1,step:i+1,message,...(m.role==='assistant'?{stream:[],...(usage?{usage}:{})}:{})},{surfaceOp:'append'});
      origin.set(event.seq,index);
      if(m.role==='assistant') ds.append('step/end',{turn:1,step:i+1});
    }
    const before=meter.measure(ds).totalTokens;
    const compactions=session.contextState?.compactions || 0;
    const fingerprint=historyFingerprint(session.messages);
    const checkStable=()=>{
      signal.throwIfAborted();
      if(historyFingerprint(session.messages)!==fingerprint || session.contextCheckpoint!==beforeCheckpoint)
        throw Object.assign(Error('摘要期间会话已变化，未替换上下文'),{diagnostics:{category:'context-changed'}});
    };
    // Preserve a fresh result while it fits. An oversized closed batch cannot
    // be rescued by summarizing older history: archive its ordinary results
    // first, retaining source evidence and the complete protocol. Skill text
    // and provider-required reasoning cycles keep their existing protection.
    const newestBatchTokens=latestBatch>latestUser
      ? requestPolicies.inputEstimate([{role:'system',content:system},...initial.filter((m,i)=>i>=prefixCount && start+i-prefixCount>=latestBatch)],tools) : 0;
    const protectNewestBatch=!provider.requestPolicy || newestBatchTokens<=provider.requestPolicy.inputBudgetTokens*0.85;
    const protectedText=new Set(initial.filter((m,i)=>{const index=i<prefixCount?-1:start+i-prefixCount;return session.messages[index]?.retainFullContent || (provider.requestPolicy && protectNewestBatch && latestBatch>latestUser && m.role==='tool' && index>latestBatch);}).map(m=>m.content));
    class InstructionPruner extends ToolResultPruner {
      pruneContent(blocks){return protectedText.has(text(blocks))?null:super.pruneContent(blocks);}
    }
    const pruner=new InstructionPruner(ctx,provider.requestPolicy?{thresholdChars:2048,headChars:768,tailChars:384}:{});
    const closedEnd=boundaries(session.messages).at(-1);
    // Upstream prunes all over-budget results. Keep open batches and provider-required
    // active reasoning cycles verbatim; no fabricated result is ever introduced.
    ctx.set('toolResultPruner',{pruneSession(){
      if(provider.reasoningReplay==='current_turn') return;
      const openSeqs=ds.surface.nodes.filter(seq=>origin.get(seq)>=closedEnd);
      // The runtime invokes this between completed tool batches. If an external
      // caller presents an open batch, do not run the upstream pruning pass yet.
      if(openSeqs.length) return;
      const entries=pruner.pruneSession(ds).pruned;
      session.contextPruned ||= {};
      for(const item of entries) {
        const index=origin.get(item.originalSeq);
        if(index===undefined || index<0) throw Error('压缩结果缺少原始消息索引');
        const full=session.messages[index];
        let parsed;
        try{parsed=JSON.parse(full.content);}catch{}
        const ledger=session.calls?.find(c=>c.modelCallId===full.tool_call_id);
        // A page already has a durable source. Archiving the page again creates
        // recursive JSON escaping and obscures the original searchable evidence.
        const sourcePage=ledger?.name==='read_evidence' && typeof parsed?.evidenceId==='string';
        const evidenceId=sourcePage?parsed.evidenceId:store.saveEvidence(session.id,randomUUID(),{toolCallId:full.tool_call_id,content:parsed ?? full.content});
        const event=ds.eventAt(item.replacementSeq);
        let receipt={};
        try{const raw=JSON.parse(full.content);for(const key of ['success','successScope','isError','exitCode','signal','timedOut','stopped'])if(['string','number','boolean'].includes(typeof raw[key]))receipt[key]=raw[key];}catch{}
        const page=sourcePage?`；原页 offset=${parsed.offset ?? 0}, nextOffset=${parsed.nextOffset ?? 'null'}`:'';
        const content=[...event.data.message.content,{type:'text',text:`\n结构化回执：${JSON.stringify(receipt)}\n完整结果已归档。使用 read_evidence 读取 evidenceId=${evidenceId}${page}；此处是裁剪预览，不代表完整结果。`}];
        const replacement=ds.append('tool/result',{...event.data,message:{...event.data.message,content}},
          {surfaceOp:{op:'replace',startSeq:event.seq,endSeq:event.seq},sourceEventSeqs:[event.seq]});
        origin.set(replacement.seq,index);
        session.contextPruned[index]=text(content);
      }
      session.contextState={phase:'ready',mode:'pruned',engine:VERSION,beforeTokensEstimate:before,afterTokensEstimate:meter.measure(ds).totalTokens,compactions};
      save(session);
    }});
    let requests=0;
    ctx.provide('llm',{
      imageRequestPricing:()=>undefined,
      fileRequestText:()=>undefined,
      resolveModelInfo:async()=>({...p.window === undefined ? {} : {context:{contextWindow:p.window}},defaultMaxTokens:p.output}),
      // TokenMeter's optional image/file capabilities are absent: this surface
      // contains text and durable attachment references, never image payloads.
      async *stream(options) {
        checkStable();
        session.contextState={...session.contextState,phase:'compacting',engine:VERSION,totalChunks:1,currentChunk:1,completedChunks:0,startedAt:Date.now(),batchStartedAt:Date.now(),outputCharacters:0,reasoningCharacters:0};save(session);
        // Each summary HTTP request gets the configured wall-clock budget.
        // A completed chunk must not consume the next chunk’s deadline.
        let deadline;
        const newDeadline=()=>summaryTimeoutMs !== undefined || summaryMaxDurationMs !== undefined || provider.requestPolicy
          ? deadlines.summaryDeadline({idleMs:summaryTimeoutMs ?? (provider.requestPolicy ? provider.requestPolicy.idleSeconds*1000 : Infinity),
            totalMs:summaryMaxDurationMs ?? (provider.requestPolicy ? provider.requestPolicy.totalSeconds*1000 : Infinity)}) : null;
        try {
          const run=async (messages,{recovery=false}={})=>{
            if(!recovery){deadline?.close();deadline=newDeadline();}
            signal.throwIfAborted();deadline?.signal.throwIfAborted();
            requests++;let lastEmit=0;
            session.contextState={...session.contextState,batchStartedAt:Date.now(),summaryInputTokens:context.estimateTokens(messages),outputCharacters:0,reasoningCharacters:0};save(session);
            const result=await model({provider:recovery?reasoning.compactionRecoveryReasoning(provider):reasoning.compactionReasoning(provider),messages,tools:provider.requestPolicy?[]:tools,
              onRetry:retry=>{session.retry=retry;save(session);},maxTokens:options.maxTokens,purpose:'compaction',stream:provider.requestPolicy?.stream ?? true,toolChoice:'none',
              onProgress:progress=>{deadline?.progress(progress);session.contextState={...session.contextState,outputCharacters:progress.outputCharacters || 0,reasoningCharacters:progress.reasoningCharacters || 0};if(Date.now()-lastEmit>=500){lastEmit=Date.now();emit(session);}},signal:deadline ? AbortSignal.any([signal,deadline.signal]) : signal});
            if(result.finish_reason==='stop' && result.content?.trim())session.contextState={...session.contextState,completedChunks:session.contextState.currentChunk};
            save(session);return result;
          };
          const summaryProvider=reasoning.compactionReasoning(provider);
          const draftKey=createHash('sha256').update(JSON.stringify([provider.model,provider.baseUrl,summaryProvider.thinking,summaryProvider.reasoningEffort,options.maxTokens,schemas,boundedSummaries.SUMMARY_CONTRACT_VERSION])).digest('hex');
          response=provider.requestPolicy ? await boundedSummaries.boundedSummary(options.messages.map(wire),{budget:Math.min(provider.requestPolicy.inputBudgetTokens,Number.isSafeInteger(provider.contextWindowTokens)&&provider.contextWindowTokens>0?provider.contextWindowTokens-options.maxTokens:Infinity),run,signal,onRecovery:detail=>runtimeDiagnostics.record({event:'agent.compaction-recovery',sessionId:session.id,...detail,maxTokens:options.maxTokens,recoveryThinking:reasoning.compactionRecoveryReasoning(provider).thinking}),draft:session.contextDraft,draftKey,onDraft:draft=>{session.contextDraft=draft;save(session);},onChunk:(currentChunk,totalChunks)=>{session.contextState={...session.contextState,currentChunk,totalChunks,completedChunks:currentChunk-1};save(session);}}) : await run(options.messages.map(wire));
        } catch(error) {
          error.diagnostics={...error.diagnostics,maxTokens:options.maxTokens,summaryRequests:requests};
          if(!signal.aborted && deadline?.signal.aborted) {
            const detail=deadline.snapshot();
            throw Object.assign(Error(detail.timeoutKind==='idle'?'摘要输出停滞超时，原始记录已保留':'摘要请求达到总时限，原始记录已保留'),{diagnostics:{...error.diagnostics,...detail,category:'timeout'}});
          }
          throw error;
        } finally { deadline?.close(); }
        checkStable();
        runtimeDiagnostics.record({event:'agent.compaction-summary-result',sessionId:session.id,finishReason:response.finish_reason,maxTokens:options.maxTokens,summaryRequests:requests,outputCharacters:response.content?.length || 0,reasoningCharacters:response.reasoning_content?.length || 0,completionTokens:response.usage?.completion_tokens});
        if(response.tool_calls?.length) throw Object.assign(Error('摘要模型返回工具调用，未执行'),{diagnostics:{category:'summary-tools'}});
        if(response.finish_reason!=='stop' && response.finish_reason!=='length') throw Object.assign(Error('摘要响应未正常结束'),{diagnostics:{category:'summary-truncated'}});
        if(response.reasoning_content) yield {type:'reasoning-delta',index:0,text:response.reasoning_content};
        if(response.content) yield {type:'text-delta',index:1,text:response.content};
        yield {type:'finish',reason:{kind:response.finish_reason==='length'?'max-tokens':'stop'}};
      }
    });
    let error;
    // Invoke upstream automatic hooks, including their warning/continue and
    // confirmed-overflow recovery behavior. Do not duplicate their policy here.
    class ObservedEngine extends BasicCompactionEngine {
      async compactIfNeeded(...args) {
        try { return await super.compactIfNeeded(...args); }
        catch(e) { error=e; throw e; }
      }
    }
    // Prune archived tool output before deciding whether an LLM summary is needed.
    // Pricing the original history here would trigger summaries even when pruning
    // alone brings the next real request safely below the application budget.
    if(provider.reasoningReplay!=='current_turn') ctx.get('toolResultPruner').pruneSession(ds);
    const prunedTokens=meter.measure(ds).totalTokens;
    const wireBeforeTokens=requestPolicies.inputEstimate(initial,tools);
    const wireAfterTokens=requestPolicies.inputEstimate(modelMessages(session,system,undefined,provider),tools);
    let applicationPressure={};
    // The guard prices serialized wire input. Usage anchors and the upstream meter
    // can price the same history differently; force early pressure with the public
    // headroom policy rather than inventing a provider context-overflow event.
    if(provider.requestPolicy && wireAfterTokens>provider.requestPolicy.inputBudgetTokens*0.85){
      const threshold=Math.max(1,Math.floor(Math.min(prunedTokens*0.8,p.hard*0.7)));
      // Retention is a minimum, and protocol balancing may expand it to an
      // entire parallel batch. At the hard wire limit that batch can itself
      // consume the budget; retain only the newest complete protocol boundary.
      applicationPressure={headroomTokens:Math.max(1,p.hard-threshold),retainTokens:wireAfterTokens>provider.requestPolicy.inputBudgetTokens?0:Math.floor(threshold*0.25)};
    }
    new ObservedEngine(ctx,{...(provider.requestPolicy?{headroomTokens:4096,maxTokens:provider.requestPolicy.summaryMaxTokens ?? 8192,compactionRetries:0,...applicationPressure}:{}),...compactionConfig});
    runtimeDiagnostics.record({event:'agent.compaction-decision',sessionId:session.id,trigger,wireBeforeTokens,wireAfterTokens,newestBatchTokens,protectNewestBatch,meterAfterPruningTokens:prunedTokens,inputBudgetTokens:provider.requestPolicy?.inputBudgetTokens,applicationPressure:Object.keys(applicationPressure).length>0});
    // A failed proactive summary must not block every following tool round.
    // Keep pruning and preserve the full ledger; never bypass required recovery
    // when the actual request no longer fits or the provider reported overflow.
    const checkpointCooldown=Date.parse(beforeCheckpoint?.createdAt)+60000;
    const retryAfter=Math.max(session.compactionRetry?.retryAfter || 0,Number.isFinite(checkpointCooldown)?checkpointCooldown:0);
    if(provider.requestPolicy && trigger!=='context-overflow' && wireAfterTokens<=provider.requestPolicy.inputBudgetTokens && retryAfter>Date.now()) {
      session.contextState={...session.contextState,phase:'ready',mode:'pruned',summaryDeferredUntil:retryAfter};
      runtimeDiagnostics.record({event:'agent.compaction-deferred',sessionId:session.id,validationReason:session.compactionRetry?.retryAfter>Date.now()?'recent-summary-failure':'recent-summary',wireAfterTokens,inputBudgetTokens:provider.requestPolicy.inputBudgetTokens});
      save(session);
      return modelMessages(session,system,undefined,provider);
    }
    // Deterministic upstream pruning saves input tokens even below the model's
    // context-window threshold. Original results remain in durable evidence.
    const agent={session:ds,options:route};
    if(provider.reasoningReplay!=='current_turn') {
      if(trigger==='context-overflow') await ctx.waterfall('agent/request-error',
        {agent,failure:{code:'CONTEXT_WINDOW_EXCEEDED'},signal},()=>undefined);
      else await ctx.waterfall('agent/pre-step',{agent,signal},()=>undefined);
    }
    checkStable();
    const measurement=meter.measure(ds);
    const after=measurement.totalTokens;
    runtimeDiagnostics.record({event:'agent.context-measure',sessionId:session.id,source:measurement.baseline.kind,beforeTokensEstimate:before,afterTokensEstimate:after,contextWindowTokens:p.window});
    const summaryEvents=Array.from({length:ds.seq},(_,i)=>ds.eventAt(i)).filter(e=>e.type==='compaction/summary');
    // Preserve every durable upstream commit even if a subsequent condensation
    // fails or the soft target remains exceeded, as the automatic hook does.
    if(summaryEvents.length) {
      const last=summaryEvents.at(-1), through=Math.max(...summaryEvents.flatMap(e=>e.data.shadowedSeqs).map(seq=>origin.get(seq)??-1))+1;
      if(through<start || (!beforeCheckpoint && through===start)) throw Error('上游压缩未覆盖有效历史消息');
      const checkpointNode=ds.surface.nodes.map(seq=>ds.deriveEventMessage(ds.eventAt(seq))).find(m=>m?.source?.kind==='compact-checkpoint');
      // Upstream may condense only the previous checkpoint. It already checks
      // that the framed replacement is smaller; advancing the raw-history
      // cursor is not required for useful progress. Reuse the source archive
      // when its covered span is unchanged instead of nesting it again.
      const evidence=through===start ? beforeCheckpoint.evidence : [{evidenceId:store.saveEvidence(session.id,randomUUID(),{messages:session.messages.slice(0,through),previousCheckpoint:beforeCheckpoint}),kind:'complete-history'}];
      const checkpoint={through,summary:text(last.data.summary),framedSummary:text(checkpointNode.content),evidence,engine:VERSION,createdAt:new Date().toISOString()};
      const candidate=modelMessages({...session,contextCheckpoint:checkpoint},system,undefined,provider);
      // Persist the exact upstream framing; latest explicit request remains outside
      // the summary when otherwise covered. Price that extra message too.
      const pinned=latestUser>=0&&latestUser<through?meter.estimateMessage(createMessage({role:'user',source:{kind:'user'},content:blocks(session.messages[latestUser])})):0;
      const oldPruned={...session.contextPruned},draft=session.contextDraft;
      session.contextCheckpoint=checkpoint;delete session.contextDraft;
      delete session.compactionRetry;
      for(const key of Object.keys(session.contextPruned||{}))if(Number(key)<through)delete session.contextPruned[key];
      session.contextState={phase:'ready',mode:'summary',engine:VERSION,beforeTokensEstimate:before,afterTokensEstimate:after+pinned,compactions:compactions+summaryEvents.length,compactedThrough:through,summaryRequests:requests};
      try{save(session);}catch(e){session.contextCheckpoint=beforeCheckpoint;session.contextPruned=oldPruned;session.contextDraft=draft;throw e;}
      return candidate;
    }
    if(!error && !summaryEvents.length) {
      session.contextState={phase:'ready',mode:'pruned',engine:VERSION,beforeTokensEstimate:before,afterTokensEstimate:after,compactions,measurementSource:measurement.baseline.kind};
      save(session);
    }
    if(error) {
      const diagnostics=diagnostic(error,response);
      if(provider.requestPolicy && !signal.aborted)session.compactionRetry={failedAt:Date.now(),retryAfter:Date.now()+60000,category:diagnostics.category};
      runtimeDiagnostics.record({event:'agent.compaction-warning',sessionId:session.id,...diagnostics});
      session.contextState={...session.contextState,phase:'failed',engine:VERSION,lastError:diagnostics,message:error.message};save(session);
      if(provider.requestPolicy && requestPolicies.inputEstimate(modelMessages(session,system,undefined,provider),tools)>provider.requestPolicy.inputBudgetTokens){error.diagnostics=diagnostics;throw error;}
    }
    return modelMessages(session,system,undefined,provider);
  } catch(error) {
    session.contextState={...session.contextState,phase:'failed',engine:VERSION,lastError:diagnostic(error, response),message:error.message};
    save(session);
    throw error;
  } finally {
    active.delete(session);
    await ctx.fiber.dispose();
  }
}
