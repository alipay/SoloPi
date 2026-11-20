// Deterministic historical error replay. Both engines receive the same responses,
// schemas and isolated tool implementations. No network, devices or real commands.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {AgentRuntime}=require('../electron/agent/runtime');
const {HarnessRuntime}=require('../electron/agent/harness-runtime');
const {AgentStore}=require('../electron/agent/store');
const out=path.resolve(process.argv[2]||'.private-local/harness-history-regression-20261023');fs.mkdirSync(out,{recursive:true,mode:0o700});
const call=(name,args,id=name)=>({id,type:'function',function:{name,arguments:typeof args==='string'?args:JSON.stringify(args)}});
const reply=(...calls)=>({role:'assistant',tool_calls:calls});
const text=content=>({role:'assistant',content});
const schema={type:'object',properties:{value:{type:'integer'}},required:['value'],additionalProperties:false};
const cases=[];
function add(name,source,responses,expected,extra={}){cases.push({name,source,responses,expected,...extra});}
const source='tests/agent-tool-validation.test.mjs';
for(const [name,bad] of Object.entries({unclosed:'{"value":',wrongType:{value:'one'},missing:{},extra:{value:1,unexpected:true},null:'null',array:'[]',empty:'',trailing:'{"value":1}garbage'}))add('arguments-'+name,source,[reply(call('fixture',bad,'bad'),call('sibling',{value:7},'good')),reply(call('fixture',{value:2},'fixed')),text('verified')],[['sibling',7],['fixture',2]]);
add('two-invalid-tools-repaired',source,[reply(call('fixture','{','bad1'),call('sibling','{','bad2')),reply(call('fixture',{value:1},'fixed1'),call('sibling',{value:2},'fixed2')),text('verified')],[['fixture',1],['sibling',2]]);
add('plan-only-after-bad-arguments',source,[reply(call('fixture','{','bad'),call('sibling',{value:7},'good')),text('现在我来核实失败信息中的actual值'),reply(call('fixture',{value:2},'fixed')),text('verified')],[['sibling',7],['fixture',2]],{expectedFinding:'Official completion safety requires an explicit incomplete status when arguments remain invalid; no forced prose-repair loop. This is not a claim that the task was completed.'});
add('unknown-tool-recovery','tests/agent-runtime.test.mjs',[reply(call('not_installed',{})),reply(call('fixture',{value:1})),text('verified')],[['fixture',1]]);
for(const [name,result] of Object.entries({explicitFailure:{success:false,error:'fixture failure'},errorOnly:{error:'fixture failure'},businessError:{success:true,error:'business assertion failed',caseStatus:'failed'},waiting:{success:true,waiting:{taskId:'existing',reviewCases:false}},large:{success:true,data:'x'.repeat(100000)}}))add('result-'+name,'tests/agent-runtime.test.mjs',[reply(call('fixture',{value:1})),text('verified')],[['fixture',1]],{result});
add('thrown-tool-error','tests/agent-runtime.test.mjs',[reply(call('fixture',{value:1})),reply(call('sibling',{value:2})),text('verified')],[['fixture',1],['sibling',2]],{throwTool:true});
add('read-existing-success-no-replay','tests/agent-continuation-memory.test.mjs',[reply(call('fixture',{value:1})),text('verified')],[['fixture',1]],{seed:s=>s.calls.push({id:'prior',modelCallId:'prior',name:'historic_write',status:'done',result:{success:true,receipt:'existing'}})});
add('unknown-write-no-replay','tests/agent-runtime.test.mjs',[reply(call('fixture',{value:1})),text('verified')],[['fixture',1]],{seed:s=>s.calls.push({id:'prior',modelCallId:'prior',name:'historic_write',status:'interrupted',result:{success:false,error:'outcome unknown'}})});
add('stale-unrelated-skill','tests/agent-skill-scope.test.mjs',[reply(call('fixture',{value:1})),text('verified')],[['fixture',1]],{seed:s=>s.skillUpdates={old:{name:'unrelated',success:false}}});
add('stale-unfinished-work-state','tests/agent-progress-policy.test.mjs',[reply(call('fixture',{value:1})),text('verified')],[['fixture',1]],{seed:s=>s.workState={objective:'old',phase:'unfinished',completed:[],sourceCallIds:[],sourceUserIndices:[],nextAction:'resume'}});
add('ordinary-text-no-tools','tests/agent-tool-validation.test.mjs',[text('verified')],[]);
add('beyond-twenty-rounds','tests/agent-runtime.test.mjs',[...Array.from({length:26},(_,i)=>reply(call('fixture',{value:i},'round-'+i))),text('verified')],Array.from({length:26},(_,i)=>['fixture',i]));
add('case-ordinal-17-versus-30','tests/agent-report-identity.test.mjs',[reply(call('fixture',{value:17})),text('verified')],[['fixture',17]],{result:{success:true,cases:[{caseOrdinal:17,caseId:'id17',status:'failed',startedAt:'2026-10-22T16:41:29.989Z',type:'OrderPreview'},{caseOrdinal:30,caseId:'id30',status:'success'}]}});
(async()=>{
 const rows=[];
 for(const c of cases)for(const engine of ['legacy','official']){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'harness-history-')),store=new AgentStore(()=>dir),s=store.create();s.approvalMode='auto';c.seed?.(s);store.save(s);
  let request=0;const executions=[];const responses=structuredClone(c.responses);
  const tools=['fixture','sibling'].map(name=>({name,description:'Isolated historical regression fixture',schema,execute:async a=>{executions.push([name,a.value]);if(c.throwTool&&name==='fixture')throw Error('isolated tool exception');return structuredClone(c.result||{success:true,receipt:'verified'});}}));
  const Runtime=engine==='legacy'?AgentRuntime:HarnessRuntime;
  const runtime=new Runtime({store,provider:async()=>({model:'fixture',maxOutputTokens:16384,contextWindowTokens:262144}),tools:async()=>tools,model:async()=>{request++;if(!responses.length)throw Error('fixture response sequence exhausted');return responses.shift();}});
  const begin=Date.now();let error,timedOut=false;const timer=setTimeout(()=>{timedOut=true;runtime.stop(s.id);},15000);
  try{await runtime.start(s.id,'Read the isolated evidence and report the verified result. Do not repeat completed operations.',{});if(engine==='official')await runtime.hosts.get(s.id).idle();else while(runtime.active.has(s.id))await new Promise(r=>setTimeout(r,5));}catch(e){error=e.message;}
  clearTimeout(timer);await new Promise(r=>setImmediate(r));const result=runtime.liveSessions.get(s.id)||store.get(s.id);
  const explicitIncomplete=c.name==='plan-only-after-bad-arguments'&&result.status==='interrupted'&&result.errorDetails?.code==='UNRESOLVED_TOOL_ARGUMENTS'&&JSON.stringify(executions)===JSON.stringify([['sibling',7]])&&request===2;
  const row={scenario:c.name,source:c.source,engine,outcome:result.status==='interrupted'?'explicitly-incomplete':result.status,pass:(!timedOut&&explicitIncomplete)||!!(!timedOut&&(c.result?.waiting?result.status==='waiting':result.status==='idle')&&JSON.stringify(executions)===JSON.stringify(c.expected)&&(c.name!=='result-errorOnly'||result.calls.some(c=>c.name==='fixture'&&c.status==='failed'))&&(c.result?.waiting||result.messages.findLast(m=>m.role==='assistant')?.content==='verified')),durationMs:Date.now()-begin,status:result.status,requests:request,executions,expected:c.expected,failedCalls:result.calls.filter(c=>c.status==='failed').map(c=>({name:c.name,result:c.result})),error:error||result.error||null,...(c.expectedFinding?{note:c.expectedFinding}:{} )};
  rows.push(row);console.log(JSON.stringify({...row,failedCalls:row.failedCalls.length}));
  fs.writeFileSync(path.join(out,'paired-history.json'),JSON.stringify({kind:'scripted-model-error-replay',realModel:false,externalWrites:0,realDeviceCalls:0,scenarios:cases.length,rows},null,2),{mode:0o600});
  await runtime.stopAll();fs.rmSync(dir,{recursive:true,force:true});
 }
 process.exitCode=rows.some(r=>r.engine==='official'&&!r.pass)?1:0;
 console.log(JSON.stringify({summary:['legacy','official'].map(engine=>({engine,pass:rows.filter(r=>r.engine===engine&&r.pass).length,total:cases.length}))}));
})().catch(e=>{console.error(e);process.exitCode=1;});
