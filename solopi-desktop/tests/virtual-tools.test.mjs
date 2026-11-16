import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createVirtualTools } = require('../electron/agent/virtual-tools');

test('restart without an owner cannot confirm cleanup; a live task without a screen can', async () => {
  const manager = createVirtualTools({ control: {}, readState: () => ({}), controlConfig: () => ({}), preview: () => {} });
  const lost = { id: 'recovered', screenCleanup: { confirmed: false }, screenChecks: [] };
  assert.deepEqual(await manager.finish(lost),
    { success: false, cleanupConfirmed: false, error: 'virtual_owner_lost_cleanup_unconfirmed' });
  const neverStarted = { id: 'live', screenCleanup: { confirmed: false, ownerActive: true }, screenChecks: [] };
  assert.deepEqual(await manager.finish(neverStarted), { success: true, cleanupConfirmed: true });
});

test('restart uses only the recovered conversation owner and remains unconfirmed until the device replies', async () => {
  let confirmed=false, seen=[];
  const control={async recoverVirtual(owner){seen.push(owner);return confirmed
    ? {success:true,data:{cleanupConfirmed:true,recovered:true}}
    : {success:false,error:'virtual_cleanup_unconfirmed'};}};
  const manager=createVirtualTools({control,readState:()=>({}),controlConfig:()=>({}),preview:()=>{}});
  const session={id:'recovered',screenCleanup:{confirmed:false},screenReport:{status:'not_tested',cleanup:'pending',checkpoints:[],reportPath:'/report.html'}};
  assert.equal((await manager.finish(session)).cleanupConfirmed,false);
  confirmed=true;assert.equal((await manager.finish(session)).cleanupConfirmed,true);
  assert.deepEqual(seen,['recovered','recovered']);
  assert.equal(session.screenReport.cleanup,'pending');assert.equal(session.screenReport.recoveryCleanupConfirmed,true);
});

test('restart can use a persisted failed-start cleanup receipt, but not past a later attempted start', async () => {
  let recoveries=0,acks=0;
  const control={async recoverVirtual(){recoveries++;return {success:false};},acknowledgeVirtualCleanup(){acks++;return true;}};
  const manager=createVirtualTools({control,readState:()=>({}),controlConfig:()=>({}),preview:()=>{}});
  const session={id:'chat',screenDevice:{serial:'device',runtime:'android'},screenCleanup:{confirmed:false},calls:[{name:'virtual_start',status:'failed',result:{success:false,cleanupConfirmed:true}}]};
  const confirmed=await manager.finish(session);
  assert.equal(confirmed.cleanupConfirmed,true);assert.equal(confirmed.acknowledge(),true);assert.equal(acks,1);assert.equal(recoveries,0);
  session.calls.push({name:'virtual_start',status:'running'});
  assert.equal((await manager.finish(session)).cleanupConfirmed,false);assert.equal(recoveries,1);
});

test('recovered cleanup keeps the interrupted report while exposing separate confirmation', async () => {
  let owner;
  const report={status:'not_tested',cleanup:'pending',reportPath:'/private/report.html',checkpoints:[]};
  const control={ownsVirtual:id=>owner===id, async request(op,_value,ctx){
    if(op==='virtual_start'){owner=ctx.owner;return {success:true,data:{observationId:'o',displayId:3,pendingReport:report}};}
    if(op==='virtual_end')return {success:true,data:{cleanupConfirmed:true,recovered:true}};
  }};
  const manager=createVirtualTools({control,readState:()=>({deviceBindings:{phoneSerials:['device']}}),
    controlConfig:()=>({packageName:'com.alipay.hulu',port:23342}),preview:()=>{}});
  const session={id:'chat',screenDevice:{serial:'device',runtime:'android'}};
  await manager.tools(session).find(t=>t.name==='virtual_start').execute({packageName:'com.example.app'});
  await manager.finish(session);
  assert.equal(session.screenReport.cleanup,'pending');
  assert.equal(session.screenReport.status,'not_tested');
  assert.equal(session.screenReport.recoveryCleanupConfirmed,true);
});

test('device cleanup does not conceal a failed encrypted-record deletion', async () => {
  let owner;
  const control={ownsVirtual:id=>owner===id,async request(op,_value,ctx){
    if(op==='virtual_start'){owner=ctx.owner;return {success:true,data:{observationId:'o',displayId:3}};}
    if(op==='virtual_end')return {success:true,data:{cleanupConfirmed:true},recoveryRecordRemoved:false};
  }};
  const manager=createVirtualTools({control,readState:()=>({deviceBindings:{phoneSerials:['device']}}),
    controlConfig:()=>({packageName:'com.alipay.hulu',port:23342}),preview:()=>{}});
  const session={id:'chat',screenDevice:{serial:'device',runtime:'android'}};
  await manager.tools(session).find(t=>t.name==='virtual_start').execute({packageName:'com.example.app'});
  assert.equal((await manager.finish(session)).cleanupConfirmed,true);
  assert.equal(session.screenReport.recoveryRecordRemovalFailed,true);
});

test('virtual tools keep screenshot bytes outside model results and bind owner', async () => {
  const calls = [], previews = [];
  let owner = null;
  const control = {
    ownsVirtual: id => owner === id,
    async request(operation, value, context) {
      calls.push({ operation, value, context });
      if (operation === 'virtual_start') { owner = context.owner; return { success: true, data: {
        observationId: 'obs-1', displayId: 4, nodes: [], ocr: [], screenshotDataUrl: 'data:image/png;base64,SECRETIMAGE',
        pendingReport: { status: 'not_tested', cleanup: 'pending', reportPath: '/private/local/report.html', checkpoints: [] },
      } }; }
      if (operation === 'virtual_end') { owner = null; return { success: true, data: { cleanupConfirmed: true } }; }
      return { success: true, data: {} };
    },
  };
  const manager = createVirtualTools({ control, readState: () => ({ deviceBindings: { phoneSerials: ['device'] } }),
    controlConfig: () => ({ packageName: 'com.alipay.hulu', port: 23342 }), preview: (id, frame) => previews.push({ id, frame }) });
  const session = { id: 'chat-a', screenDevice: { serial:'device', runtime:'android' } }, tools = manager.tools(session);
  const start = await tools.find(x => x.name === 'virtual_start').execute({ packageName: 'com.example.app' });
  assert.equal(start.success, true);
  assert.equal(JSON.stringify(start).includes('SECRETIMAGE'), false);
  assert.equal(JSON.stringify(start).includes('/private/local/report.html'), false);
  assert.equal(session.screenReport.cleanup, 'pending');
  assert.equal(previews[0].frame.image, 'data:image/png;base64,SECRETIMAGE');
  assert.equal(calls[0].context.owner, 'chat-a');
  assert.deepEqual(await manager.finish(session), { success: true, cleanupConfirmed: true });
  assert.equal(calls[1].context.owner, 'chat-a');
});

test('other conversations cannot act on an owned virtual session', async () => {
  const manager = createVirtualTools({ control: {}, readState: () => ({}), controlConfig: () => ({}), preview: () => {} });
  const observe = manager.tools({ id: 'chat-b' }).find(x => x.name === 'virtual_observe');
  await assert.rejects(observe.execute(), /没有副屏会话/);
});

test('OCR runtime availability is sent to the UI without changing the model observation', async () => {
  let owner, status = 'ocr_unavailable', freshness = 'current';
  const frames = [];
  const control = { ownsVirtual: id => owner === id, async request(op, _value, ctx) {
    if (op === 'virtual_end') { owner = null; return { success: true, data: { cleanupConfirmed: true } }; }
    if (op === 'virtual_start') owner = ctx.owner;
    return { success: true, data: { observationId: 'obs', displayId: 4, ocrError: status,
      ocrFreshness: status ? null : freshness, screenshotDataUrl: 'data:image/png;base64,FRAME' } };
  } };
  const manager = createVirtualTools({ control, readState: () => ({ deviceBindings: { phoneSerials: ['device'] } }),
    controlConfig: () => ({ packageName: 'com.alipay.hulu', port: 23342 }), preview: (_id, frame) => frames.push(frame) });
  const session = { id: 'chat-a', screenDevice: { serial:'device', runtime:'android' } }, tools = manager.tools(session);
  const result = await tools.find(t => t.name === 'virtual_start').execute({ packageName: 'com.example.app' });
  assert.equal(result.ocrError, 'ocr_unavailable');
  assert.equal(frames.at(-1).ocrState, 'unavailable');
  status = 'ocr_timeout';
  await tools.find(t => t.name === 'virtual_observe').execute();
  assert.equal(frames.at(-1).ocrState, 'degraded');
  status = null;
  freshness = 'frame_expired';
  await tools.find(t => t.name === 'virtual_observe').execute();
  assert.equal(frames.at(-1).ocrState, 'degraded');
  freshness = 'current';
  await tools.find(t => t.name === 'virtual_observe').execute();
  assert.equal(frames.at(-1).ocrState, 'ready');
  await manager.finish(session);
});

test('only frozen user checks reach the device and cleanup carries the task outcome', async () => {
  const calls=[];let owner=null;
  const control={ownsVirtual:id=>owner===id,async request(operation,value,context){
    calls.push({operation,value,context});
    if(operation==='virtual_start'){owner=context.owner;return {success:true,data:{observationId:'obs',displayId:4,nodes:[],ocr:[]}};}
    if(operation==='virtual_end'){owner=null;return {success:true,data:{cleanupConfirmed:true,report:{status:'passed',reportPath:'/run/report.html'}}};}
    return {success:true,data:{}};
  }};
  const manager=createVirtualTools({control,readState:()=>({deviceBindings:{phoneSerials:['device']}}),
    controlConfig:()=>({packageName:'com.alipay.hulu',port:23342}),preview:()=>{}});
  const session={id:'chat-a',screenDevice:{serial:'device',runtime:'android'},status:'idle',screenChecks:[{selectorKey:'resourceId',selectorValue:'status',operator:'equals',expected:'已支付'}]};
  const tools=manager.tools(session);
  assert.equal(tools.some(tool=>tool.name==='virtual_end'),false);
  await tools.find(tool=>tool.name==='virtual_start').execute({packageName:'com.example.app'});
  assert.equal(calls[0].value.fixedChecks[0].expected,'已支付');
  await manager.finish(session);
  assert.equal(calls[1].value.completed,true);
  assert.equal(session.screenReport.status,'passed');
});

test('protected screens explain whether an action may already have been submitted', async () => {
  let owner;
  const control={ownsVirtual:id=>owner===id, async request(op,_value,ctx){
    if(op==='virtual_start'){owner=ctx.owner;return {success:true,data:{observationId:'o',displayId:3,nodes:[],ocr:[]}};}
    if(op==='virtual_act')return {success:false,error:'virtual_protected_or_blank_after_dispatch'};
    if(op==='virtual_end'){owner=null;return {success:true,data:{cleanupConfirmed:true}};}
  }};
  const manager=createVirtualTools({control,readState:()=>({deviceBindings:{phoneSerials:['device']}}),
    controlConfig:()=>({packageName:'com.alipay.hulu',port:23342}),preview:()=>{}});
  const s={id:'chat-a',screenDevice:{serial:'device',runtime:'android'}},tools=manager.tools(s);
  await tools.find(t=>t.name==='virtual_start').execute({packageName:'com.example.app'});
  const result=await tools.find(t=>t.name==='virtual_act').execute({observationId:'o',targetId:'node-1',action:'click'});
  assert.equal(result.errorCode,'virtual_protected_or_blank_after_dispatch');
  assert.match(result.error,/动作已提交/);assert.match(result.error,/不能重复/);
  await manager.finish(s);
});

test('settle timeout explains an already submitted action must not be repeated', async () => {
  let owner;
  const control={ownsVirtual:id=>owner===id, async request(op,_value,ctx){
    if(op==='virtual_start'){owner=ctx.owner;return {success:true,data:{observationId:'o',displayId:3}};}
    if(op==='virtual_act')return {success:false,error:'virtual_settle_unconfirmed'};
    if(op==='virtual_end'){owner=null;return {success:true,data:{cleanupConfirmed:true}};}
  }};
  const manager=createVirtualTools({control,readState:()=>({deviceBindings:{phoneSerials:['device']}}),
    controlConfig:()=>({packageName:'com.alipay.hulu',port:23342}),preview:()=>{}});
  const s={id:'chat-a',screenDevice:{serial:'device',runtime:'android'}},tools=manager.tools(s);
  await tools.find(t=>t.name==='virtual_start').execute({packageName:'com.example.app'});
  const result=await tools.find(t=>t.name==='virtual_act').execute({observationId:'o',targetId:'node-1',action:'click'});
  assert.match(result.error,/动作已提交/);assert.match(result.error,/不要重复/);
  await manager.finish(s);
});

test('main-display escape is reported without allowing follow-up on the main screen', async () => {
  let owner;
  const control={ownsVirtual:id=>owner===id, async request(op,_value,ctx){
    if(op==='virtual_start'){owner=ctx.owner;return {success:true,data:{observationId:'o',displayId:3}};}
    if(op==='virtual_act')return {success:false,error:'virtual_target_on_main'};
    if(op==='virtual_end'){owner=null;return {success:true,data:{cleanupConfirmed:true}};}
  }};
  const manager=createVirtualTools({control,readState:()=>({deviceBindings:{phoneSerials:['device']}}),
    controlConfig:()=>({packageName:'com.alipay.hulu',port:23342}),preview:()=>{}});
  const s={id:'chat-a',screenDevice:{serial:'device',runtime:'android'}},tools=manager.tools(s);
  await tools.find(t=>t.name==='virtual_start').execute({packageName:'com.example.app'});
  const result=await tools.find(t=>t.name==='virtual_act').execute({observationId:'o',targetId:'node-1',action:'click'});
  assert.match(result.error,/主屏/);assert.match(result.error,/不要重复/);
  await manager.finish(s);
});

test('changed display geometry asks for a new session', async () => {
  let owner;
  const control={ownsVirtual:id=>owner===id, async request(op,_value,ctx){
    if(op==='virtual_start'){owner=ctx.owner;return {success:true,data:{observationId:'o',displayId:3}};}
    if(op==='virtual_observe')return {success:false,error:'virtual_display_geometry_changed'};
    if(op==='virtual_end'){owner=null;return {success:true,data:{cleanupConfirmed:true}};}
  }};
  const manager=createVirtualTools({control,readState:()=>({deviceBindings:{phoneSerials:['device']}}),
    controlConfig:()=>({packageName:'com.alipay.hulu',port:23342}),preview:()=>{}});
  const s={id:'chat-a',screenDevice:{serial:'device',runtime:'android'}},tools=manager.tools(s);
  await tools.find(t=>t.name==='virtual_start').execute({packageName:'com.example.app'});
  const result=await tools.find(t=>t.name==='virtual_observe').execute({});
  assert.equal(result.errorCode,'virtual_display_geometry_changed');
  assert.match(result.error,/重新开始/);
  await manager.finish(s);
});

test('delayed or failed preview is marked unavailable and a new frame restores it', async () => {
  let tick, expire, resolvePreview, previewMode = 'pending', owner;
  const previews = [];
  const timers = {
    setInterval(fn) { tick = fn; return { unref() {} }; }, clearInterval() {},
    setTimeout(fn) { expire = fn; return { unref() {} }; }, clearTimeout() {},
  };
  const control = { ownsVirtual: id => owner === id, async request(op, _value, ctx) {
    if (op === 'virtual_start') { owner = ctx.owner; return { success: true, data: {
      observationId: 'obs', displayId: 4, screenshotDataUrl: 'data:image/png;base64,FIRST' } }; }
    if (op === 'virtual_preview') {
      if (previewMode === 'pending') return new Promise(resolve => { resolvePreview = resolve; });
      if (previewMode === 'failed') throw Error('offline');
      if (previewMode === 'busy') throw Error('desktop_operation_busy');
      return { success: true, data: { displayId: 4, screenshotDataUrl: 'data:image/png;base64,NEW' } };
    }
    if (op === 'virtual_end') { owner = null; return { success: true, data: { cleanupConfirmed: true } }; }
  } };
  const manager = createVirtualTools({ control, timers, readState: () => ({ deviceBindings: { phoneSerials: ['device'] } }),
    controlConfig: () => ({ packageName: 'com.alipay.hulu', port: 23342 }), preview: (id, frame) => previews.push({ id, frame }) });
  const s = { id: 'chat-a', screenDevice: { serial:'device', runtime:'android' } };
  await manager.tools(s).find(t => t.name === 'virtual_start').execute({ packageName: 'com.example.app' });
  tick(); expire();
  assert.equal(previews.at(-1).frame.state, 'unavailable');
  resolvePreview({ success: true, data: { displayId: 4, screenshotDataUrl: 'data:image/png;base64,NEW' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(previews.at(-1).frame.state, 'active');
  previewMode = 'busy'; tick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(previews.at(-1).frame.state, 'active');
  expire(); assert.equal(previews.at(-1).frame.state, 'unavailable');
  previewMode = 'success'; tick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(previews.at(-1).frame.state, 'active');
  previewMode = 'failed'; tick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(previews.at(-1).frame.state, 'unavailable');
  previewMode = 'success'; tick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(previews.at(-1).frame.state, 'active');
  await manager.finish(s);
  expire();
  assert.equal(previews.at(-1).frame.state, 'closed');
});
