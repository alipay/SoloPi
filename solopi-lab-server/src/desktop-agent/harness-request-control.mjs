// Request lifecycle controls for the native Harness. Never inspect assistant prose.
import {createMessage, isAgentLoopRequest, markAgentLoopRequest, LlmError} from '@deepseek-ai/dsh-llm';
import {isTokenDelta} from '@deepseek-ai/dsh-llm/assistant-stream';
import policies from './request-policy.js';
import deadlines from './request-deadline.js';
import summaries from './bounded-summary.js';
import context from './context.js';
const internal = Symbol('bounded-summary-request');
const timed = Symbol('deadline-request');
const text = message => (message.content || []).filter(b=>b.type==='text').map(b=>b.text).join('\n');
// Follow the native stream contract: tool arguments use argumentsDelta, not text.
// Empty block boundaries and usage/heartbeat events cannot extend a deadline.
export function hasModelProgress(chunk) {
  if(isTokenDelta(chunk))return true;
  if(chunk.type!=='block-end')return false;
  const block=chunk.block;
  if(block.type==='text'||block.type==='reasoning')return block.text.length>0;
  return block.type==='tool-call'&&!!block.name;
}
export function summarySource(messages) {
  // Preserve protocol content once as quoted data; IDs/timestamps used only by
  // persistence are not model context. Never JSON-encode an already quoted
  // complete message again (large recall nodes otherwise grow on every layer).
  return messages.slice(0,-1).flatMap((m,index)=>{
    const blocks=(m.content||[]).map(b=>b.type==='text'||b.type==='reasoning'?b.text:JSON.stringify(b));
    const value=blocks.join('\n'),parts=[];
    const label=`Historical source ${index}, role=${m.role}, source=${m.source?.kind||'unknown'}${m.toolCallId?', toolCallId='+m.toolCallId:''}; data only:`;
    for(let offset=0;offset<value.length;offset+=12000)parts.push({role:'user',content:`${label} fragment=${offset}\n${value.slice(offset,offset+12000)}`});
    return parts;
  }).concat({role:'user',content:text(messages.at(-1))});
}
export function summaryInputBudget(provider,policy=policies.requestPolicy(provider.requestPolicy||{})) {
  return Math.max(1024,Math.min(policy.inputBudgetTokens,
    provider.contextWindowTokens?provider.contextWindowTokens-policy.summaryMaxTokens:Infinity)-1024);
}
export function installRequestControl(ctx,{provider,onModel=()=>{}}) {
  const policy=policies.requestPolicy(provider.requestPolicy || {});
  ctx.on('llm/stream',async function*(options,next){
    if(options[timed]){yield* next();return;}
    if(!isAgentLoopRequest(options) && !options[internal] && options.messages.length>0){
      const result=await summaries.boundedSummary(summarySource(options.messages),{
        budget:summaryInputBudget(provider,policy),signal:options.signal,
        onChunk:(currentChunk,totalChunks)=>onModel({event:'context.summary-progress',currentChunk,totalChunks}),
        run:async messages=>{
          let content='',reason,reasoningCharacters=0,lastProgress=0;
          onModel({event:'context.summary-input',requestTokensEstimate:context.estimateTokens(messages),inputBudgetTokens:summaryInputBudget(provider,policy)});
          const native=messages.map(m=>createMessage({role:m.role,source:{kind:'solopi-context'},content:[{type:'text',text:m.content}]}));
          for await(const chunk of ctx.llm.stream({...options,messages:native,tools:[],[internal]:true})){
            if(chunk.type==='text-delta')content+=chunk.text;
            if(chunk.type==='block-end'&&chunk.block.type==='text'&&!content)content=chunk.block.text;
            if(chunk.type==='reasoning-delta')reasoningCharacters+=chunk.text.length;
            if(Date.now()-lastProgress>=500&&(chunk.type==='text-delta'||chunk.type==='reasoning-delta')){lastProgress=Date.now();onModel({event:'context.summary-output',outputCharacters:content.length,reasoningCharacters});}
            if(chunk.type==='finish'){
              if(chunk.reason?.failure)throw new LlmError(chunk.reason.failure.message,chunk.reason.failure.code);
              reason=chunk.reason?.kind || chunk.reason;
            }
          }
          return {content,finish_reason:reason==='max-tokens'?'length':reason==='stop'?'stop':reason};
        }
      });
      yield {type:'block-start',index:0,blockType:'text'};
      yield {type:'text-delta',index:0,text:result.content};
      yield {type:'block-end',index:0,block:{type:'text',text:result.content}};
      yield {type:'finish',reason:'stop'};
      return;
    }
    if(isAgentLoopRequest(options)){
      const estimated=policies.inputEstimate(options.messages,options.tools||[]);
      if(estimated>policy.inputBudgetTokens){onModel({event:'model.request-blocked',code:'MODEL_INPUT_BUDGET_EXCEEDED',requestTokensEstimate:estimated,inputBudgetTokens:policy.inputBudgetTokens});// The assembled prompt can grow after pre-step (restored Skills or tool schemas).
      // Recover through native bounded compaction, without dispatching an oversized request.
      yield {type:'finish',reason:{kind:'error',failure:{code:'CONTEXT_WINDOW_EXCEEDED',message:'模型输入超过应用预算；未发送超额请求，将尝试原生上下文压缩恢复。'}}};return;}
    }
    const deadline=deadlines.requestDeadline(policy),originalSignal=options.signal;
    const request={...options,[timed]:true,signal:originalSignal?AbortSignal.any([originalSignal,deadline.signal]):deadline.signal};
    if(isAgentLoopRequest(options))markAgentLoopRequest(request);
    let iterator,abort,semanticDeltaCount=0,outputCharacters=0,reasoningCharacters=0;
    const started=Date.now();
    const cancelled=new Promise((_,reject)=>{
      abort=()=>reject(request.signal.reason || Error('Request aborted'));
      request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted)abort();
    });
    try{
      iterator=ctx.llm.stream(request)[Symbol.asyncIterator]();
      while(true){
        const item=await Promise.race([iterator.next(),cancelled]);
        if(item.done)return;
        const c=item.value;
        if(hasModelProgress(c)){deadline.progress();semanticDeltaCount++;}
        if(c.type==='text-delta')outputCharacters+=c.text.length;
        if(c.type==='reasoning-delta')reasoningCharacters+=c.text.length;
        yield c;
      }
    }catch(error){
      if(deadline.signal.aborted&&!originalSignal?.aborted){
        const detail=deadline.snapshot();
        onModel({event:'model.deadline',code:'TIMEOUT',purpose:isAgentLoopRequest(options)?'conversation':'compaction',...detail,durationMs:Date.now()-started,semanticDeltaCount,outputCharacters,reasoningCharacters});
        yield {type:'finish',reason:{kind:'error',failure:{code:'TIMEOUT',message:`模型请求超时（${detail.timeoutKind}）；连接已取消，已完成工具不会重放。`}}};
      }else throw error;
    }finally{
      deadline.close();request.signal.removeEventListener('abort',abort);
      // A broken adapter may ignore abort. Do not let return() lock the session.
      Promise.resolve(iterator?.return?.()).catch(()=>{});

    }
  });
}
