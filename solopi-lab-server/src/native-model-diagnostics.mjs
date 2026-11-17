import {randomUUID,createHash} from 'node:crypto';

// Metadata only. An iterator opening is not an HTTP header or first token.
export function nativeModelJournal(options,{record,now=()=>performance.now()}={}){
 const start=now(),elapsed=()=>Math.max(0,now()-start);
 const base={source:'server-superagent',requestId:randomUUID(),
  conversationId:options.diagnosticContext?.conversationId,scopeKey:options.diagnosticContext?.scopeKey,
  purpose:options.purpose||'conversation',model:options.provider?.model};
 const milestones={},counts={outputCharacters:0,reasoningCharacters:0,argumentCharacters:0};
 let finished=false,usage,resultMetadata;
 const streamedText=createHash('sha256');
 const log=(event,fields={})=>{try{record?.({...base,event,...fields});}catch{/* Diagnostics never change model execution. */}};
 const mark=(field,event)=>{if(milestones[field]===undefined){milestones[field]=elapsed();log(event,{...milestones,...counts});}};
 const messages=options.messages||[],tools=options.tools||[];
 const chars=value=>typeof value==='string'?value.length:JSON.stringify(value??'').length;
 log('model.native-start',{messageCount:messages.length,toolCount:tools.length,
  systemCharacters:messages.filter(m=>m.role==='system').reduce((n,m)=>n+chars(m.content),0),
  historyCharacters:messages.filter(m=>m.role!=='system').reduce((n,m)=>n+chars(m.content),0),
  toolSchemaCharacters:JSON.stringify(tools).length,maxTokens:options.maxTokens??options.provider?.maxOutputTokens,
  thinking:options.provider?.thinking,reasoningEffort:options.provider?.reasoningEffort,
  inputBudgetTokens:options.provider?.requestPolicy?.inputBudgetTokens,
  requestTokensEstimate:options.diagnosticInputTokensEstimate});
 const timer=setInterval(()=>log('model.native-waiting',{durationMs:elapsed(),...milestones,...counts}),30000);
 timer.unref?.();
 return {
  opened(){mark('setupMs','model.native-opened');},
  chunk(chunk){
   mark('firstEventMs','model.native-first-event');
   const text=typeof chunk.text==='string'?chunk.text:'';
   if(chunk.type==='reasoning-delta'&&text){counts.reasoningCharacters+=text.length;mark('firstReasoningMs','model.native-first-reasoning');mark('firstOutputMs','model.native-first-output');}
   if(chunk.type==='text-delta'&&text){streamedText.update(text,'utf16le');counts.outputCharacters+=text.length;mark('firstTextMs','model.native-first-text');mark('firstOutputMs','model.native-first-output');}
   if(chunk.type==='tool-call-delta'&&typeof chunk.argumentsDelta==='string'&&chunk.argumentsDelta){counts.argumentCharacters+=chunk.argumentsDelta.length;mark('firstToolMs','model.native-first-tool');mark('firstOutputMs','model.native-first-output');}
  },
  usage(value){usage=value;},
  result(value){
   // Protocol facts only: a model stop is not a claim of task completion.
   // Hash UTF-16 code units so split surrogate pairs match the final string.
   const text=typeof value?.content==='string'?value.content:'';
   const outputDigest=createHash('sha256').update(text,'utf16le').digest('hex');
   resultMetadata={finishReason:value?.finish_reason,toolCallCount:value?.tool_calls?.length||0,
    assembledOutputCharacters:text.length,outputDigest,
    assembledTextMatchesStream:streamedText.copy().digest('hex')===outputDigest};
  },
  finish(outcome,code){
   if(finished)return;finished=true;clearInterval(timer);
   const tokens={};
   for(const [from,to]of [['inputTokens','promptTokens'],['outputTokens','completionTokens'],['reasoningTokens','reasoningTokens']])if(Number.isFinite(usage?.[from])&&usage[from]>=0)tokens[to]=usage[from];
   log('model.native-end',{outcome,code,durationMs:elapsed(),...milestones,...counts,...tokens,...resultMetadata,
    ...(milestones.firstOutputMs===undefined?{}:{generationMs:Math.max(0,elapsed()-milestones.firstOutputMs)})});
  }
 };
}
