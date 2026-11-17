import test from 'node:test';
import assert from 'node:assert/strict';
import {createHarnessHost} from '../electron/agent/harness-host.mjs';
import recovery from '../electron/agent/harness-request-recovery.js';
import {summarySource,summaryInputBudget,hasModelProgress,installRequestControl} from '../electron/agent/harness-request-control.mjs';
import {LlmAdapter,createUserMessage,resolveRetryPolicy} from '@deepseek-ai/dsh-llm';
test('native progress counts tool arguments but ignores empty boundaries and bookkeeping',()=>{
 for(const c of [{type:'usage',usage:{}},{type:'block-start',index:0,blockType:'tool-call'},
  {type:'text-delta',text:''},{type:'reasoning-delta',text:''},
  {type:'tool-call-delta',id:'a',argumentsDelta:''},
  {type:'block-end',block:{type:'text',text:''}}])assert.equal(hasModelProgress(c),false,JSON.stringify(c));
 for(const c of [{type:'tool-call-delta',id:'a',argumentsDelta:'{"value":'},
  {type:'tool-call-delta',id:'a',name:'read',argumentsDelta:''},
  {type:'reasoning-delta',text:'working'},{type:'text-delta',text:'answer'},
  {type:'block-end',block:{type:'text',text:'nonstreamed answer'}},
  {type:'block-end',block:{type:'tool-call',name:'read',arguments:'{}'}}])assert.equal(hasModelProgress(c),true);
});
test('empty streamed blocks cannot renew first-output deadline; diagnostics contain no content',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});
 let hook;const records=[];
 const ctx={on:(_name,fn)=>hook=fn,llm:{stream:async function*(){yield{type:'block-end',index:0,block:{type:'text',text:''}};await new Promise(()=>{});}}};
 installRequestControl(ctx,{provider:{requestPolicy:{firstResponseSeconds:5,idleSeconds:5,totalSeconds:10}},onModel:r=>records.push(r)});
 const stream=hook({messages:[],signal:new AbortController().signal},()=>assert.fail('recursive stream owns request'));
 assert.equal((await stream.next()).value.type,'block-end');
 const waiting=stream.next();t.mock.timers.tick(5000);
 const failure=(await waiting).value;assert.equal(failure.reason.failure.code,'TIMEOUT');
 assert.equal(records[0].timeoutKind,'first-response');assert.equal(records[0].semanticDeltaCount,0);
 assert.equal(records[0].durationMs,5000);assert.equal(records[0].outputCharacters,0);
 assert.equal((await stream.next()).done,true);
});
test('native timeout recovery continues after committed tool without replaying it', {timeout:12000},async t=>{
 const keepAlive=setInterval(()=>{},100);t.after(()=>clearInterval(keepAlive));
 let requests=0,writes=0,error;const records=[];
 class Recover extends LlmAdapter{
  providerRetryPolicy(){return resolveRetryPolicy({mode:'normal',maxRetries:1,backoff:{initialDelayMs:1,maxDelayMs:1,jitterRatio:0}},'fixture');}
  async *stream(options){
   requests++;
   if(requests===2){await new Promise(()=>{});return;}
   const block=requests===1?{type:'tool-call',id:'committed',name:'write_once',arguments:'{}'}:{type:'text',text:'completed after recovery'};
   yield{type:'block-start',index:0,blockType:block.type};yield{type:'block-end',index:0,block};
   yield{type:'finish',reason:requests===1?'tool-calls':'stop'};
  }
 }
 const h=await createHarnessHost({id:'recover-after-write',provider:{model:'fixture',requestPolicy:{firstResponseSeconds:5,idleSeconds:5,totalSeconds:10}},system:'test',adapter:new Recover(),tools:[{name:'write_once',schema:{type:'object',properties:{}},execute:()=>{writes++;return{success:true,receipt:'already committed'};}}],onError:e=>error=e,onModel:r=>records.push(r)});t.after(()=>h.dispose());
 h.send('execute once');await h.idle();
 assert.equal(writes,1);assert.equal(requests,3);assert.equal(error,undefined);
 assert.equal(records.filter(r=>r.event==='model.deadline').length,1);
 assert.equal(h.agent.session.deriveMessages().at(-1).content[0].text,'completed after recovery');
});
test('native tool argument fragments keep an active generation alive beyond the idle window',{timeout:12000},async t=>{
 const keepAlive=setInterval(()=>{},100);t.after(()=>clearInterval(keepAlive));
 let requests=0,result,error;
 class Streaming extends LlmAdapter{
  async *stream(){
   if(++requests>1){yield{type:'block-end',index:0,block:{type:'text',text:'done'}};yield{type:'finish',reason:'stop'};return;}
   yield{type:'block-start',index:0,blockType:'tool-call'};
   yield{type:'tool-call-delta',index:0,id:'streamed',name:'save_value',argumentsDelta:'{"value":'};
   for(const fragment of ['"valid"','}']){await new Promise(r=>setTimeout(r,2000));yield{type:'tool-call-delta',index:0,id:'streamed',argumentsDelta:fragment};}
   await new Promise(r=>setTimeout(r,2000));
   yield{type:'block-end',index:0,block:{type:'tool-call',id:'streamed',name:'save_value',arguments:'{"value":"valid"}'}};
   yield{type:'finish',reason:'tool-calls'};
  }
 }
 const h=await createHarnessHost({id:'stream-arguments',provider:{model:'fixture',requestPolicy:{firstResponseSeconds:5,idleSeconds:5,totalSeconds:10}},system:'test',adapter:new Streaming(),tools:[{name:'save_value',schema:{type:'object',properties:{value:{type:'string'}},required:['value']},execute:a=>{result=a;return{success:true};}}],onError:e=>error=e});t.after(()=>h.dispose());
 h.send('save');await h.idle();assert.equal(error,undefined);assert.deepEqual(result,{value:'valid'});assert.equal(requests,2);
});
test('large legacy recall fragments preserve every source character and latest summary instruction',()=>{
 const value='授权不可重放🙂'.repeat(30000),m=createUserMessage({content:[{type:'text',text:value}]}),instruction=createUserMessage({content:[{type:'text',text:'summarize safely'}]});
 const source=summarySource([m,instruction]);
 assert.ok(source.length>2);assert.equal(source.at(-1).content,'summarize safely');
 assert.equal(source.slice(0,-1).map(m=>m.content.slice(m.content.indexOf('\n')+1)).join(''),value);
});
test('native stalled provider is aborted and session settles even if adapter ignores cancellation',async t=>{
 const keepAlive=setInterval(()=>{},100);t.after(()=>clearInterval(keepAlive));
 let signal,error;const records=[];
 class Hung extends LlmAdapter{providerRetryPolicy(){return resolveRetryPolicy(recovery.retryPolicy,'fixture');}async *stream(o){signal=o.signal;await new Promise(()=>{});}}
 const h=await createHarnessHost({id:'hung-native',provider:{model:'fixture',requestPolicy:{firstResponseSeconds:5,idleSeconds:5,totalSeconds:10}},system:'test',adapter:new Hung(),onError:e=>error=e,onModel:r=>records.push(r)});t.after(()=>h.dispose());
 h.send('read status');await h.idle();
 assert.equal(signal.aborted,true);assert.equal(error.code,'TIMEOUT');
 assert.equal(records.find(r=>r.event==='model.deadline').timeoutKind,'first-response');
 assert.equal(records.filter(r=>r.event==='model.deadline').length,2);
 assert.equal(records.filter(r=>r.event==='model.start').length,2);
 assert.ok(records.some(r=>r.event==='model.response'));
});
test('explicit stop cancels native wait without reporting a deadline',async t=>{
 let entered;const ready=new Promise(r=>entered=r),records=[];
 class Hung extends LlmAdapter{async *stream(){entered();await new Promise(()=>{});}}
 const h=await createHarnessHost({id:'stop-native',provider:{model:'fixture'},system:'test',adapter:new Hung(),onModel:r=>records.push(r)});t.after(()=>h.dispose());
 h.send('read');await ready;h.cancel();await h.idle();
 assert.ok(!records.some(r=>r.event==='model.deadline'));
});

test('summary budget follows configured request limit instead of hardcoded 48k',()=>{
 assert.equal(summaryInputBudget({requestPolicy:{inputBudgetTokens:65536}}),64512);
 assert.equal(summaryInputBudget({contextWindowTokens:32768,requestPolicy:{inputBudgetTokens:65536,summaryMaxTokens:8192}}),23552);
});
test('quoted source preserves tool IDs, arguments and results without serializing message metadata',()=>{
 const rows=summarySource([{id:'persistence-only',role:'assistant',content:[{type:'tool-call',id:'call-1',name:'read',arguments:'{"path":"x"}'}]},{role:'tool',toolCallId:'call-1',content:[{type:'text',text:'failed: no file'}]},{role:'user',content:[{type:'text',text:'summarize'}]}]);
 assert.match(rows[0].content,/call-1/);assert.doesNotMatch(rows[0].content,/persistence-only/);
 assert.match(rows[1].content,/toolCallId=call-1/);assert.match(rows[1].content,/failed: no file/);
});
