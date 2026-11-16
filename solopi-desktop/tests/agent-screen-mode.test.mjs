import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { requestPolicy } = require('../electron/agent/request-policy');
const { AgentRuntime } = require('../electron/agent/runtime');
const { AgentStore } = require('../electron/agent/store');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('existing settings default to the main screen', () => {
  assert.equal(requestPolicy({ stream: false }).screenMode, 'main');
});

test('virtual tasks use a focused safety prompt and main tasks retain the existing prompt', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-virtual-prompt-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const systems={};
  for(const mode of ['virtual','main']) {
    const store=new AgentStore(()=>path.join(dir,mode)), session=store.create();
    const runtime=new AgentRuntime({store,getScreenMode:()=>mode,tools:async()=>[],provider:()=>({}),
      model:async({messages})=>{systems[mode]=messages[0].content;return {role:'assistant',content:'已说明'};},
      finishScreen:async()=>({success:true,cleanupConfirmed:true})});
    await runtime.start(session.id,'查看状态');
    for(let i=0;i<1000 && runtime.active.has(session.id);i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(runtime.active.has(session.id),false);
  }
  assert.match(systems.virtual,/最新 observationId/);
  assert.match(systems.virtual,/不重发结果未知的动作|不要重发结果未知的动作/);
  assert.match(systems.virtual,/固定验收由系统独立执行/);
  assert.doesNotMatch(systems.virtual,/list_cases|submit_task/);
  assert.match(systems.main,/list_cases/);
});

test('incremental updates retain virtual status, cleanup and independent report', () => {
  const {createSessionUpdates}=require('../electron/agent/session-updates');
  const updates=createSessionUpdates();
  const session={id:'chat',title:'demo',status:'running',messages:[],calls:[],screenMode:'virtual',screenCleanup:{confirmed:false}};
  let patch=updates.next(session);
  assert.equal(patch.metadata.screenMode,'virtual');
  assert.deepEqual(patch.metadata.screenCleanup,{confirmed:false});
  session.status='idle';session.screenCleanup={confirmed:true};
  session.screenReport={status:'passed',reportPath:'/private/report.html',checkpoints:[]};
  patch=updates.next(session);
  assert.equal(patch.metadata.screenMode,'virtual');
  assert.deepEqual(patch.metadata.screenCleanup,{confirmed:true});
  assert.deepEqual(patch.metadata.screenReport,session.screenReport);
  delete session.screenReport;delete session.screenCleanup;session.screenMode='main';
  patch=updates.next(session);
  assert.equal(patch.metadata.screenMode,'main');
  assert.equal('screenReport' in patch.metadata,false);
  assert.equal('screenCleanup' in patch.metadata,false);
});

test('a task freezes its screen mode while the global setting changes', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solopi-screen-mode-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new AgentStore(() => dir), s = store.create();
  let currentMode = 'virtual', release, observedMode, cleaned = 0;
  const checks = [{selectorKey:'resourceId',selectorValue:'order-status',operator:'equals',expected:'已支付'}];
  const entered = new Promise(resolve => { release = resolve; });
  const runtime = new AgentRuntime({ store, getScreenMode: () => currentMode, getVirtualChecks: () => checks,
    tools: async (_event, _signal, session) => { observedMode = session.screenMode; return []; },
    provider: () => ({}), model: async () => { await entered; return { role: 'assistant', content: '完成' }; },
    finishScreen: async () => { cleaned++; return { success: true, cleanupConfirmed: true }; },
  });
  await runtime.start(s.id, '测试后台屏幕', {});
  assert.equal(store.get(s.id).screenCleanup.confirmed, false);
  checks[0].expected = '已取消';
  currentMode = 'main'; release();
  const deadline = Date.now() + 5000;
  while (runtime.active.has(s.id) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  const saved = store.get(s.id);
  assert.equal(observedMode, 'virtual');
  assert.equal(saved.screenMode, 'virtual');
  assert.equal(saved.screenChecks[0].expected, '已支付');
  assert.equal(saved.screenCleanup.confirmed, true);
  assert.equal(cleaned, 1);
  runtime.stopAll();
});

test('virtual device is frozen from the header, and non-Android or missing selections never dispatch', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-screen-device-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new AgentStore(()=>dir), session=store.create();
  let header={serial:'first-device',runtime:'android'};
  const calls=[];
  const control={async request(op,config){calls.push({op,config});return {success:false,error:'fixture',cleanupConfirmed:true};}};
  const manager=require('../electron/agent/virtual-tools').createVirtualTools({control,
    controlConfig:()=>({packageName:'com.alipay.hulu',port:23342}),preview:()=>{}});
  const runtime=new AgentRuntime({store,tools:async()=>[],provider:()=>({}),getScreenMode:()=> 'virtual',getVirtualDevice:()=>header});
  runtime.freezeScreenMode(session);
  header.serial='second-device';
  await manager.tools(session).find(tool=>tool.name==='virtual_start').execute({packageName:'com.example.app'});
  assert.equal(calls[0].config.deviceId,'first-device');
  for (const selection of [{serial:'ios-device',runtime:'ios'}, {serial:'',runtime:'android'}, null]) {
    header=selection;
    const next=store.create(); runtime.freezeScreenMode(next);
    await assert.rejects(manager.tools(next).find(tool=>tool.name==='virtual_start').execute({packageName:'com.example.app'}), /Android 手机/);
  }
  assert.equal(calls.length,1);
});

test('a message arriving during cleanup starts a new task with the current screen mode', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-screen-pending-mode-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new AgentStore(()=>dir),s=store.create(),seen=[];let mode='virtual',cleanups=0;
  const runtime=new AgentRuntime({store,getScreenMode:()=>mode,provider:()=>({}),
    tools:async(_c,_signal,session)=>{seen.push({mode:session.screenMode,cleanup:session.screenCleanup});return [];},
    model:async()=>({role:'assistant',content:'完成'}),
    finishScreen:async session=>{cleanups++;session.pendingMessages=[runtime.userMessage('第二项任务')];mode='main';
      return {success:true,cleanupConfirmed:true};}});
  await runtime.start(s.id,'第一项任务',{});
  for(let i=0;i<1000&&(runtime.active.has(s.id)||seen.length<2);i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.deepEqual(seen.map(x=>x.mode),['virtual','main']);assert.equal(seen[1].cleanup,undefined);assert.equal(cleanups,1);
  const saved=store.get(s.id);assert.equal(saved.screenMode,'main');assert.equal(saved.pendingMessages.length,0);
});

test('pending messages wait until failed recovery-record deletion is retried', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-screen-pending-record-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new AgentStore(()=>dir),s=store.create(),screenStates=[];let requests=0,cleanups=0;
  const runtime=new AgentRuntime({store,getScreenMode:()=> 'virtual',getVirtualDevice:()=>({serial:'device',runtime:'android'}),provider:()=>({}),
    tools:async(_c,_signal,session)=>{screenStates.push({...session.screenCleanup});return [];},
    clearScreenRecovery:()=>true,model:async()=>{requests++;return {role:'assistant',content:'完成'};},
    finishScreen:async session=>{cleanups++;if(cleanups===1){session.pendingMessages=[runtime.userMessage('第二项任务')];
      return {success:true,cleanupConfirmed:true,acknowledge:()=>false};}return {success:true,cleanupConfirmed:true};}});
  await runtime.start(s.id,'第一项任务',{});
  for(let i=0;i<1000&&runtime.active.has(s.id);i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(requests,1);assert.equal(store.get(s.id).pendingMessages.length,1);
  assert.equal(store.get(s.id).screenReport.recoveryRecordRemovalFailed,true);
  runtime.retryScreenRecoveryRecord(s.id);
  for(let i=0;i<1000&&(runtime.active.has(s.id)||requests<2);i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(requests,2);assert.equal(store.get(s.id).pendingMessages.length,0);assert.equal(cleanups,2);
  assert.deepEqual(screenStates,[{confirmed:false,ownerActive:true},{confirmed:false,ownerActive:true}]);
});

test('stopping an approval wait cleans the owned virtual screen', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solopi-screen-stop-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new AgentStore(() => dir), s = store.create();
  s.screenMode = 'virtual'; s.status = 'awaiting_approval'; store.save(s);
  const runtime = new AgentRuntime({ store, tools: async () => [], provider: () => ({}),
    finishScreen: async () => ({ success: true, cleanupConfirmed: true }) });
  await runtime.stop(s.id);
  assert.equal(store.get(s.id).status, 'interrupted');
  assert.equal(store.get(s.id).screenCleanup.confirmed, true);
});

test('virtual mode is explicit and invalid screen modes are rejected', () => {
  assert.equal(requestPolicy({ screenMode: 'virtual' }).screenMode, 'virtual');
  for (const screenMode of ['other', null, 1]) {
    assert.throws(() => requestPolicy({ screenMode }), /屏幕模式/);
  }
  assert.deepEqual(requestPolicy({}).virtualChecks, []);
  assert.throws(() => requestPolicy({virtualChecks:[{selectorKey:'resourceId',selectorValue:'',operator:'equals',expected:'x'}]}), /验收条件/);
  assert.throws(() => requestPolicy({virtualChecks:[{selectorKey:'nodeId',selectorValue:'x',operator:'equals',expected:'x'}]}), /验收条件/);
});

test('cleanup remains blocked until the device confirms release', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solopi-cleanup-retry-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new AgentStore(() => dir), s = store.create();
  s.screenMode = 'virtual'; s.status = 'failed'; s.screenCleanup = { confirmed: false }; store.save(s);
  let confirmed = false;
  const runtime = new AgentRuntime({ store, tools: async () => [], provider: () => ({}),
    finishScreen: async () => ({ success: confirmed, cleanupConfirmed: confirmed }) });
  await assert.rejects(runtime.retryScreenCleanup(s.id), /仍未确认/);
  assert.equal(store.get(s.id).screenCleanup.confirmed, false);
  confirmed = true;
  await runtime.retryScreenCleanup(s.id);
  assert.equal(store.get(s.id).screenCleanup.confirmed, true);
});

test('restart cannot resume an approval whose virtual-screen owner was lost', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solopi-screen-recovery-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new AgentStore(() => dir), s = store.create();
  s.screenMode = 'virtual'; s.status = 'awaiting_approval'; s.screenCleanup = { confirmed: false }; store.save(s);
  store.list(true);
  assert.equal(store.get(s.id).status, 'interrupted');
  assert.equal(store.get(s.id).screenCleanup.confirmed, false);
});

test('restart marks an idle task interrupted if its virtual cleanup owner was lost', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-screen-finalizing-recovery-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new AgentStore(()=>dir),s=store.create();
  s.screenMode='virtual';s.status='idle';s.screenCleanup={confirmed:false,ownerActive:true};store.save(s);
  store.list(true);
  const recovered=store.get(s.id);
  assert.equal(recovered.status,'interrupted');
  assert.deepEqual(recovered.screenCleanup,{confirmed:false});
});

test('retry after restart cannot claim a lost virtual owner was cleaned', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-screen-lost-owner-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new AgentStore(()=>dir),s=store.create();
  s.screenMode='virtual';s.status='running';s.screenCleanup={confirmed:false,ownerActive:true};store.save(s);
  const restarted=new AgentStore(()=>dir);restarted.list(true);
  const {createVirtualTools}=require('../electron/agent/virtual-tools');
  const virtual=createVirtualTools({control:{},readState:()=>({}),controlConfig:()=>({}),preview:()=>{}});
  const runtime=new AgentRuntime({store:restarted,tools:async()=>[],provider:()=>({}),finishScreen:session=>virtual.finish(session)});
  await assert.rejects(runtime.retryScreenCleanup(s.id),/仍未确认/);
  assert.deepEqual(restarted.get(s.id).screenCleanup,{confirmed:false});
});

test('retry after restart records confirmation only from the recovered device owner', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-screen-restored-owner-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const original=new AgentStore(()=>dir),s=original.create();
  s.screenMode='virtual';s.status='running';s.screenCleanup={confirmed:false,ownerActive:true};
  s.screenReport={status:'not_tested',cleanup:'pending',reportPath:'/report.html',checkpoints:[]};original.save(s);
  const restarted=new AgentStore(()=>dir);restarted.list(true);
  let recoveredOwner;
  const control={async recoverVirtual(owner){recoveredOwner=owner;return {success:true,data:{cleanupConfirmed:true,recovered:true}};}};
  const {createVirtualTools}=require('../electron/agent/virtual-tools');
  const virtual=createVirtualTools({control,readState:()=>({}),controlConfig:()=>({}),preview:()=>{}});
  const runtime=new AgentRuntime({store:restarted,tools:async()=>[],provider:()=>({}),finishScreen:session=>virtual.finish(session)});
  await runtime.retryScreenCleanup(s.id);
  assert.equal(recoveredOwner,s.id);assert.equal(restarted.get(s.id).screenCleanup.confirmed,true);
  assert.equal(restarted.get(s.id).screenReport.status,'not_tested');
  assert.equal(restarted.get(s.id).screenReport.recoveryCleanupConfirmed,true);
});

test('a cleanup capability is retained until the confirmation is durably saved', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-cleanup-order-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new AgentStore(()=>dir),s=store.create();s.screenMode='virtual';s.screenCleanup={confirmed:true};
  const runtime=new AgentRuntime({store,tools:async()=>[],provider:()=>({})});let acknowledged=false;
  const cleanup={cleanupConfirmed:true,acknowledge:()=>{assert.equal(store.get(s.id).screenCleanup.confirmed,true);acknowledged=true;return true;}};
  const actualSave=store.save.bind(store);store.save=()=>{throw Error('disk_full');};
  assert.throws(()=>runtime.persistScreenCleanup(s,cleanup),/disk_full/);assert.equal(acknowledged,false);
  store.save=actualSave;runtime.persistScreenCleanup(s,cleanup);assert.equal(acknowledged,true);
});

test('failed capability deletion is reported without revoking confirmed cleanup', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-cleanup-delete-fail-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new AgentStore(()=>dir),s=store.create();s.screenMode='virtual';s.screenCleanup={confirmed:true};
  const runtime=new AgentRuntime({store,tools:async()=>[],provider:()=>({})});
  runtime.persistScreenCleanup(s,{cleanupConfirmed:true,acknowledge:()=>false});
  assert.equal(store.get(s.id).screenCleanup.confirmed,true);
  assert.equal(store.get(s.id).screenReport.recoveryRecordRemovalFailed,true);
  let called=false;s.screenCleanup={confirmed:false};
  runtime.persistScreenCleanup(s,{cleanupConfirmed:false,acknowledge:()=>{called=true;return true;}});
  assert.equal(called,false);
});

test('record deletion retry is limited to a stopped session with confirmed cleanup', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-screen-delete-retry-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new AgentStore(()=>dir),s=store.create();
  s.screenMode='virtual';s.screenCleanup={confirmed:false};s.screenReport={status:'not_tested',reportPath:null,checkpoints:[],recoveryRecordRemovalFailed:true};store.save(s);
  let allowed=false,seen=[];
  const runtime=new AgentRuntime({store,tools:async()=>[],provider:()=>({}),clearScreenRecovery:session=>{seen.push(session.id);return allowed;}});
  assert.throws(()=>runtime.retryScreenRecoveryRecord(s.id),/没有可重试/);assert.deepEqual(seen,[]);
  s.screenCleanup={confirmed:true};store.save(s);runtime.active.set(s.id,{});
  assert.throws(()=>runtime.retryScreenRecoveryRecord(s.id),/仍在运行/);runtime.active.delete(s.id);assert.deepEqual(seen,[]);
  assert.throws(()=>runtime.retryScreenRecoveryRecord(s.id),/仍未删除/);
  assert.equal(store.get(s.id).screenReport.recoveryRecordRemovalFailed,true);
  allowed=true;runtime.retryScreenRecoveryRecord(s.id);
  assert.equal(store.get(s.id).screenCleanup.confirmed,true);
  assert.equal(store.get(s.id).screenReport.recoveryRecordRemovalFailed,undefined);
  assert.deepEqual(seen,[s.id,s.id]);
  assert.throws(()=>runtime.retryScreenRecoveryRecord(s.id),/没有可重试/);
});

test('a new turn cannot hide a still-failed recovery-record deletion', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-screen-delete-gate-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new AgentStore(()=>dir),s=store.create();s.screenMode='virtual';s.screenCleanup={confirmed:true};
  s.screenReport={status:'not_tested',reportPath:null,checkpoints:[],recoveryRecordRemovalFailed:true};store.save(s);
  const runtime=new AgentRuntime({store,tools:async()=>[],provider:()=>({}),clearScreenRecovery:()=>true});
  await assert.rejects(runtime.start(s.id,'下一项任务'),/先在本对话重试删除/);
  assert.equal(store.get(s.id).screenReport.recoveryRecordRemovalFailed,true);
  runtime.retryScreenRecoveryRecord(s.id);
  assert.equal(store.get(s.id).screenReport.recoveryRecordRemovalFailed,undefined);
});

test('queued messages survive record-deletion failure and resume after successful retry', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-screen-queue-delete-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new AgentStore(()=>dir),s=store.create();s.screenMode='virtual';s.screenCleanup={confirmed:true};
  s.screenReport={status:'not_tested',reportPath:null,checkpoints:[],recoveryRecordRemovalFailed:true};store.save(s);
  let requests=0;
  const runtime=new AgentRuntime({store,getScreenMode:()=> 'main',tools:async()=>[],provider:()=>({}),
    clearScreenRecovery:()=>true,model:async()=>{requests++;return {role:'assistant',content:'完成'};}});
  runtime.contexts.set(s.id,{});runtime.enqueue(s.id,'下一项任务');
  assert.equal(store.get(s.id).queuedMessages.length,1);assert.equal(requests,0);
  runtime.retryScreenRecoveryRecord(s.id);
  for(let i=0;i<1000&&(runtime.active.has(s.id)||requests<1);i++)await new Promise(resolve=>setTimeout(resolve,5));
  const saved=store.get(s.id);assert.equal(requests,1);assert.equal(saved.queuedMessages.length,0);assert.equal(saved.screenMode,'main');
});

test('shutdown waits for the running task to release its screen', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solopi-screen-shutdown-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new AgentStore(() => dir), s = store.create();
  let entered, finishCleanup, cleaned = false;
  const started = new Promise(resolve => { entered = resolve; });
  const cleanup = new Promise(resolve => { finishCleanup = resolve; });
  const runtime = new AgentRuntime({ store, getScreenMode: () => 'virtual', tools: async () => [], provider: () => ({}),
    model: async (_request, signal) => { entered(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); throw Error('aborted'); },
    finishScreen: async () => { await cleanup; cleaned = true; return { success: true, cleanupConfirmed: true }; } });
  await runtime.start(s.id, '关闭时回收屏幕', {}); await started;
  let stopped = false; const stopping = runtime.stopAll().then(() => { stopped = true; });
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(stopped, false);
  finishCleanup(); await stopping;
  assert.equal(cleaned, true); assert.equal(store.get(s.id).screenCleanup.confirmed, true);
});

test('a completed virtual Agent turn records the independent report', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-screen-report-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new AgentStore(()=>dir), s=store.create(); s.approvalMode='auto'; store.save(s);
  const {createVirtualTools}=require('../electron/agent/virtual-tools');
  let owner=null, checks, end;
  const control={ownsVirtual:id=>owner===id,async request(op,value,ctx){
    if(op==='virtual_start'){owner=ctx.owner;checks=value.fixedChecks;return {success:true,data:{observationId:'o',displayId:3,nodes:[],ocr:[]}};}
    if(op==='virtual_end'){end=value;owner=null;return {success:true,data:{cleanupConfirmed:true,report:{status:'failed',reportPath:'/report.html',checkpoints:[]}}};}
    return {success:true,data:{}};
  }};
  const manager=createVirtualTools({control,readState:()=>({deviceBindings:{phoneSerials:['device']}}),
    controlConfig:()=>({packageName:'com.alipay.hulu',port:23342}),preview:()=>{}});
  let count=0;
  const runtime=new AgentRuntime({store,getScreenMode:()=> 'virtual',getVirtualDevice:()=>({serial:'device',runtime:'android'}),
    getVirtualChecks:()=>[{selectorKey:'resourceId',selectorValue:'status',operator:'equals',expected:'已支付'}],
    tools:async(_context,_signal,session)=>manager.tools(session),provider:()=>({}),
    model:async()=> ++count===1 ? {role:'assistant',tool_calls:[{id:'start',type:'function',function:{name:'virtual_start',arguments:'{"packageName":"com.example.app"}'}}]} : {role:'assistant',content:'完成观察'},
    finishScreen:session=>manager.finish(session)});
  await runtime.start(s.id,'打开测试应用');
  for(let i=0;i<1000 && runtime.active.has(s.id);i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(runtime.active.has(s.id),false);
  const saved=store.get(s.id);
  assert.equal(checks[0].expected,'已支付');assert.equal(end.completed,true);
  assert.equal(saved.screenReport.status,'failed');assert.equal(saved.screenCleanup.confirmed,true);
});

test('a failed background start ends the turn and persists cleanup before acknowledging it', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-start-fail-stop-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new AgentStore(()=>dir),s=store.create();s.approvalMode='auto';store.save(s);
  const {createVirtualTools}=require('../electron/agent/virtual-tools');
  let modelCalls=0,starts=0,actions=0,acks=0;
  const control={ownsVirtual:()=>false,async request(op){
    if(op==='virtual_start'){starts++;return {success:false,error:'virtual_initial_frame_unavailable',cleanupConfirmed:true,recoveryRecordPendingAck:true};}
    actions++;throw Error('no action should execute');
  },acknowledgeVirtualCleanup(id){
    assert.equal(store.get(id).screenCleanup.confirmed,true);acks++;return true;
  }};
  const manager=createVirtualTools({control,readState:()=>({deviceBindings:{phoneSerials:['device']}}),
    controlConfig:()=>({packageName:'com.alipay.hulu',port:23342}),preview:()=>{}});
  const runtime=new AgentRuntime({store,getScreenMode:()=> 'virtual',getVirtualDevice:()=>({serial:'device',runtime:'android'}),tools:async(_c,_s,session)=>manager.tools(session),provider:()=>({}),
    model:async()=>{modelCalls++;return {role:'assistant',tool_calls:[
      {id:'start',type:'function',function:{name:'virtual_start',arguments:'{"packageName":"com.example.app"}'}},
      {id:'act',type:'function',function:{name:'virtual_act',arguments:'{"observationId":"obs","targetId":"node-1","action":"click"}'}}]};},
    finishScreen:session=>manager.finish(session)});
  await runtime.start(s.id,'打开测试应用');
  for(let i=0;i<1000&&runtime.active.has(s.id);i++)await new Promise(resolve=>setTimeout(resolve,5));
  const saved=store.get(s.id);
  assert.equal(saved.status,'failed');assert.match(saved.error,/后台屏幕启动失败/);
  assert.equal(saved.screenCleanup.confirmed,true);assert.equal(saved.screenReport.status,'not_tested');
  assert.equal(modelCalls,1);assert.equal(starts,1);assert.equal(actions,0);assert.equal(acks,1);
  assert.ok(saved.messages.some(m=>m.role==='tool' && m.tool_call_id==='act' && JSON.parse(m.content).executed===false));
});

test('a failed start with uncertain cleanup remains blocked and never retries an action', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-start-fail-uncertain-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new AgentStore(()=>dir),s=store.create();s.approvalMode='auto';store.save(s);
  const {createVirtualTools}=require('../electron/agent/virtual-tools');let ops=[],modelCalls=0;
  const control={ownsVirtual:()=>true,async request(op){ops.push(op);return op==='virtual_start'
    ? {success:false,error:'outcome_unknown',cleanupPending:true}
    : {success:false,error:'virtual_cleanup_unconfirmed'};}};
  const manager=createVirtualTools({control,readState:()=>({deviceBindings:{phoneSerials:['device']}}),
    controlConfig:()=>({packageName:'com.alipay.hulu',port:23342}),preview:()=>{}});
  const runtime=new AgentRuntime({store,getScreenMode:()=> 'virtual',getVirtualDevice:()=>({serial:'device',runtime:'android'}),tools:async(_c,_s,session)=>manager.tools(session),provider:()=>({}),
    model:async()=>{modelCalls++;return {role:'assistant',tool_calls:[{id:'start',type:'function',function:{name:'virtual_start',arguments:'{"packageName":"com.example.app"}'}}]};},
    finishScreen:session=>manager.finish(session)});
  await runtime.start(s.id,'打开测试应用');
  for(let i=0;i<1000&&runtime.active.has(s.id);i++)await new Promise(resolve=>setTimeout(resolve,5));
  const saved=store.get(s.id);assert.equal(saved.status,'failed');assert.equal(saved.screenCleanup.confirmed,false);
  assert.match(saved.error,/清理未确认/);assert.equal(modelCalls,1);assert.deepEqual(ops,['virtual_start','virtual_end']);
});

test('a failed owner leaves the pending report available without claiming cleanup', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-screen-pending-report-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new AgentStore(()=>dir),s=store.create();s.approvalMode='auto';store.save(s);
  const {createVirtualTools}=require('../electron/agent/virtual-tools');
  let owner=null;
  const control={ownsVirtual:id=>owner===id,async request(op,_value,ctx){
    if(op==='virtual_start'){owner=ctx.owner;return {success:true,data:{observationId:'o',displayId:3,nodes:[],ocr:[],
      pendingReport:{status:'not_tested',cleanup:'pending',checkpoints:[],reportPath:'/private/report.html'}}};}
    if(op==='virtual_end')throw Error('owner process exited');
  }};
  const manager=createVirtualTools({control,readState:()=>({deviceBindings:{phoneSerials:['device']}}),
    controlConfig:()=>({packageName:'com.alipay.hulu',port:23342}),preview:()=>{}});
  let count=0;
  const runtime=new AgentRuntime({store,getScreenMode:()=> 'virtual',getVirtualDevice:()=>({serial:'device',runtime:'android'}),tools:async(_c,_s,session)=>manager.tools(session),provider:()=>({}),
    model:async()=>{if(++count===1)return {role:'assistant',tool_calls:[{id:'start',type:'function',function:{name:'virtual_start',arguments:'{"packageName":"com.example.app"}'}}]};throw Error('stopped');},
    finishScreen:session=>manager.finish(session)});
  await runtime.start(s.id,'打开测试应用');
  for(let i=0;i<1000 && runtime.active.has(s.id);i++)await new Promise(resolve=>setTimeout(resolve,5));
  const saved=store.get(s.id);
  assert.equal(saved.screenReport.reportPath,'/private/report.html');
  assert.equal(saved.screenReport.cleanup,'pending');assert.equal(saved.screenReport.status,'not_tested');
  assert.equal(saved.screenCleanup.confirmed,false);
});

test('virtual task with fixed checks gets one review before ending without an action', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-virtual-review-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new AgentStore(()=>dir), session=store.create(); session.approvalMode='auto'; store.save(session);
  let requests=0, actionCalls=0, feedbackSeen=false, toolNames=[];
  const tools=[
    {name:'virtual_start',schema:{type:'object',properties:{},additionalProperties:false},execute:async()=>({success:true,observationId:'obs'})},
    {name:'virtual_act',schema:{type:'object',properties:{},additionalProperties:false},execute:async()=>{actionCalls++;return {success:true};}},
  ];
  const toolCall=name=>({role:'assistant',tool_calls:[{id:`call-${requests}`,type:'function',function:{name,arguments:'{}'}}]});
  const runtime=new AgentRuntime({store,getScreenMode:()=> 'virtual',getVirtualDevice:()=>({serial:'device',runtime:'android'}),
    getVirtualChecks:()=>[{selectorKey:'resourceId',selectorValue:'status',operator:'equals',expected:'已支付'}],
    tools:async()=>tools,provider:()=>({}),finishScreen:async()=>({success:true,cleanupConfirmed:true}),
    model:async({messages,tools})=>{requests++;toolNames=tools.map(t=>t.function.name);if(requests===1)return toolCall('virtual_start');
      if(requests===2)return {role:'assistant',content:'已启动'};
      if(requests===3){feedbackSeen=messages.some(m=>typeof m.content==='string' && m.content.includes('尚无动作回执'));return toolCall('virtual_act');}
      return {role:'assistant',content:'结束'};}});
  await runtime.start(session.id,'打开测试页并完成固定检查');
  for(let i=0;i<1000 && runtime.active.has(session.id);i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(runtime.active.has(session.id),false); assert.equal(feedbackSeen,true);
  assert.equal(actionCalls,1); assert.equal(requests,4);
  assert.ok(toolNames.includes('virtual_start')); assert.ok(toolNames.includes('read_evidence'));
  assert.ok(!toolNames.includes('finish_work')); assert.ok(!toolNames.includes('discover_tools'));
});

test('a virtual task without fixed checks also reviews premature completion once', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-virtual-read-review-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new AgentStore(()=>dir), session=store.create(); session.approvalMode='auto'; store.save(session);
  let requests=0, feedbackSeen=false;
  const tools=[{name:'virtual_start',schema:{type:'object',properties:{},additionalProperties:false},execute:async()=>({success:true,observationId:'obs'})}];
  const runtime=new AgentRuntime({store,getScreenMode:()=> 'virtual',getVirtualDevice:()=>({serial:'device',runtime:'android'}),getVirtualChecks:()=>[],
    tools:async()=>tools,provider:()=>({}),finishScreen:async()=>({success:true,cleanupConfirmed:true}),
    model:async({messages})=>{requests++;if(requests===1)return {role:'assistant',tool_calls:[{id:'start',type:'function',function:{name:'virtual_start',arguments:'{}'}}]};
      if(requests===3)feedbackSeen=messages.some(m=>typeof m.content==='string' && m.content.includes('尚无动作回执'));
      return {role:'assistant',content:'当前观察不足以完成任务'};}});
  await runtime.start(session.id,'打开应用并查看内容');
  for(let i=0;i<1000 && runtime.active.has(session.id);i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(runtime.active.has(session.id),false);assert.equal(feedbackSeen,true);assert.equal(requests,3);
  assert.equal(store.get(session.id).screenCleanup.confirmed,true);
});

test('virtual review never retries an attempted action with uncertain outcome', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-virtual-no-retry-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new AgentStore(()=>dir),session=store.create();session.approvalMode='auto';store.save(session);
  let requests=0,actionCalls=0;
  const tools=[
    {name:'virtual_start',schema:{type:'object',properties:{},additionalProperties:false},execute:async()=>({success:true,observationId:'obs'})},
    {name:'virtual_act',schema:{type:'object',properties:{},additionalProperties:false},execute:async()=>{actionCalls++;return {success:false,error:'outcome_unknown'};}},
  ];
  const runtime=new AgentRuntime({store,getScreenMode:()=> 'virtual',getVirtualDevice:()=>({serial:'device',runtime:'android'}),
    getVirtualChecks:()=>[{selectorKey:'resourceId',selectorValue:'status',operator:'equals',expected:'已支付'}],
    tools:async()=>tools,provider:()=>({}),finishScreen:async()=>({success:true,cleanupConfirmed:true}),
    model:async()=>{requests++;if(requests<3)return {role:'assistant',tool_calls:[{id:`call-${requests}`,type:'function',function:{name:requests===1?'virtual_start':'virtual_act',arguments:'{}'}}]};return {role:'assistant',content:'结果未知'};}});
  await runtime.start(session.id,'打开测试页并检查');
  for(let i=0;i<1000 && runtime.active.has(session.id);i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(runtime.active.has(session.id),false);assert.equal(actionCalls,1);assert.equal(requests,3);
});
