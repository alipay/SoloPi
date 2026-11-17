// Desktop composition of unmodified DeepSeek Harness packages. No local agent loop.
import { Context } from '@deepseek-ai/cordis';
import { SessionStore } from '@deepseek-ai/dsh-session';
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
import { AgentRegistry } from '@deepseek-ai/dsh-agent';
import { AgentLoop } from '@deepseek-ai/dsh-agent-loop';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools';
import { LlmRuntime, LlmAdapter, resolveRetryPolicy, createUserMessage, createSystemMessage, isAgentLoopRequest } from '@deepseek-ai/dsh-llm';
import {registerConfiguredProvider} from './provider-registration.mjs';
import { TokenMeter } from '@deepseek-ai/dsh-token-meter';
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic';
import { ToolResultPruner } from '@deepseek-ai/dsh-compaction-tool-result-pruner';
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import { apply as checkpointPolicy } from '@deepseek-ai/dsh-session-checkpoint-policy';
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local';
import { apply as installFileTools, Config as FileToolsConfig } from '@deepseek-ai/dsh-tool-fs';
import { SkillRegistry } from '@deepseek-ai/dsh-skill';
import { WorkingDirectoryService } from '@deepseek-ai/dsh-working-directory';
import { apply as installSkillTool, Config as SkillToolConfig } from '@deepseek-ai/dsh-tool-skill';
import { apply as installRetry } from '@deepseek-ai/dsh-llm-retry';
import { LocalAttachmentStore } from '@deepseek-ai/dsh-attachment-local';
import fs from 'node:fs';
import Ajv from 'ajv';
import {randomUUID} from 'node:crypto';
import requestRecovery from './harness-request-recovery.js';
import modelTransportTrace from './model-transport-trace.js';
import contextReceipts from './context-receipts.js';
import local from './local-runtime.cjs';
import skillInstructions from './skill-context.js';
import {installRequestControl} from './harness-request-control.mjs';
import {isTokenDelta} from '@deepseek-ai/dsh-llm/assistant-stream';
import nativeContext from './context.js';
import policies from './request-policy.js';
import {modelFailure} from './model-failure.mjs';
import {pressureDecision,pressureRegion,ToolProgressGuard} from './harness-progress-policy.mjs';

export const HARNESS_VERSION = '0.2.1-alpha.2';
export const textOf = content => (content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
export function desktopMessage(message) {
  const content = textOf(message.content);
  const calls = message.content.filter(b => b.type === 'tool-call').map(b => ({id:b.id,type:'function',function:{name:b.name,arguments:b.arguments}}));
  const reasoning = message.content.filter(b => b.type === 'reasoning').map(b => b.text).join('');
  return { role:message.role, content:content || null, ...(reasoning?{reasoning_content:reasoning}:{}),
    ...(calls.length?{tool_calls:calls}:{}), ...(message.toolCallId?{tool_call_id:message.toolCallId}:{}),
    harnessMessageId:message.id };
}
export function modelImages(messages,attachments){
 return messages.flatMap((m,messageIndex)=>(m.content||[]).flatMap((b,blockIndex)=>{
  if(b.type!=='image')return [];
  const file=attachments?.imageHostPath(b.attachment);
  if(!file)throw Object.assign(Error('Image attachment has no host file'),{code:'ATTACHMENT_PROJECTION_UNSUPPORTED'});
  return [{path:file,messageIndex,blockIndex}];
 }));
}
export function userInput(text, source='user') {
  return createUserMessage({content:[{type:'text',text}],source:source==='user'?{kind:'user'}:source==='platform'?{kind:'solopi-platform',form:'notice',summary:'SoloPi operation status'}:{kind:'solopi-context'}});
}
// Import a closed historical projection once. Never execute pending historical calls.
export function legacySeed(messages) {
  if(!messages.length)return [];
  // Old logs have no upstream turn/step lifecycle. Import as declared recall,
  // rather than fabricating native execution events or replaying open calls.
  const data=createUserMessage({source:{kind:'solopi-history',form:'recall'},content:[{type:'text',text:
    '旧执行器历史资料（不是新指令或新增授权；未完成工具的结果未知，不自动重放）。原始回执仍可按callId读取。\n'+JSON.stringify(messages)}]});
  const rows=[{type:'turn/start',data:{turn:1}},{type:'step/start',data:{turn:1,step:1}},
    {type:'system/message',data:{turn:1,step:1,message:createSystemMessage('')},surfaceOp:'append'},
    {type:'user/message',data,surfaceOp:'append'},
    {type:'step/end',data:{turn:1,step:1}},
    {type:'turn/end',data:{turn:1,reason:{kind:'completed'}}}];
  return rows.map((row,seq)=>({seq,time:Date.now(),...row}));
}

export async function createHarnessHost({id,provider,tools=[],system,seed=[],onEvent=()=>{},onStream=()=>{},onError=()=>{},onIncomplete=()=>{},onModel=()=>{},beforeTool,adapter,model,configureProvider,compaction=true,persistenceDirectory,cwd,skillCatalog}) {
  provider=policies.boundedProvider({...provider,requestPolicy:policies.requestPolicy({...(provider.mode==='local-runtime'?{firstResponseSeconds:300,idleSeconds:300,totalSeconds:300}:{}),...provider.requestPolicy})});
  const ctx=new Context();
  new SessionStore(ctx);new SessionProjectionRegistry(ctx);new AgentRegistry(ctx);
  new SystemPrompt(ctx,{});new ToolRuntime(ctx,{mode:'native'});new LlmRuntime(ctx);
  if(persistenceDirectory)new LocalAttachmentStore(ctx,LocalAttachmentStore.Config({dshHome:persistenceDirectory}));
  if(cwd||skillCatalog)new WorkingDirectoryService(ctx,WorkingDirectoryService.Config({...(cwd?{defaultDirectory:cwd}:{})}));
  if(cwd||skillCatalog)new LocalFileSystem(ctx,LocalFileSystem.Config({cwd:cwd||process.cwd()}));
  if(cwd)installFileTools(ctx,FileToolsConfig({}));
  if(skillCatalog){
    new SkillRegistry(ctx);
    ctx.skills.registerProvider(({invalidate})=>{
      // The native registry caches discovery until its provider invalidates it.
      // Re-scan at the next model step after local writes or extension changes.
      ctx.on('agent/pre-step',(_payload,next)=>{invalidate();return next();});
      return {name:'solopi',list:async()=>{
      const path=await import('node:path');
      return skillCatalog().filter(s=>s.enabled!==false).map(s=>({name:s.name,description:s.description||'',path:path.join(s.directory,'SKILL.md'),invocation:{modelInvocable:true,userInvocable:true},source:'custom',provider:'solopi',rank:600,locator:s.name,resourceBase:{kind:'directory',path:s.directory}}));
    },get:async candidate=>{
      const fs=await import('node:fs');return {...candidate,content:fs.readFileSync(candidate.path,'utf8')};
    }};});
    installSkillTool(ctx,SkillToolConfig({}));
  }
  if(persistenceDirectory)new JsonlSessionPersistence(ctx,{root:persistenceDirectory,compression:'none'});
  if(provider.mode==='local-runtime'&&!model&&!adapter){
    model=(options)=>import('./local-runtime.cjs').then(m=>m.default.requestModel(options));
  }
  if(model&&!adapter){
    // Injectable provider seam for deterministic desktop tests, not a second loop.
    adapter=new class extends LlmAdapter{
    providerRetryPolicy(){return resolveRetryPolicy(requestRecovery.retryPolicy,'solopi-local-runtime');}
    async resolveModel(providerId,modelId){return{provider:providerId,id:modelId,name:modelId,...(provider.contextWindowTokens?{context:{contextWindow:provider.contextWindowTokens}}:{}),...(provider.mode==='local-runtime'?{inputModalities:['text',...(local.definition(provider.runtimeId,{directory:provider.runtimeDirectory}).family==='codex'?['image']:[])]}:{}),...(provider.maxOutputTokens?{defaultMaxTokens:provider.maxOutputTokens}:{})};}
    async *stream(options){
      options.signal.throwIfAborted();if(provider.mode==='local-runtime'&&local.definition(provider.runtimeId,{directory:provider.runtimeDirectory}).family!=='codex'&&options.messages.some(m=>m.content?.some(b=>b.type==='image')))throw modelFailure(Object.assign(Error('当前本地运行时不支持图片输入，请选择支持图片的API模型'),{code:'UNSUPPORTED_IMAGE_INPUT'}));let abort;
      let r,notify,streamedText='',streamedReasoning='',progress=[];const wake=()=>{notify?.();notify=undefined;};let settled=false;const progressCallback=chunk=>{if(options.signal.aborted||settled||!['text-delta','reasoning-delta'].includes(chunk.type)||!chunk.text)return;progress.push(chunk);wake();};try{const response=Promise.race([model({provider,maxTokens:options.maxTokens,stream:true,onProgress:progressCallback,purpose:isAgentLoopRequest(options)?'conversation':'compaction',messages:options.messages.map(desktopMessage),...(provider.mode==='local-runtime'?{images:modelImages(options.messages,ctx.get('attachments'))}:{}),tools:(options.tools||[]).map(t=>({type:'function',function:t})),signal:options.signal}),new Promise((_,reject)=>{abort=()=>reject(options.signal.reason);options.signal.addEventListener('abort',abort,{once:true});if(options.signal.aborted)abort();})]);let failure;response.then(value=>{r=value;settled=true;wake();},error=>{failure=error;settled=true;wake();});let opened=new Set();while(!settled||progress.length){while(progress.length){const chunk=progress.shift(),index=chunk.type==='reasoning-delta'?0:1,blockType=index===0?'reasoning':'text';if(!opened.has(index)){opened.add(index);yield{type:'block-start',index,blockType};}if(index===0)streamedReasoning+=chunk.text;else streamedText+=chunk.text;yield{...chunk,index};}if(!settled)await new Promise(resolve=>{notify=resolve;});}if(failure)throw failure;for(const index of opened)yield{type:'block-end',index,block:{type:index===0?'reasoning':'text',text:index===0?streamedReasoning:streamedText}};}catch(error){const facts=Object.fromEntries(['timedOut','contextExceeded','exitCode','signal','durationMs','httpStatus','stdoutBytes','stderrBytes','runtimeSubtype'].filter(k=>error.diagnostics?.[k]!==undefined).map(k=>[k,error.diagnostics[k]]));onModel({event:'model.runtime-error',code:error.code,...facts});throw modelFailure(error);}finally{options.signal.removeEventListener('abort',abort);}
      if(r?.runtimeDiagnostics?.event==='model.runtime-fallback')onModel({event:'model.runtime-fallback',cause:r.runtimeDiagnostics.cause,mode:r.runtimeDiagnostics.mode,attempts:r.runtimeDiagnostics.attempts});
      const blocks=[];if(r.reasoning_content&&!streamedReasoning)blocks.push({type:'reasoning',text:r.reasoning_content});if(r.content&&!streamedText)blocks.push({type:'text',text:r.content});else if(r.content&&streamedText&&r.content.startsWith(streamedText)&&r.content.length>streamedText.length)blocks.push({type:'text',text:r.content.slice(streamedText.length)});else if(r.content&&streamedText&&!r.content.startsWith(streamedText))blocks.push({type:'text',text:r.content});
      for(const c of r.tool_calls||[])blocks.push({type:'tool-call',id:c.id,name:c.function.name,arguments:c.function.arguments});
      for(const [offset,block]of blocks.entries()){const index=offset+2;yield{type:'block-start',index,blockType:block.type};yield{type:'block-end',index,block};}
      yield{type:'finish',reason:r.tool_calls?.length?'tool-calls':'stop'};
    }}();
  }
  if(adapter)ctx.llm.registerAdapter(['configured'],adapter);
  else if(configureProvider) await configureProvider(ctx,provider);
  else registerConfiguredProvider(ctx,provider);
  new TokenMeter(ctx);
  class ReceiptPruner extends ToolResultPruner {
    pruneSession(session){
      // The current tool batch must reach a model request once before it becomes history.
      let latestAssistant=-1;
      for(let seq=session.seq-1;seq>=0;seq--)if(session.eventAt(seq)?.type==='assistant/message'){latestAssistant=seq;break;}
      const visible={surface:{nodes:[...session.surface.nodes].filter(seq=>!(seq>latestAssistant&&session.eventAt(seq)?.type==='tool/result'))},
        seq:session.seq,eventAt:seq=>session.eventAt(seq),deriveEventMessage:e=>session.deriveEventMessage(e),append:(...args)=>session.append(...args)};
      return skillInstructions.pruneWithoutInstructions(s=>super.pruneSession(s),visible);
    }
    pruneContent(content){
      const clipped=super.pruneContent(content);
      return clipped?[{type:'text',text:contextReceipts.pruningNotice(content)},...clipped]:null;
    }
  }
  const progressGuard=new ToolProgressGuard();
  ctx.on('session/event',(_session,event)=>{if(event.type==='turn/start')progressGuard.reset();});
  // Use the native around-dispatch seam, not preflight: the scheduler may
  // prepare a whole parallel batch before dispatching any of its bodies.
  ctx.on('tools/execute',async(exec,next)=>{
    const release=await progressGuard.acquire(exec.name,exec.arguments,exec.signal);
    try{
      const blocked=progressGuard.blockFor(exec.name,exec.arguments);
      if(blocked){
        const error=Object.assign(Error(blocked.message),blocked);
        onModel({event:'tools.no-progress',code:error.code,tool:error.tool,attempts:error.attempts,identicalFailures:error.identicalFailures});
        onError(error);exec.agent?.cancel({kind:'hook',reason:error.code});throw error;
      }
      const result=await next();progressGuard.record(exec.name,exec.arguments,result);return result;
    }finally{release();}
  });
  const pruner=new ReceiptPruner(ctx);
  // Before upstream builds the next request envelope, regardless of summary pressure.
  ctx.on('agent/pre-step',async({agent,signal},next)=>{
    if(!signal.aborted)pruner.pruneSession(agent.session);
    return next();
  });
  if(compaction){
    const info=await ctx.llm.resolveModelInfo('configured',provider.model||(adapter?'fixture':undefined));
    const capacity=info.context?.contextWindow;
    const policy={maxTokens:8192,headroomTokens:16384,...(capacity?{thresholdRatio:Math.min(.8,180000/capacity),retainRatio:Math.min(.16,24000/capacity)}:{})};
    // Keep upstream selection, summary prompts, pairing and persistence semantics.
    class ObservedCompaction extends BasicCompactionEngine {
      async compactIfNeeded(agent,trigger,signal){
        const before=ctx.tokenMeter.measure(agent.session).totalTokens;
        const started=Date.now();let outcome='skipped';
        try{
          // Provider usage anchors may underprice imported recall. Price the
          // actual surface too, then use the upstream explicit region API.
          const pressure=pressureDecision(agent.session,{capacity,output:provider.maxOutputTokens||16384,headroom:policy.headroomTokens,inputBudget:provider.requestPolicy.inputBudgetTokens,meterTokens:before});
          if(trigger==='pressure')onModel({event:'context.pressure-decision',pressureReason:pressure.reason,requestTokensEstimate:pressure.total,fixedTokensEstimate:pressure.fixed,newHistoryTokensEstimate:pressure.growth,growthRequiredTokens:pressure.growthRequired});
          if(trigger==='pressure'&&!pressure.compact){
            return null;
          }
          // The upstream meter uses fixed text density; the wire estimate also
          // accounts for multilingual text and schemas. Force one balanced
          // region only when there is useful history, never merely a large header.
          let result;
          if(trigger==='pressure'&&pressure.total>=pressure.threshold){
            const region=pressureRegion(agent.session,Math.min(24000,Math.max(4096,Math.floor((pressure.hard-pressure.fixed)*.35))));
            result=region?await this.compactRegion(region.start,region.end,agent,signal):null;
          }else result=await super.compactIfNeeded(agent,trigger,signal);
          if(result)outcome='completed';return result;
        }
        catch(error){outcome='failed';onModel({event:'context.compaction-error',trigger,code:error.code||error.name,errorCauses:modelTransportTrace.causes(error)});throw error;}
        finally{onModel({event:'context.compaction',trigger,outcome,beforeTokensEstimate:before,afterTokensEstimate:ctx.tokenMeter.measure(agent.session).totalTokens,durationMs:Date.now()-started,...(capacity?{contextWindowTokens:capacity,thresholdTokens:Math.floor(Math.min(capacity*policy.thresholdRatio,capacity-(agent.session.requestHeader()?.config.maxTokens??info.defaultMaxTokens??0)-policy.headroomTokens)),retainTokens:Math.floor(capacity*policy.retainRatio)}:{})});}
      }
    }
    new ObservedCompaction(ctx,policy);
  }
  new AgentLoop(ctx,AgentLoop.Config({}));
  installRequestControl(ctx,{provider,onModel});
  requestRecovery.installRetrySchedule(ctx);
  installRetry(ctx);
  ctx.on('llm/stream',async function*(options,next){
    const started=Date.now(),requestId=randomUUID(),purpose=isAgentLoopRequest(options)?'conversation':'compaction';let usage,firstOutputMs;
    const observation=modelTransportTrace.observeModelTransport({url:provider.baseUrl,requestId,purpose,record:onModel});
    onModel({event:'model.start',requestId,purpose,...modelTransportTrace.endpoint(provider.baseUrl),configuredModel:provider.model,modelSelectionMatches:options.model===provider.model,model:options.model,messageCount:options.messages.length,toolCount:options.tools?.length||0,maxTokens:options.maxTokens});
    async function* observed(){
      let iterator,exhausted=false,abort;
      const cancelled=new Promise((_,reject)=>{abort=()=>reject(options.signal.reason);options.signal.addEventListener('abort',abort,{once:true});if(options.signal.aborted)abort();});
      try{
        iterator=observation.run(()=>next()[Symbol.asyncIterator]());
        while(true){const r=await Promise.race([observation.run(()=>iterator.next()),cancelled]);if(r.done){exhausted=true;return;}yield r.value;}
      }finally{
        options.signal.removeEventListener('abort',abort);
        if(!exhausted&&iterator?.return){const close=observation.run(()=>iterator.return());if(options.signal.aborted)Promise.resolve(close).catch(()=>{});else await close;}
      }
    }
    let outcome='incomplete';
    try{for await(const originalChunk of observed()){
      const chunk=originalChunk;
      if(chunk.type==='finish')outcome=options.signal.aborted?'cancelled':chunk.reason?.failure?'failed':'completed';
      if(chunk.type==='finish'&&chunk.reason?.failure){outcome='failed';onModel({event:'model.error',requestId,purpose,model:options.model,durationMs:Date.now()-started,diagnosticText:chunk.reason.failure.message,category:chunk.reason.failure.code});}
      if(firstOutputMs===undefined&&isTokenDelta(chunk))firstOutputMs=Date.now()-started;
      if(chunk.type==='usage')usage=chunk.usage;yield chunk;
    }}catch(error){outcome=options.signal.aborted?'cancelled':'failed';onModel({event:'model.error',requestId,purpose,model:options.model,durationMs:Date.now()-started,errorCauses:modelTransportTrace.causes(error),diagnosticText:error.message,category:error.code || error.name});throw error;}finally{onModel({event:'model.response',requestId,purpose,model:options.model,outcome:options.signal.aborted?'cancelled':outcome,...observation.finish(),durationMs:Date.now()-started,firstOutputMs,
      ...(usage?{promptTokens:usage.inputTokens,uncachedInputTokens:usage.inputTokens,cacheReadTokens:usage.cacheReadTokens??0,cacheWriteTokens:usage.cacheWriteTokens??0,totalInputTokens:usage.inputTokens+(usage.cacheReadTokens??0)+(usage.cacheWriteTokens??0),completionTokens:usage.outputTokens}:{} )});}
  });
  if(persistenceDirectory)checkpointPolicy(ctx);
  ctx.systemPrompt.section({name:'solopi',order:0,text:system,interpolate:false});
  ctx.systemPrompt.section({name:'loaded-skill-instructions',order:20,interpolate:false,
    text:context=>context.scope?.session?skillInstructions.retainedInstructions(context.scope.session):''});
  // Desktop/MCP contracts are JSON Schema, while the native helper validates
  // its smaller authoring DSL. Keep the declared contract intact (oneOf/not,
  // required-only branches, refs) at the bridge, without mutating arguments.
  tools=[...tools,{name:'read_loaded_skill',description:'Read exact archived Skill text for a missing decision: query locates a needed section, offset paginates. Do not restart completed reads or restore an entire reference unnecessarily.',readOnly:true,schema:{type:'object',properties:{eventSeq:{type:'integer',minimum:0},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:12000},query:{type:'string',minLength:1,maxLength:200}},required:['eventSeq'],additionalProperties:false},execute:args=>skillInstructions.readLoadedSkill(handle.agent.session,args)}];
  const ajv=new Ajv({allErrors:true,strict:false,validateFormats:false});
  const checks=new Map(tools.map(tool=>[tool.name,ajv.compile(tool.schema)]));
  const readOnlyTools=new Set(tools.filter(tool=>tool.readOnly===true).map(tool=>tool.name));
  const argumentErrors=(name,args)=>{
    const check=checks.get(name);
    if(check){if(check(args))return [];return (check.errors||[]).map(e=>`${e.instancePath||'arguments'} ${e.message}`);}
    const definition=ctx.tools.get(name);return definition?validateJsonSchemaValue(definition.parameters,args):[];
  };
  for(const tool of tools)ctx.tools.register({name:tool.name,description:tool.description||tool.name,parameters:tool.schema,
    output:{schema:{},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
    // Writes are exclusive by default in upstream. Read-only tools explicitly opt in.
    isConcurrencySafe:()=>tool.readOnly===true,
    execute:async(args,exec)=>{
      const errors=argumentErrors(tool.name,args);
      if(errors.length)throw Error(errors.join('; '));
      const result=await tool.execute(args,{signal:exec.signal,operationId:exec.callId});
      if(result?.waiting&&typeof result.waiting.kind==='string'&&typeof result.waiting.id==='string')exec.concludeTurn();
      return result===undefined?null:JSON.parse(JSON.stringify(result));
    }});
  ctx.on('tools/pre-execute',async(exec,next)=>{
    const definition=ctx.tools.get(exec.name);
    const errors=argumentErrors(exec.name,exec.arguments);
    if(errors.length)return {kind:'deny',reason:errors.join('; ')};
    if(beforeTool)await beforeTool(exec);return next();
  });
  // Rejected read-only queries remain visible tool failures for native recovery;
  // they are not unperformed mutations and must not veto native completion.
  // The native stop boundary reports unresolved rejected writes honestly. It
  // never fabricates another user request, replays a sibling, or forces retries.
  const invalidCalls=new Map();let generation=0;
  ctx.on('session/event',(session,event)=>{
    if(event.type==='turn/start'){invalidCalls.clear();generation=0;}
    if(event.type==='assistant/message')generation++;
    if(event.type==='user/message'&&event.data.source?.kind==='user')invalidCalls.clear();
    if(event.type==='tool/call'&&!readOnlyTools.has(event.data.name)){
      const d=event.data,definition=ctx.tools.get(d.name);let invalid=false;
      try{const args=JSON.parse(d.arguments);invalid=!!definition&&argumentErrors(d.name,args).length>0;}catch{invalid=true;}
      const pending=invalidCalls.get(d.name)||[];
      // A valid sibling from this same assistant batch cannot repair another
      // rejected call. Later batches may replace prior failed attempts one by
      // one; a failed retry does not invent an additional intended operation.
      const prior=pending.findIndex(p=>p.generation<generation);
      if(invalid){const rejected={name:d.name,callId:d.callId,generation};if(prior>=0)pending[prior]=rejected;else pending.push(rejected);}
      else if(prior>=0)pending.splice(prior,1);
      if(pending.length)invalidCalls.set(d.name,pending);else invalidCalls.delete(d.name);
    }
    onEvent(event,session);
  });
  ctx.on('agent/turn-stopping',({agent})=>{
    if(invalidCalls.size){onIncomplete([...invalidCalls.values()].flat().map(({generation,...failure})=>failure));agent.cancel({kind:'hook',reason:'UNRESOLVED_TOOL_ARGUMENTS'});}
  });
  ctx.on('agent/assistant-stream',frame=>onStream(frame));
  ctx.on('agent/error',payload=>onError(payload.error));
  const agentOptions={provider:'configured',model:provider.model||(adapter?'fixture':undefined),...(provider.maxOutputTokens?{maxTokens:provider.maxOutputTokens}:{})};
  const exists=persistenceDirectory && await ctx.sessionPersistence.stat(id);
  const handle=exists?await ctx.agents.resume({resumeSessionId:id,agentOptions}):await ctx.agents.create({sessionId:id,seed,agentOptions,...(cwd?{meta:{cwd}}:{})});
  return {ctx,agent:handle.agent,input:async(text,attachments=[])=>{
      const content=[{type:'text',text}];
      for(const a of attachments)if(a.mime?.startsWith('image/'))content.push({type:'image',attachment:await ctx.attachments.saveImage({data:fs.readFileSync(a.path),mediaType:a.mime,name:a.name})});
      return createUserMessage({content,source:{kind:'user',...(attachments.length?{desktopAttachments:attachments}:{})}});
    },send:(text,source='user',target='next-turn')=>handle.agent.send(userInput(text,source),target,true),
    idle:()=>handle.agent.whenIdle(),cancel:()=>handle.agent.cancel({kind:'user'}),dispose:()=>handle.dispose()};
}
