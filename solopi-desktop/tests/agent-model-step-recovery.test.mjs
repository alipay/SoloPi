import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { recoverModelStep, recoveryReason } = require('../electron/agent/model-step-recovery');
const { AgentRuntime } = require('../electron/agent/runtime');
const { AgentStore } = require('../electron/agent/store');
const { requestModel } = require('../electron/agent/model');
const failure = (code = 'UND_ERR_SOCKET', extra = {}) => Object.assign(Error('PRIVATE_ERROR'), {
  diagnostics: { category: 'disconnected', stage: 'connect', causes: [{ code }], requestHeadersSent: true,
    requestBodySent: true, connectionUse: 'reused', streamBytes: 0, ...extra },
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const settle = async runtime => { for (let i = 0; i < 500 && runtime.active.size; i++) await sleep(5); assert.equal(runtime.active.size, 0); };
function fixture(t, model, tools = [], options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-recovery-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
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
test('runtime retries only failed model step: prior write executes once, partial text/tools never enter history', async t => {
  let requests = 0, writes = 0; const inputs = [];
  const f = fixture(t, async o => {
    assert.equal(o.retry, false); inputs.push(JSON.stringify(o.messages)); requests++;
    if (requests === 1) return { role: 'assistant', content: null, tool_calls: [{ id: 'write-once', type: 'function', function: { name: 'fixture_write', arguments: '{}' } }] };
    if (requests === 2) { o.onDelta({ content: 'FAILED_PARTIAL', reasoning: 'FAILED_REASONING', toolCallCount: 1 }); throw failure('UND_ERR_SOCKET', { stage: 'parse', streamBytes: 99 }); }
    const live=f.runtime.liveSessions.get(f.s.id);
    assert.equal(live.streaming.content, ''); assert.equal(live.streaming.toolCallCount, 0);
    return { role: 'assistant', content: 'complete' };
  }, [{ name: 'fixture_write', schema: { type: 'object' }, execute: async () => { writes++; return { success: true }; } }], {
    wait: async () => {
      const saved = f.store.get(f.s.id);
      assert.equal(saved.modelRecovery.events.at(-1).phase, 'scheduled'); assert.ok(saved.retry);
      assert.equal(saved.calls.filter(c => c.status === 'done').length, 1);
    },
  });
  await f.runtime.start(f.s.id, 'run fixture'); await settle(f.runtime);
  const saved = f.store.get(f.s.id);
  assert.equal(saved.status, 'idle'); assert.equal(saved.messages.at(-1).content, 'complete');
  assert.equal(writes, 1); assert.equal(requests, 3); assert.equal(inputs[1], inputs[2]);
  assert.doesNotMatch(JSON.stringify(saved.messages), /FAILED_PARTIAL|FAILED_REASONING/);
  assert.equal(saved.modelRecovery.phase, 'completed'); assert.equal(saved.retry, null);
});
test('new user steering during recovery cancels old step and does not retry old input', async t => {
  let count = 0;
  const f = fixture(t, async () => { if (++count === 1) throw failure(); return { role: 'assistant', content: 'new answer' }; }, [], {
    wait: async () => { await f.runtime.start(f.s.id, 'new request'); },
  });
  await f.runtime.start(f.s.id, 'old request'); await settle(f.runtime);
  const saved = f.store.get(f.s.id);
  assert.equal(count, 2); assert.equal(saved.status, 'idle');
  assert.equal(saved.messages.at(-1).content, 'new answer');
  assert.equal(saved.modelRecoveryHistory.at(-1).events.at(-1).phase, 'cancelled');
});
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
  t.after(async () => { server.closeAllConnections(); await dispatcher.destroy(); await new Promise(r => server.close(r)); });
  const options = { provider: { baseUrl: `http://127.0.0.1:${server.address().port}`, model: 'fixture' }, messages: [], tools: [], retry: false,
    fetchImpl: (url, o) => fetch(url, { ...o, dispatcher }) };
  await requestModel(options); const events = [];
  const response = await recoverModelStep(() => requestModel(options), { record: e => events.push(e), wait: async () => {} });
  assert.equal(response.content, 'complete'); assert.equal(hits, 3);
  assert.equal(sockets[0], sockets[1]); assert.notEqual(sockets[1], sockets[2]);
  assert.equal(events[0].failure.connectionUse, 'reused'); assert.equal(events[0].failure.code, 'UND_ERR_SOCKET');
});
test('runtime exhaustion retains original diagnostics and persists same budget without hidden extra calls', async t => {
  let count = 0; const f = fixture(t, async () => { count++; throw failure(); });
  await f.runtime.start(f.s.id, 'fixture'); await settle(f.runtime);
  const saved = f.store.get(f.s.id);
  assert.equal(saved.status, 'failed'); assert.equal(count, 2); assert.equal(saved.errorDetails.automaticRetryCount, 1);
  assert.equal(saved.modelRecovery.phase, 'failed'); assert.equal(saved.retry, null);
  assert.equal(saved.modelRecovery.events.filter(e => e.phase === 'scheduled').length, 1);
});
test('runtime stop cancels backoff and does not resume it after store reload', async t => {
  let count = 0; const f = fixture(t, async () => { count++; throw failure(); }, [], {
    wait: async () => { f.runtime.stop(f.s.id); },
  });
  await f.runtime.start(f.s.id, 'fixture'); await settle(f.runtime);
  const saved = new AgentStore(() => f.store.directory()).get(f.s.id);
  assert.equal(count, 1); assert.equal(saved.status, 'interrupted'); assert.equal(saved.retry, null);
  assert.equal(saved.modelRecovery.phase, 'cancelled');
  assert.equal(saved.modelRecovery.events.filter(e => e.phase === 'started').length, 0);
});

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
