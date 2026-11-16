import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {pruneVirtualObservations,supersededVirtualReferences}=require('../electron/agent/virtual-observation-context');

test('older virtual observations become references without changing original messages or receipts',()=>{
  const session={id:'s',messages:[
    {role:'user',content:'test'},
    {role:'assistant',tool_calls:[{id:'a',function:{name:'virtual_start'}}]},
    {role:'tool',tool_call_id:'a',content:JSON.stringify({success:true,observationId:'old',nodes:[{text:'old page'}]})},
    {role:'assistant',tool_calls:[{id:'b',function:{name:'virtual_act'}}]},
    {role:'tool',tool_call_id:'b',content:JSON.stringify({success:true,observationId:'middle',receipt:{stepId:'step',status:'succeeded'}})},
    {role:'assistant',tool_calls:[{id:'c',function:{name:'virtual_observe'}}]},
    {role:'tool',tool_call_id:'c',content:JSON.stringify({success:true,observationId:'current',nodes:[{text:'current page'}]})},
  ]};
  const original=JSON.stringify(session.messages),saved=[];
  const store={saveEvidence:(_session,_id,value,source)=>{saved.push({value,source});return `evidence-${saved.length}`;}};
  assert.equal(pruneVirtualObservations(session,store),true);
  assert.equal(JSON.stringify(session.messages),original);
  assert.equal(saved.length,2);
  assert.equal(JSON.parse(session.contextPruned[2]).supersededObservation,true);
  assert.deepEqual(JSON.parse(session.contextPruned[4]).receipt,{stepId:'step',status:'succeeded'});
  assert.equal(session.contextPruned[6],undefined);
  assert.equal(pruneVirtualObservations(session,store),false);
  assert.equal(saved.length,2);
});

test('failed calls and another user turn are not projected as old observations',()=>{
  const session={id:'s',messages:[{role:'user',content:'old task'},
    {role:'assistant',tool_calls:[{id:'old',function:{name:'virtual_start'}}]},
    {role:'tool',tool_call_id:'old',content:'{"success":true,"observationId":"old"}'},
    {role:'user',content:'new task'},
    {role:'assistant',tool_calls:[{id:'failed',function:{name:'virtual_act'}}]},
    {role:'tool',tool_call_id:'failed',content:'{"success":false,"error":"unknown"}'},
    {role:'assistant',tool_calls:[{id:'new',function:{name:'virtual_observe'}}]},
    {role:'tool',tool_call_id:'new',content:'{"success":true,"observationId":"new"}'}]};
  assert.equal(pruneVirtualObservations(session,{saveEvidence:()=>{throw Error('must not save');}}),false);
  assert.equal(session.contextPruned,undefined);
});

test('actual compaction keeps superseded references within one batch and preserves the latest observation',async()=>{
  const calls=['virtual_start','virtual_act','virtual_observe'].map((name,index)=>
    ({id:`call-${index}`,type:'function',function:{name,arguments:'{}'}}));
  const session={id:'virtual-batch',screenMode:'virtual',messages:[
    {role:'user',content:'inspect page'}, {role:'assistant',tool_calls:calls},
    {role:'tool',tool_call_id:'call-0',content:JSON.stringify({success:true,observationId:'old',ocr:[{text:'old '.repeat(1200)}]})},
    {role:'tool',tool_call_id:'call-1',content:JSON.stringify({success:true,observationId:'middle',receipt:{stepId:'step-1',status:'succeeded'},ocr:[{text:'middle '.repeat(900)}]})},
    {role:'tool',tool_call_id:'call-2',content:JSON.stringify({success:true,observationId:'current',ocr:[{text:'current '.repeat(800)}]})},
  ]};
  const original=JSON.stringify(session.messages),saved=[];
  const store={saveEvidence:(_session,_id,value)=>{saved.push(value);return `evidence-${saved.length}`;}};
  assert.equal(pruneVirtualObservations(session,store),true);
  // A generic or forged projection for the latest observation must be removed.
  session.contextPruned[4]=JSON.stringify({supersededObservation:true,observationId:'current',evidenceId:'wrong'});
  assert.deepEqual([...supersededVirtualReferences(session)],[2,3]);
  const {prepareModelMessages}=require('../electron/agent/context');
  const result=await prepareModelMessages(session,'system',{
    provider:{model:'test',contextWindowTokens:100000,maxOutputTokens:1024,requestPolicy:{inputBudgetTokens:65536}},
    store,tools:[],model:async()=>{throw Error('unexpected compaction model call');},save:()=>{},emit:()=>{},
  });
  assert.equal(JSON.stringify(session.messages),original);
  assert.equal(session.contextPruned[4],undefined);
  const results=result.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content));
  assert.equal(results[0].supersededObservation,true);
  assert.deepEqual(results[1].receipt,{stepId:'step-1',status:'succeeded'});
  assert.equal(results[2].observationId,'current');
  assert.equal(results[2].ocr[0].text,'current '.repeat(800));
});

test('providers requiring current-turn reasoning replay retain original tool results',async()=>{
  const calls=['virtual_start','virtual_observe'].map((name,index)=>
    ({id:`replay-${index}`,type:'function',function:{name,arguments:'{}'}}));
  const session={id:'replay-batch',screenMode:'virtual',messages:[
    {role:'user',content:'inspect'}, {role:'assistant',tool_calls:calls},
    {role:'tool',tool_call_id:'replay-0',content:JSON.stringify({success:true,observationId:'old',text:'first original'})},
    {role:'tool',tool_call_id:'replay-1',content:JSON.stringify({success:true,observationId:'current',text:'second original'})},
  ]};
  const store={saveEvidence:()=> 'evidence'};
  assert.equal(pruneVirtualObservations(session,store),true);
  const {prepareModelMessages}=require('../electron/agent/context');
  const result=await prepareModelMessages(session,'system',{
    provider:{model:'test',contextWindowTokens:100000,maxOutputTokens:1024,reasoningReplay:'current_turn',requestPolicy:{inputBudgetTokens:65536}},
    store,tools:[],model:async()=>{throw Error('unexpected compaction model call');},save:()=>{},emit:()=>{},
  });
  const results=result.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content));
  assert.equal(results[0].text,'first original');
  assert.equal(results[1].text,'second original');
});
