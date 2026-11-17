import {nativeFixture,toolCall,LlmError} from './fixtures/native-harness.mjs';
import {NativeRuntime,disposeAll} from './fixtures/harness-lifecycle.mjs';
import {boundary as nativeBoundary} from './fixtures/harness-lifecycle.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
test.after(disposeAll);
const require = createRequire(import.meta.url);
const { recoverModelStep, recoveryReason } = require('../electron/agent/model-step-recovery');
const { AgentRuntime } = {AgentRuntime:NativeRuntime};
const { AgentStore } = require('../electron/agent/store');
const { requestModel } = require('../electron/agent/model');
const failure = (code = 'UND_ERR_SOCKET', extra = {}) => Object.assign(Error('PRIVATE_ERROR'), {
  diagnostics: { category: 'disconnected', stage: 'connect', causes: [{ code }], requestHeadersSent: true,
    requestBodySent: true, connectionUse: 'reused', streamBytes: 0, ...extra },
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const settle = async runtime=>nativeBoundary(runtime);
function fixture(t, model, tools = [], options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-recovery-'));
  t.after(async()=>{await disposeAll();fs.rmSync(dir, { recursive: true, force: true })});
  const store = new AgentStore(() => dir);
  const runtime = new AgentRuntime({ store, model, provider: () => ({}), tools: async () => tools,
    modelRecoveryOptions: { wait: async () => {}, random: () => 0.5, ...options } });
  const s = store.create(); s.approvalMode = 'auto'; store.save(s);
  return { store, runtime, s };
}
test('transport recovery persists before wait, retries five times total, and sanitizes failed attempts', async () => {
  let calls = 0; const events = [], waits = [], states = [];
  await assert.rejects(recoverModelStep(async () => { calls++; throw failure(); }, {
    maxRetries:5, random: () => 0.5, record: e => events.push(e), onRetry: e => states.push(e),
    wait: async ms => { assert.equal(events.at(-1).phase, 'scheduled'); waits.push(ms); },
  }), e => e.diagnostics.automaticRetryCount === 5);
  assert.equal(calls, 6); assert.deepEqual(waits, [500, 1000, 2000, 4000, 8000]);
  assert.equal(events.filter(e => e.phase === 'started').length, 5);
  assert.equal(events.at(-1).phase, 'failed'); assert.equal(states.at(-1), null);
  assert.equal(events[0].failure.code, 'UND_ERR_SOCKET');
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE_ERROR/);
  for (const [random, expected] of [[0, 450], [1, 550]]) {
    let tries=0;const delays=[];
    await recoverModelStep(async()=>{if(++tries===1)throw failure();return 'ok';},{record:()=>{},random:()=>random,wait:async ms=>delays.push(ms)});
    assert.deepEqual(delays,[expected]);
  }
});
test('retry categories use structured codes; permanent failures do not retry', () => {
  for (const [error, reason] of [
    [failure(), 'transport-error'], [failure('ECONNRESET', { stage: 'parse', streamBytes: 100 }), 'transport-error'],
    [failure('MODEL_REQUEST_TIMEOUT', { category: 'timeout', timeoutKind: 'idle' }), 'model-timeout'],
    [failure('UPSTREAM_ERROR', { category: 'upstream', httpStatus: 200, upstreamCode: '500' }), 'server-error'],
    [failure('EMPTY_RESPONSE'), 'empty-response'], [failure('INCOMPLETE_STREAM'), 'incomplete-response'],
  ]) assert.equal(recoveryReason(error), reason);
  for (const code of ['OUTPUT_LIMIT', 'INVALID_TOOL_CALL', 'INPUT_BUDGET_EXCEEDED', 'CONTEXT_WINDOW_EXCEEDED', 'ENOTFOUND', 'CERT_HAS_EXPIRED'])
    assert.equal(recoveryReason(failure(code)), null, code);
  for (const extra of [{ httpStatus: 401 }, { httpStatus: 403 }, { httpStatus: 400 },
    { httpStatus: 429, upstreamCode: 'insufficient_quota' }, { category: 'cancelled' }, { category: 'tls' }])
    assert.equal(recoveryReason(failure('UPSTREAM_ERROR', extra)), null);
  assert.equal(recoveryReason(Error('UND_ERR_SOCKET 500 rate limit')), null);
});
test('rate-limit keeps 5/15/30 seconds and three retries; mixed failures share global budget', async () => {
  let calls = 0; const waits = [];
  await assert.rejects(recoverModelStep(async () => { calls++; throw failure('UPSTREAM_ERROR', { httpStatus: 429 }); }, {
    maxRetries:5, record: () => {}, wait: async ms => waits.push(ms), random: () => 0.5,
  }));
  assert.equal(calls, 4); assert.deepEqual(waits, [5000, 15000, 30000]);
  calls = 0;
  await assert.rejects(recoverModelStep(async () => { calls++; throw calls % 2 ? failure() : failure('UPSTREAM_ERROR', { httpStatus: 500 }); }, {
    maxRetries:5, record: () => {}, wait: async () => {}, random: () => 0.5,
  })); assert.equal(calls, 6);
});
test('cancellation during countdown never sends another request and has durable cancellation state', async () => {
  const controller = new AbortController(), events = []; let calls = 0;
  await assert.rejects(recoverModelStep(async () => { calls++; throw failure(); }, {
    signal: controller.signal, record: e => events.push(e), wait: async () => controller.abort(),
  }));
  assert.equal(calls, 1); assert.equal(events.at(-1).phase, 'cancelled');
});
test('failed durable scheduling write prevents retry and countdown', async () => {
  let calls = 0;
  await assert.rejects(recoverModelStep(async () => { calls++; throw failure(); }, {
    record: () => { throw Error('save failed'); }, wait: () => assert.fail('must not wait'),
  }), /save failed/); assert.equal(calls, 1);
});
test("native durable retry repeats only failed model step and never the prior write", async t=>{let writes=0;const f=nativeFixture(t,[()=>[toolCall('write')],()=>{throw new LlmError('disconnect','TRANSPORT');},o=>{assert.match(JSON.stringify(o.messages),/saved-once/);return 'done';}],[{name:'write',schema:{type:'object'},execute:()=>{writes++;return{success:true,receipt:'saved-once'};}}],{retryPolicy:{mode:'normal',maxRetries:2,backoff:{initialDelayMs:1,maxDelayMs:1,jitterRatio:0}}});const s=await f.run();assert.equal(s.status,'idle');assert.equal(writes,1);assert.equal(f.adapter.requests.length,3);const host=f.runtime.hosts.get(s.id);assert.ok(Array.from({length:host.agent.session.seq},(_,i)=>host.agent.session.eventAt(i)).some(e=>e.type==='llm/retry'));});
test("native steering cancels retry backoff and starts the new input", async t=>{let entered;const ready=new Promise(r=>entered=r);const f=nativeFixture(t,[()=>{entered();throw new LlmError('disconnect','TRANSPORT');},o=>{assert.match(JSON.stringify(o.messages),/new direction/);return 'new answer';}],[],{retryPolicy:{mode:'normal',maxRetries:5,backoff:{initialDelayMs:1000,maxDelayMs:1000,jitterRatio:0}}});await f.runtime.start(f.s.id,'old',{});await ready;await f.runtime.start(f.s.id,'new direction',{});await nativeBoundary(f.runtime);assert.equal(f.adapter.requests.length,2);assert.equal(f.store.get(f.s.id).messages.at(-1).content,'new answer');});
test('real reused socket disconnect recovers with new connection; low-level retries remain disabled', async t => {
  let hits = 0; const sockets = [];
  const server = http.createServer((req, res) => {
    hits++; sockets.push(req.socket); req.resume(); req.on('end', () => {
      if (hits === 2) { req.socket.destroy(); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: 'complete' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { Agent, fetch } = require('undici'); const dispatcher = new Agent({ connections: 1 });
  t.after(async()=>{ server.closeAllConnections(); await dispatcher.destroy(); await new Promise(r => server.close(r)); });
  const options = { provider: { baseUrl: `http://127.0.0.1:${server.address().port}`, model: 'fixture' }, messages: [], tools: [], retry: false,
    fetchImpl: (url, o) => fetch(url, { ...o, dispatcher }) };
  await requestModel(options); const events = [];
  const response = await recoverModelStep(() => requestModel(options), { record: e => events.push(e), wait: async () => {} });
  assert.equal(response.content, 'complete'); assert.equal(hits, 3);
  assert.equal(sockets[0], sockets[1]); assert.notEqual(sockets[1], sockets[2]);
  assert.equal(events[0].failure.connectionUse, 'reused'); assert.equal(events[0].failure.code, 'UND_ERR_SOCKET');
});
test("native retry exhaustion keeps failure category and durable attempt evidence with a readable summary", async t=>{const f=nativeFixture(t,Array.from({length:3},()=>()=>{throw new LlmError('server unavailable','SERVER');}),[],{retryPolicy:{mode:'normal',maxRetries:2,backoff:{initialDelayMs:1,maxDelayMs:1,jitterRatio:0}}});const s=await f.run();assert.equal(s.status,'failed');assert.equal(f.adapter.requests.length,3);assert.match(s.error,/模型服务暂时不可用/);assert.equal(s.errorDetails.code,'SERVER');const evidence=JSON.parse(f.store.readEvidence(s.id,s.errorDetails.evidenceId).content);assert.equal(evidence.requestCount,3);assert.equal(evidence.retryCount,2);assert.deepEqual(evidence.failures.map(x=>x.code),['SERVER','SERVER','SERVER']);const h=f.runtime.hosts.get(s.id);assert.equal(Array.from({length:h.agent.session.seq},(_,i)=>h.agent.session.eventAt(i)).filter(e=>e.type==='llm/retry').length,2);});
test("native stop cancels retry backoff and reopening never reissues the failed request", async t=>{let entered;const ready=new Promise(r=>entered=r);const f=nativeFixture(t,[()=>{entered();throw new LlmError('timeout','TIMEOUT');}],[],{retryPolicy:{mode:'normal',maxRetries:5,backoff:{initialDelayMs:1000,maxDelayMs:1000,jitterRatio:0}}});await f.runtime.start(f.s.id,'old',{});await ready;f.runtime.stop(f.s.id);await nativeBoundary(f.runtime);assert.equal(f.adapter.requests.length,1);assert.equal(f.store.get(f.s.id).status,'interrupted');await f.runtime.stopAll();assert.equal(new AgentStore(()=>f.dir).get(f.s.id).status,'interrupted');});

test('recovery budget prevents a backoff that cannot fit; original first request is unaffected',async()=>{
 let calls=0;const events=[];
 await assert.rejects(recoverModelStep(async signal=>{calls++;assert.equal(signal,undefined);throw failure();},{record:e=>events.push(e),recoveryTimeoutMs:10,wait:()=>assert.fail('budget must reject before waiting')}));
 assert.equal(calls,1);assert.equal(events.at(-1).reason,'recovery-budget-exhausted');
});
test('recovery deadline aborts a stalled retry and persists exhaustion without executing its partial tools',async()=>{
 let calls=0;const events=[];
 // Keep the test alive independently of the unref'ed production deadline.
 const keepAlive=setInterval(()=>{},20);
 try{await assert.rejects(recoverModelStep(async signal=>{
  if(++calls===1)throw failure();
  return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
 },{record:e=>events.push(e),recoveryTimeoutMs:650,random:()=>0,wait:async()=>{}}),e=>e.diagnostics.recoveryBudgetMs===650);
 assert.equal(calls,2);assert.equal(events.at(-1).reason,'recovery-budget-exhausted');}finally{clearInterval(keepAlive);}
});

test('429 honors structured Retry-After within recovery budget and refuses waits outside it',async()=>{
 let calls=0;const waits=[];
 assert.equal(await recoverModelStep(async()=>{if(++calls===1)throw failure('UPSTREAM_ERROR',{httpStatus:429,retryAfterMs:1234});return 'ok';},{record:()=>{},wait:async ms=>waits.push(ms)}),'ok');
 assert.deepEqual(waits,[1234]);calls=0;
 await assert.rejects(recoverModelStep(async()=>{calls++;throw failure('UPSTREAM_ERROR',{httpStatus:429,retryAfterMs:120000});},{record:()=>{},wait:()=>assert.fail('must respect budget')}));assert.equal(calls,1);
});
test('real model adapter preserves Retry-After without retaining response headers or body',async()=>{
 await assert.rejects(requestModel({provider:{model:'fixture',baseUrl:'http://localhost:1'},messages:[{role:'user',content:'private'}],tools:[],retry:false,fetchImpl:async()=>new Response(JSON.stringify({error:{code:'rate_limit_exceeded',message:'private'}}),{status:429,headers:{'Retry-After':'2','x-private':'secret'}})}),e=>{assert.equal(e.diagnostics.retryAfterMs,2000);assert.doesNotMatch(JSON.stringify(e.diagnostics),/x-private|secret/);return true;});
});
