import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {nodeFixtureSpawn} from './fixtures/node-broker.mjs';
import {platformToolRequestForCli,platformToolWithBrokerForCli} from '../scripts/glassbox-cli.mjs';
const require=createRequire(import.meta.url);
const {createTools}=require('../electron/agent/tools');
const {createPlatformToolApi,isPlatformTool}=require('../electron/platform-tool-api');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'platform-parity-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const log=path.join(dir,'case.log');fs.writeFileSync(log,'first\nactual case result\n');
 const report={id:'t',status:'failed',cases:[{caseId:'a',name:'a',status:'success',results:[]},{caseId:'b',name:'b',status:'failed',startedAt:'2026-01-01T00:00:00Z',artifacts:{logs:[{path:log,deviceType:'glasses'}]},caseSnapshot:{id:'b',steps:[{id:'s',type:'start',config:{sampleLog:'editor sample'}}]},results:[{stepId:'s',status:'failed',error:'real failure'}]}]};
 const state={cases:[{id:'a',name:'a',steps:[{id:'s',type:'start',device:'pc'},{id:'e',type:'end',device:'pc'}]}],components:[],automationTasks:[report]};
 const calls=[],saved=[];
 const factory=createTools({readState:()=>state,commandDirectory:()=>dir,config:()=>({mcpServers:[{id:'external',enabled:true}]}),skillsRoots:()=>[],mcp:{connect:async()=>{throw Error('CLI must not connect MCP');}},
  saveCase:async p=>{saved.push(p);return {success:true,uiUpdated:true};},
  invoke:async(ch,_e,args)=>{calls.push({ch,args});if(ch==='workflow-report:load-task')return {success:true,task:report};if(ch==='workflow:validate-task-selection')return {success:true};if(ch==='workflow-task:submit')return {success:true,submitted:true,taskId:args.taskId,caseCount:args.caseIds.length,task:{...args,taskType:'standard',status:'pending'}};if(ch==='workflow-task:stop')return {success:true,taskId:args.taskId};return {success:true,tasks:[report]};}});
 const tools=(e,s)=>factory(e,s,{platformOnly:true});
 const api=createPlatformToolApi({tools,directory:()=>dir});
 const call=(name,args,id=randomUUID())=>api({action:'call',name,arguments:args,requestId:id},{},new AbortController().signal);
 return {dir,report,state,calls,saved,factory,api,call,tools};
}
test('CLI platform catalog and schemas come directly from native registry; host and MCP remain local',async t=>{
 const f=fixture(t);const native=await f.factory({},undefined,{platformOnly:true});
 const list=await f.api({action:'list'},{});assert.deepEqual(list.tools.map(t=>t.name),native.filter(t=>isPlatformTool(t.name)).map(t=>t.name));
 for(const name of ['read_case_results','read_task_report','query_case_steps','validate_case_coverage','export_cases','save_cases_from_file','submit_task','stop_task','export_case_evidence'])assert.ok(list.tools.some(t=>t.name===name),name);
 for(const name of ['run_command','watch_operation','save_extensions','read_skill'])assert.equal(list.tools.some(t=>t.name===name),false);
 const describe=await f.api({action:'describe',name:'read_case_results'},{});assert.deepEqual(describe.tool.parameters,native.find(t=>t.name==='read_case_results').schema);
 assert.equal((await f.call('run_command',{command:'bad',arguments:[]})).errorCode,'PLATFORM_TOOL_NOT_FOUND');
});
test('all report views, original ordinal identity and batch step projections match native output',async t=>{
 const f=fixture(t),native=await f.tools({});
 for(const view of ['summary','details','timeline','configuration','artifacts']){
  const args={taskId:'t',caseOrdinal:2,view};
  const expected=await native.find(t=>t.name==='read_case_results').execute(args,{}),actual=await f.call('read_case_results',args);
  delete actual.requestId;assert.deepEqual(actual,expected);assert.equal(actual.identity.caseId,'b');assert.equal(actual.identity.logs[0].path,path.join(f.dir,'case.log'));
 }
 for(const view of ['cases','summary','details','steps']){
  const args={taskId:'t',caseIds:['b'],view};const expected=await native.find(t=>t.name==='read_task_report').execute(args,{}),actual=await f.call('read_task_report',args);delete actual.requestId;delete actual.executionReceipt.observedAt;delete expected.executionReceipt.observedAt;assert.deepEqual(actual,expected);
 }
 const mismatch=await f.call('read_case_results',{taskId:'t',caseOrdinal:1,caseId:'b'});assert.equal(mismatch.success,false);assert.match(mismatch.error,/不同用例/);
});
test('CLI and native tools share compact LLM details and the exact full-evidence escape hatch',async t=>{
 const f=fixture(t),c=f.report.cases[1];
 c.results=[{stepId:'assert',status:'failed',stdout:'duplicate'.repeat(10000),
  meta:{llmRequestPayload:{variables:{previous:'irrelevant'}},llmAssertion:{pass:false,reason:'actual mismatch'},
   timeoutBudgets:{logTimeoutMs:20000},currentNodeLogExtraction:{json:{type:'Actual'}}}}];
 const tools=await f.tools({}),native=tools.find(t=>t.name==='read_case_results');
 for(const detailMode of ['compact','full']){
  const args={taskId:'t',caseOrdinal:2,stepId:'assert',view:'details',detailMode};
  const expected=await native.execute(args,{}),actual=await f.call('read_case_results',args);delete actual.requestId;
  assert.deepEqual(actual,expected);
  if(detailMode==='full')assert.equal(actual.results[0].stdout,c.results[0].stdout);
  else{assert.equal(actual.results[0].stdout,undefined);assert.equal(actual.results[0].meta.llmAssertion.pass,false);assert.equal(actual.results[0].detailProjection.fullDetails.arguments.detailMode,'full');}
 }
});
test('schema validation rejects malformed selectors before any query, side effect or receipt write',async t=>{
 const f=fixture(t);for(const args of [{taskId:'t'},{taskId:'t',caseOrdinal:0},{taskId:'t',caseOrdinal:2,unexpected:1}])assert.equal((await f.call('read_case_results',args)).errorCode,'PLATFORM_TOOL_ARGUMENTS_INVALID');
 assert.equal(f.calls.length,0);assert.equal(fs.existsSync(path.join(f.dir,'cli-tool-receipts')),false);
});
test('submission and stop use same handlers and durable UUID receipts survive reconnect without duplicate dispatch',async t=>{
 const f=fixture(t),id=randomUUID(),args={caseIds:['a']};
 const first=await f.call('submit_task',args,id);assert.equal(first.taskId,'agent-'+id);assert.equal(first.submitted,true);
 const next=createPlatformToolApi({tools:f.tools,directory:()=>f.dir});
 const reused=await next({action:'call',name:'submit_task',arguments:args,requestId:id},{});assert.equal(reused.reused,true);assert.equal(reused.submitted,false);
 assert.equal(f.calls.filter(c=>c.ch==='workflow-task:submit').length,1);
 assert.equal((await f.call('submit_task',{caseIds:['b']},id)).errorCode,'PLATFORM_TOOL_REQUEST_ID_CONFLICT');
 const receipt=await next({action:'result',requestId:id},{});assert.equal(receipt.status,'done');assert.equal(receipt.result.taskId,first.taskId);
 const stop=await f.call('stop_task',{taskId:first.taskId});assert.equal(stop.success,true);assert.equal(f.calls.at(-1).ch,'workflow-task:stop');
});
test('unfinished dispatch stays unknown across restart and never repeats a write',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'platform-unknown-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let count=0;const tools=async()=>[{name:'save_case',schema:{type:'object'},confirm:true,execute:async()=>{count++;throw Error('connection lost after write');}}];
 const request={action:'call',name:'save_case',arguments:{},requestId:randomUUID()};
 const api=createPlatformToolApi({tools,directory:()=>dir});assert.equal((await api(request,{})).success,false);
 const restarted=createPlatformToolApi({tools,directory:()=>dir});assert.equal((await restarted(request,{})).errorCode,'OPERATION_OUTCOME_UNKNOWN');assert.equal(count,1);
});
test('coverage validation and bounded batch edit preserve same rules via CLI adapter',async t=>{
 const f=fixture(t);const coverage=await f.call('validate_case_coverage',{taskId:'t',statuses:['failed'],rows:[]});assert.equal(coverage.coverageComplete,false);
 const exported=await f.call('export_cases',{caseIds:['a'],allowedPaths:['/name']});t.after(()=>fs.rmSync(path.dirname(exported.filePath),{recursive:true,force:true}));
 const batch=JSON.parse(fs.readFileSync(exported.filePath));batch.updates[0].document.name='updated';fs.writeFileSync(exported.filePath,JSON.stringify(batch));
 const saved=await f.call('save_cases_from_file',{filePath:exported.filePath});assert.equal(saved.success,true,JSON.stringify(saved));assert.deepEqual(saved.saved,['a']);assert.equal(saved.changedFields,undefined);assert.equal(saved.changedFieldsSummary.caseCount,1);const full=JSON.parse(fs.readFileSync(saved.fullResultPath,'utf8'));assert.deepEqual(full.changedFields.a,['/name']);assert.equal(full.success,true);assert.equal(f.saved.length,2);assert.equal(f.saved[0].dryRun,true);
 batch.updates[0].document.steps[0].name='out of scope';fs.writeFileSync(exported.filePath,JSON.stringify(batch));
 const refused=await f.call('save_cases_from_file',{filePath:exported.filePath});assert.equal(refused.success,false);assert.equal(f.saved.length,2);
});
test('CLI transport preserves JSON bytes, reads ACK once, and provides a durable requestId on timeout',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'platform-cli-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const broker=path.join(dir,'broker.cjs');fs.writeFileSync(broker,`const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--glassbox-cli-control-payload')+1]));fs.writeFileSync(p.ackPath,JSON.stringify({success:true,requestId:p.request.requestId,echo:p.request}));`);
 const deps={dataDir:dir,spawn:nodeFixtureSpawn(t),launch:{command:process.execPath,argsPrefix:[broker],packaged:true,cwd:dir}};
 const args={taskId:'literal $() ; `a`',caseOrdinal:2};const r=await platformToolWithBrokerForCli(['tools','call','read_case_results','--args',JSON.stringify(args)],deps);assert.deepEqual(r.echo.arguments,args);assert.ok(r.requestId);
 assert.deepEqual(fs.readdirSync(path.join(dir,'cli-control')),[]);
 assert.throws(()=>platformToolRequestForCli(['tools','call','read_case_results','--args','[]']),/JSON 对象/);
 assert.throws(()=>platformToolRequestForCli(['tools','call','read_case_results','--file','a','--args','{}']),/不能同时/);
 const quiet=path.join(dir,'quiet.cjs');fs.writeFileSync(quiet,'setInterval(()=>{},1000);');const timeout=await platformToolWithBrokerForCli(['tools','call','stop_task','--args','{"taskId":"t"}'],{...deps,timeoutMs:5,launch:{...deps.launch,argsPrefix:[quiet]}});assert.equal(timeout.errorCode,'PLATFORM_TOOL_ACK_TIMEOUT');assert.ok(timeout.requestId);assert.equal(fs.existsSync(timeout.ackPath.replace('ack.json','payload.json')),true);
});

test('unsupported older Broker fails explicitly without replay or fallback writes',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'platform-old-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const broker=path.join(dir,'old.cjs');fs.writeFileSync(broker,`const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--glassbox-cli-control-payload')+1]));fs.writeFileSync(p.ackPath,JSON.stringify({success:false,errorCode:'BROKER_CONTROL_ACTION_UNSUPPORTED'}));`);
 const result=await platformToolWithBrokerForCli(['tools','call','submit_task','--args','{"caseIds":["a"]}'],{dataDir:dir,spawn:nodeFixtureSpawn(t),launch:{command:process.execPath,argsPrefix:[broker],packaged:true,cwd:dir}});
 assert.equal(result.errorCode,'BROKER_CONTROL_ACTION_UNSUPPORTED');assert.match(result.error,/更新 App/);assert.ok(result.requestId);
});

test('concurrent identical calls execute once and cancellation before dispatch has no side effects',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'platform-concurrent-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let calls=0,finish;
 const tools=async()=>[{name:'save_case',schema:{type:'object'},confirm:true,execute:async()=>{calls++;await new Promise(r=>{finish=r;});return{success:true};}}];
 const api=createPlatformToolApi({tools,directory:()=>dir}),request={action:'call',name:'save_case',arguments:{},requestId:randomUUID()};
 const first=api(request,{});while(!finish)await new Promise(r=>setTimeout(r,1));
 assert.equal((await api(request,{})).errorCode,'OPERATION_OUTCOME_UNKNOWN');finish();assert.equal((await first).success,true);assert.equal(calls,1);
 const controller=new AbortController();controller.abort();await assert.rejects(api({...request,requestId:randomUUID()},{},controller.signal));assert.equal(calls,1);
});

test('array/scalar results retain their shape and error-only responses remain failures',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'platform-shapes-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const tools=async()=>[
  {name:'list_components',schema:{type:'object'},execute:async()=>[{id:'one'},{id:'two'}]},
  {name:'read_environment',schema:{type:'object'},execute:async()=>({error:'fixture unavailable'})},
  {name:'read_configuration',schema:{type:'object'},execute:async()=>({success:true,requestId:'native-request',error:'business evidence'})},
 ];
 const api=createPlatformToolApi({tools,directory:()=>dir});
 const id=randomUUID(),request={action:'call',name:'list_components',arguments:{},requestId:id};
 const array=await api(request,{});assert.deepEqual(array.result,[{id:'one'},{id:'two'}]);assert.equal(array['0'],undefined);
 assert.deepEqual((await api(request,{})).result,array.result);
 assert.equal((await api({...request,name:'read_environment',requestId:randomUUID()},{})).success,false);
 const native=await api({...request,name:'read_configuration',requestId:randomUUID()},{});assert.equal(native.success,true);assert.equal(native.toolRequestId,'native-request');
});

test('CLI and native configuration hide examples by default and retain explicit full access',async t=>{
 const f=fixture(t),native=(await f.tools({})).find(t=>t.name==='read_case_results');
 for(const detailMode of ['compact','full']){
  const args={taskId:'t',caseOrdinal:2,view:'configuration',detailMode};
  const expected=await native.execute(args,{}),actual=await f.call('read_case_results',args);
  delete actual.requestId;assert.deepEqual(actual,expected);
  assert.equal(actual.configuration.steps[0].config.sampleLog,detailMode==='full'?'editor sample':undefined);
 }
});

test('save receipt summary preserves full paths, partial failures and explicit storage failure fallback',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'save-summary-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const {saveReceipt}=require('../electron/agent/context-receipts');
 const changedFields=Object.fromEntries(Array.from({length:50},(_,i)=>['c'+i,Array.from({length:100},(_,j)=>'/steps/'+j+'/config/value')]));
 const original={success:true,dryRun:true,count:50,saved:[],remaining:[],changedFields};
 const compact=saveReceipt(original,{directory:dir});assert.ok(JSON.stringify(compact).length<3000);assert.equal(compact.changedFields,undefined);assert.equal(compact.changedFieldsSummary.caseCount,50);assert.equal(compact.changedFieldsSummary.pathCount,5000);assert.deepEqual(JSON.parse(fs.readFileSync(compact.fullResultPath)),original);
 const partial={success:false,phase:'save',caseId:'c2',error:'KEY_SAVE_FAILURE',saved:['c0','c1'],remaining:['c2','c3'],changedFields};const receipt=saveReceipt(partial,{directory:dir});assert.equal(receipt.success,false);assert.equal(receipt.error,'KEY_SAVE_FAILURE');assert.deepEqual(receipt.saved,partial.saved);assert.deepEqual(receipt.remaining,partial.remaining);assert.deepEqual(JSON.parse(fs.readFileSync(receipt.fullResultPath)),partial);
 const notDirectory=path.join(dir,'file');fs.writeFileSync(notDirectory,'fixture');const fallback=saveReceipt(original,{directory:notDirectory});assert.equal(fallback.success,true);assert.deepEqual(fallback.changedFields,original.changedFields);assert.ok(fallback.receiptStorageError.code);
});


test('structured failure metadata cannot overwhelm the upstream clipped preview',()=>{
 const {pruningNotice}=require('../electron/agent/context-receipts');const long='z'.repeat(10000);
 const value={success:false,stderr:long,error:{code:'INNER_FAILURE',message:'IMPORTANT_ERROR '+long},message:long,result:{error:long,message:long},failures:[{error:long},{error:long}]};
 const notice=pruningNotice([{type:'text',text:JSON.stringify(value)}]);assert.ok(notice.length<2450);assert.match(notice,/read_operation_receipt/);assert.match(notice,/success/);assert.match(notice,/INNER_FAILURE/);assert.match(notice,/IMPORTANT_ERROR/);
});
test('runtime configuration is one native tool for CLI and remote callers, using the Desktop settings handler',async t=>{
 const f=fixture(t);const catalog=await f.api({action:'list'},{});assert.ok(catalog.tools.some(x=>x.name==='agent_runtime_config'));
 for(const args of [{action:'get'},{action:'discover'},{action:'models',runtimeId:'codex'},{action:'save',selection:{mode:'local-runtime',runtimeId:'codex',model:'fixture-model'}}]){
  const tools=await f.tools({});await tools.find(x=>x.name==='agent_runtime_config').execute(args,{});await f.call('agent_runtime_config',args);const calls=f.calls.slice(-2);assert.ok(calls.every(x=>x.ch==='agent:runtime-config'));assert.deepEqual(calls[0].args,calls[1].args);
 }
 const before=f.calls.length;assert.equal((await f.call('agent_runtime_config',{action:'shell',command:'bad'})).errorCode,'PLATFORM_TOOL_ARGUMENTS_INVALID');assert.equal(f.calls.length,before);
});

test('Server host command transport reaches native executor once and retains unknown outcomes',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'server-host-command-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let count=0;
 const factory=createTools({readState:()=>({}),config:()=>({}),skillsRoots:()=>[],executeCommand:async args=>{count++;return{exitCode:0,stdout:args.arguments.join('|'),stderr:''};}});
 const api=createPlatformToolApi({tools:(e,s)=>factory(e,s,{platformOnly:true}),directory:()=>dir});
 const request={action:'call',name:'execute_host_command',arguments:{command:'/usr/bin/python3',arguments:['-c','print("no shell")']},requestId:randomUUID()};
 const first=await api(request,{});assert.equal(first.exitCode,0);assert.equal(count,1);assert.equal((await api(request,{})).reused,true);assert.equal(count,1);
 assert.equal((await api({...request,arguments:{...request.arguments,command:'changed'}},{})).errorCode,'PLATFORM_TOOL_REQUEST_ID_CONFLICT');assert.equal(count,1);
});
test('component discovery returns the same complete native definitions through CLI platform API',async t=>{
 const f=fixture(t);f.state.components=[{id:'fixture-assert',name:'fixture',kind:'tts_assert',params:[{key:'extractRegex',required:true}],commandTemplate:'unchanged'}];const native=(await f.tools({})).find(t=>t.name==='list_components');const actual=await f.call('list_components',{});assert.deepEqual(actual.result,await native.execute({},{}));assert.equal(f.calls.length,0);
});
