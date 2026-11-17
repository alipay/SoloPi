import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {observeModelTransport,endpoint,causes}=require('../electron/agent/model-transport-trace');
const diagnostics=require('../electron/diagnostics');
async function server(t,handler){const s=http.createServer(handler);await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>{s.closeAllConnections();s.close();});return `http://127.0.0.1:${s.address().port}`;}
test('HTTP status, upstream IDs, attempts and errors are correlated without payload or credentials',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'model-trace-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));diagnostics.configure(dir);
 const url=await server(t,(req,res)=>{res.writeHead(req.url.startsWith('/fail')?429:200,{'x-request-id':'upstream-123','traceparent':'00-1234-5678-01','set-cookie':'PRIVATE_COOKIE'});res.end('PRIVATE_RESPONSE');});
 const events=[],o=observeModelTransport({url,requestId:'local-123',purpose:'conversation',record:r=>{events.push(r);diagnostics.record(r);}});
 await o.run(async()=>{for(const route of ['/ok?api_key=PRIVATE_QUERY','/fail'])await(await fetch(url+route,{headers:{authorization:'Bearer PRIVATE_KEY'},method:'POST',body:'PRIVATE_MESSAGE'})).text();});
 assert.deepEqual(o.finish(),{transportObserved:true,transportRequestCount:2});
 const headers=events.filter(e=>e.event==='model.http.headers');assert.deepEqual(headers.map(e=>e.httpStatus),[200,429]);assert.deepEqual(headers.map(e=>e.transportAttempt),[1,2]);
 for(const e of headers){assert.equal(e.upstreamRequestId,'upstream-123');assert.equal(e.upstreamTraceId,'00-1234-5678-01');assert.ok(e.headersMs>=e.requestBodySentMs);assert.equal(e.requestId,'local-123');}
 assert.ok(events.some(e=>e.event==='model.http.first-byte'));
 const log=fs.readFileSync(path.join(dir,'diagnostics/runtime.jsonl'),'utf8');assert.doesNotMatch(log,/PRIVATE_|authorization|set-cookie/i);
 assert.equal(endpoint('https://user:PRIVATE_PASSWORD@example.org/custom/PRIVATE_PATH?token=PRIVATE_QUERY').endpointOrigin,'https://example.org');assert.doesNotMatch(JSON.stringify(endpoint('https://example.org/PRIVATE_PATH')),/PRIVATE/);
});
test('parallel scopes and connection reset retain distinct local IDs and safe low-level causes',async t=>{
 const url=await server(t,(req,res)=>{if(req.url==='/reset'){req.resume();req.on('end',()=>req.socket.destroy());}else setTimeout(()=>res.end('ok'),10);});
 const collected=[[],[]];await Promise.all(collected.map(async(events,i)=>{const o=observeModelTransport({url,requestId:'r'+i,record:r=>events.push(r)});try{await o.run(async()=>{await(await fetch(url+(i?'/reset':'/ok'),{method:'POST',body:'x'})).text();});}catch{}finally{o.finish();}}));
 for(let i=0;i<2;i++)assert.ok(collected[i].every(e=>e.requestId==='r'+i));
 const failure=collected[1].find(e=>e.event==='model.http.error');assert.ok(failure);assert.ok(failure.errorCauses.some(e=>e.code==='UND_ERR_SOCKET'));assert.equal(collected[0].some(e=>e.event==='model.http.error'),false);
 const error=Object.assign(new Error('Bearer PRIVATE_KEY'),{code:'ECONNRESET',cause:Object.assign(new Error('PRIVATE_BODY'),{code:'ETIMEDOUT'})});error.cause.cause=error;
 assert.equal(causes(error).length,2);assert.doesNotMatch(JSON.stringify(causes(error)),/PRIVATE/);
});
test('abort before response headers is observed and synthetic adapters are explicitly unobserved',async t=>{
 const url=await server(t,()=>{}),events=[];const o=observeModelTransport({url,requestId:'abort',record:r=>events.push(r)});
 await assert.rejects(o.run(()=>fetch(url,{signal:AbortSignal.timeout(50)})));assert.equal(o.finish().transportObserved,true);assert.ok(events.some(e=>e.event==='model.http.error'));assert.equal(events.some(e=>e.httpStatus),false);
 const fake=observeModelTransport({url,requestId:'fake',record:()=>{throw Error('not called');}});await fake.run(async()=>{});assert.deepEqual(fake.finish(),{transportObserved:false,transportRequestCount:0});
});
test('official Harness provider emits HTTP trace and selected model metadata for a real SSE request',async t=>{
 const {createHarnessHost}=await import('../electron/agent/harness-host.mjs');const records=[];let requests=0,wireModel;
 const url=await server(t,(req,res)=>{requests++;let body='';req.on('data',c=>body+=c);req.on('end',()=>{wireModel=JSON.parse(body).model;res.writeHead(200,{'content-type':'text/event-stream','x-request-id':'sdk-request-1','x-trace-id':'sdk-trace-1'});res.write('data: '+JSON.stringify({id:'chat-fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{role:'assistant',content:'ok'},finish_reason:null}]})+'\n\n');res.end('data: '+JSON.stringify({id:'chat-fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:1000,prompt_tokens_details:{cached_tokens:800},completion_tokens:20}})+'\n\ndata: [DONE]\n\n');});});
 const h=await createHarnessHost({id:'trace-fixture',provider:{baseUrl:url+'/v1',apiKey:'PRIVATE_KEY',model:'fixture'},system:'test',compaction:false,onModel:r=>records.push(r)});t.after(()=>h.dispose());h.send('PRIVATE_MESSAGE');await h.idle();
 assert.equal(requests,1);assert.equal(wireModel,'fixture');const start=records.find(e=>e.event==='model.start'),headers=records.find(e=>e.event==='model.http.headers'),end=records.find(e=>e.event==='model.response');
 assert.ok(headers,JSON.stringify(records));assert.equal(headers.requestId,start.requestId);assert.equal(headers.upstreamRequestId,'sdk-request-1');assert.equal(start.modelSelectionMatches,true);assert.equal(start.configuredModel,'fixture');assert.equal(end.transportObserved,true);assert.equal(end.outcome,'completed');assert.ok(end.firstOutputMs>=0);assert.equal(end.uncachedInputTokens,200);assert.equal(end.cacheReadTokens,800);assert.equal(end.cacheWriteTokens,0);assert.equal(end.totalInputTokens,1000);
 const safe=diagnostics.sanitize(end);assert.equal(safe.totalInputTokens,1000);assert.equal(safe.cacheReadTokens,800);
 assert.doesNotMatch(JSON.stringify(records),/PRIVATE_/);
});

test('official Harness HTTP rejection is a failed outcome with upstream identity and no semantic output',async t=>{
 const {createHarnessHost}=await import('../electron/agent/harness-host.mjs');const records=[];let requests=0,failure;
 const url=await server(t,(req,res)=>{requests++;req.resume();res.writeHead(401,{'content-type':'application/json','request-id':'auth-request','trace-id':'auth-trace'});res.end(JSON.stringify({error:{message:'invalid credentials',type:'authentication_error'}}));});
 const h=await createHarnessHost({id:'trace-auth',provider:{baseUrl:url+'/v1',apiKey:'PRIVATE_KEY',model:'fixture'},system:'test',compaction:false,onModel:r=>records.push(r),onError:e=>failure=e});t.after(()=>h.dispose());h.send('test');await h.idle();
 assert.equal(requests,1);assert.ok(failure);const headers=records.find(e=>e.event==='model.http.headers'),end=records.find(e=>e.event==='model.response');assert.equal(headers.httpStatus,401);assert.equal(headers.upstreamRequestId,'auth-request');assert.equal(end.outcome,'failed');assert.equal(end.firstOutputMs,undefined);
});

test('support bundle retains trace metadata while excluding raw errors, header maps and private endpoint paths',()=>{
 const safe=diagnostics.sanitize({event:'model.http.error',endpointOrigin:'https://models.example.org',endpointPathHash:'abc',httpStatus:502,upstreamRequestId:'upstream',upstreamTraceId:'trace',configuredModel:'fixture',modelSelectionMatches:false,transportAttempt:2,firstResponseByteMs:4,responseBytes:100,outcome:'failed',errorCauses:[{name:'TypeError',code:'ECONNRESET',message:'PRIVATE_BODY',headers:{authorization:'PRIVATE_KEY'},syscall:'read'}],url:'https://user:PRIVATE_KEY@models.example.org/PRIVATE_PATH?key=PRIVATE_KEY',headers:{authorization:'PRIVATE_KEY'}});
 assert.equal(safe.upstreamRequestId,'upstream');assert.equal(safe.transportAttempt,2);assert.equal(safe.modelSelectionMatches,false);assert.deepEqual(safe.errorCauses,[{name:'TypeError',code:'ECONNRESET',syscall:'read'}]);assert.doesNotMatch(JSON.stringify(safe),/PRIVATE_/);
});
