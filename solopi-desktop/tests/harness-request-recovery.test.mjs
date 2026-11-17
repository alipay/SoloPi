import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const {installRetrySchedule,retryPolicy,RequestFailureTrace}=require('../electron/agent/harness-request-recovery');

test('native schedule preserves provider cooldown and bounds linear fallback for each retryable failure',async()=>{
  assert.equal(retryPolicy.maxRetries,5);
  assert.deepEqual(retryPolicy.backoff,{initialDelayMs:15000,maxDelayMs:75000,jitterRatio:0});
  const policy={mode:'normal',maxRetries:5,retryableCodes:['TRANSPORT','RATE_LIMIT','TIMEOUT','SERVER'],...retryPolicy.backoff};
  const policyKey=JSON.stringify([policy.mode,policy.maxRetries,[...policy.retryableCodes].sort(),policy.initialDelayMs,policy.maxDelayMs,policy.jitterRatio]);
  let hook,previous=0;
  const session={};
  installRetrySchedule({on:(name,fn)=>{assert.equal(name,'agent/request-error');hook=fn;},sessionProjections:{stateOf:(s,key)=>{
    assert.equal(s,session);assert.equal(key,'llmRetry');return {[JSON.stringify(['configured',policyKey])]:{retry:previous}};
  }}});
  for(const code of policy.retryableCodes)for(previous=0;previous<5;previous++){
    const failure={code,providerRetryAfterMs:60000},payload={agent:{session},provider:'configured',retryPolicy:policy,failure};
    let calls=0;const result=await hook(payload,async()=>{calls++;return 'native-retry';});
    if(code!=='RATE_LIMIT' && previous>=1){assert.equal(result,undefined);assert.equal(calls,0);continue;}
    assert.equal(result,'native-retry');assert.equal(calls,1);
    assert.equal(payload.failure.providerRetryAfterMs,Math.max(60000,15000*(previous+1)));
    assert.equal(failure.providerRetryAfterMs,60000);assert.equal(payload.retryPolicy,policy);
  }
  const payload={retryPolicy:{...policy,initialDelayMs:1},failure:{code:'TRANSPORT'}};
  await hook(payload,async()=>{});assert.equal(payload.failure.providerRetryAfterMs,undefined);
});

test('real sequence of five quota failures then transport retains all six attempts',()=>{
  const trace=new RequestFailureTrace();
  trace.event({type:'step/start'});
  for(let i=0;i<6;i++){
    trace.model({event:'model.start'});
    trace.model({event:'model.error',category:i<5?'RATE_LIMIT':'TRANSPORT',requestId:'request-'+i,durationMs:i<5?1000:91058,diagnosticText:'must-not-be-copied'});
    if(i<5)trace.event({type:'llm/retry',data:{retry:i+1,maxRetries:5,failure:{code:'RATE_LIMIT'},delayMs:60000}});
  }
  const error=trace.decorate(Object.assign(Error('Connection error.'),{code:'TRANSPORT'}));
  assert.match(error.message,/请求 6 次，重试 5 次/);assert.match(error.message,/此前 5 次请求被限流/);
  assert.equal(error.diagnostics.failures.at(-1).durationMs,91058);
  assert.equal(error.diagnostics.transportCauseAvailable,false);
  assert.doesNotMatch(JSON.stringify(error.diagnostics),/must-not-be-copied/);
  trace.event({type:'step/start'});assert.equal(trace.requests,0);assert.deepEqual(trace.failures,[]);
  const auth=Object.assign(Error('auth'),{code:'AUTH'});assert.equal(trace.decorate(auth),auth);
});

if(!zlib.createZstdCompress){
  test('native recovery integration on the desktop Node runtime',()=>{
    const env={...process.env,ELECTRON_RUN_AS_NODE:'1'};delete env.NODE_TEST_CONTEXT;
    const r=spawnSync(require('electron'),['--test',new URL(import.meta.url).pathname],{env,encoding:'utf8',timeout:90000});
    assert.equal(r.status,0,r.stdout+r.stderr);
  });
}else{
  const {nativeFixture,toolCall}=await import('./fixtures/native-harness.mjs');
  const {LlmError}=await import('@deepseek-ai/dsh-llm');
  const shortPolicy={mode:'normal',maxRetries:2,backoff:{initialDelayMs:1,maxDelayMs:60000,jitterRatio:0}};
  test('native transport retry does not repeat an already committed tool',async t=>{
    let writes=0;
    const f=nativeFixture(t,[()=>[toolCall('write_once',{})],()=>{throw new LlmError('Connection error.','TRANSPORT');},()=> 'recovered'],
      [{name:'write_once',schema:{type:'object',properties:{}},execute:()=>{writes++;return{success:true,receipt:'committed'};}}],{retryPolicy:shortPolicy});
    const s=await f.run();assert.equal(s.status,'idle');assert.equal(writes,1);assert.equal(f.adapter.requests.length,3);
  });
  test('native quota cooldown is cancellable without sending another request',async t=>{
    const f=nativeFixture(t,[()=>{throw new LlmError('quota','RATE_LIMIT');}],[],{retryPolicy});
    await f.runtime.start(f.s.id,'verify',{});
    for(let i=0;i<100&&!f.runtime.liveSessions.get(f.s.id).retry;i++)await new Promise(r=>setTimeout(r,5));
    const s=f.runtime.liveSessions.get(f.s.id);
    assert.equal(s.retry.reason,'RATE_LIMIT');
    assert.ok(s.retry.retryAt-Date.now()>14000 && s.retry.retryAt-Date.now()<=15000);
    f.runtime.stop(f.s.id);await f.runtime.hosts.get(f.s.id).idle();
    assert.equal(f.adapter.requests.length,1);
  });
  test('exhausted native transport retries persist actionable diagnostics',async t=>{
    const failure=()=>{throw new LlmError('Connection error.','TRANSPORT');};
    const f=nativeFixture(t,[failure,failure,failure],[],{retryPolicy:shortPolicy});
    const s=await f.run();assert.equal(s.status,'failed');assert.match(s.error,/请求 3 次，重试 2 次/);
    assert.equal(f.adapter.requests.length,3);
    assert.equal(s.errorDetails.code,'TRANSPORT');assert.ok(s.errorDetails.evidenceId);
  });
}
