'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const https=require('node:https');
const {endpoint,createTransport}=require('./transport.cjs');
async function listen(t,handler){const s=http.createServer(handler);await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>s.close(r)));return `http://127.0.0.1:${s.address().port}`;}
test('HTTP development opt-in is explicit; origin restrictions remain for both schemes',()=>{
 assert.throws(()=>endpoint('http://localhost'),{code:'HTTPS_ORIGIN_REQUIRED'});
 assert.equal(endpoint('http://localhost:8780/',{allowInsecureHttp:true}),'http://localhost:8780');
 for(const u of ['ftp://localhost','http://u:p@localhost','http://localhost/?secret=x','http://localhost/#x','http://localhost/prefix'])assert.throws(()=>endpoint(u,{allowInsecureHttp:true}));
 assert.equal(endpoint('https://localhost',{allowInsecureHttp:true}),'https://localhost');
});
test('real HTTP JSON/token transport works only with opt-in and never follows redirects',async t=>{
 let count=0;const origin=await listen(t,(req,res)=>{count++;if(req.url==='/cp/healthz'){res.writeHead(302,{Location:origin+'/cp/target'});res.end('{}');return;}assert.equal(req.url,'/cp/heartbeat');assert.equal(req.headers.authorization,'Bearer temporary-test-token');let body='';req.on('data',c=>body+=c);req.on('end',()=>{assert.deepEqual(JSON.parse(body),{epoch:1});res.setHeader('content-type','application/json');res.end('{"ok":true}');});});
 assert.throws(()=>createTransport({serverUrl:origin}),{code:'HTTPS_ORIGIN_REQUIRED'});
 const request=createTransport({serverUrl:origin,allowInsecureHttp:true});assert.deepEqual(await request('POST','/v1/heartbeat',{epoch:1},'temporary-test-token'),{ok:true});
 await assert.rejects(request('GET','/v1/healthz',undefined,'temporary-test-token'),{code:'HTTP_302'});assert.equal(count,2);await assert.rejects(request('POST','/v1/enrollments/x/decision',{}),{code:'ROUTE_INVALID'});await assert.rejects(request('POST','/v1/events/ack',{}),{code:'ROUTE_INVALID'});assert.equal(count,2);
});
test('HTTP option does not disable HTTPS certificate verification',async t=>{
 // A plain HTTP endpoint used as HTTPS must fail TLS instead of falling back to HTTP.
 const origin=await listen(t,(_req,res)=>res.end('{}'));
 await assert.rejects(createTransport({serverUrl:origin.replace('http:','https:'),allowInsecureHttp:true,timeoutMs:1000})('GET','/v1/healthz'),e=>['NETWORK_FAILED','TLS_FAILED'].includes(e.code));
});

test('route mode is independent of protocol, exact seven bindings; no retry or fallback on failed enrollment',async t=>{
 const seen=[];const origin=await listen(t,(req,res)=>{seen.push(req.method+' '+req.url);res.writeHead(404,{'content-type':'application/json'});res.end('{}');});
 const cp=createTransport({serverUrl:origin,allowInsecureHttp:true,apiMode:'cp'});
 const routes=[['GET','healthz'],['POST','enrollments'],['POST','enrollments/recover/challenge'],['POST','enrollments/recover'],['GET','sessions/challenge?clientId=123'],['POST','sessions'],['POST','heartbeat']];
 for(const [method,route] of routes)await assert.rejects(cp(method,'/v1/'+route),{code:'HTTP_404'});
 assert.deepEqual(seen,routes.map(([method,route])=>method+' /cp/'+route));
 await assert.rejects(cp('POST','/v1/healthz'),{code:'ROUTE_INVALID'});await assert.rejects(cp('POST','/v1/enrollments/x/decision',{}),{code:'ROUTE_INVALID'});assert.equal(seen.length,7);
 const old=createTransport({serverUrl:origin,allowInsecureHttp:true,apiMode:'v1'});await assert.rejects(old('GET','/v1/healthz'),{code:'HTTP_404'});assert.equal(seen.at(-1),'GET /v1/healthz');
 assert.throws(()=>createTransport({serverUrl:'https://example.test',apiMode:'auto'}),{code:'CONFIG_INVALID'});
});
test('media event reads use exact CP mapping, bounded query and never expose ack/admin',async t=>{
 const seen=[];const origin=await listen(t,(req,res)=>{seen.push(req.url);res.setHeader('content-type','application/json');res.end('{}');});const request=createTransport({serverUrl:origin,apiMode:'cp',allowInsecureHttp:true});
 await request('GET','/v1/events?stream=client%3A01ARZ3NDEKTSV4RRFFQ69G5FAV&sinceSeq=2&limit=100');assert.match(seen[0],/^\/cp\/events\?/);
 for(const route of ['/v1/events?stream=org%3Aevil','/v1/events?stream=client%3A01ARZ3NDEKTSV4RRFFQ69G5FAV&limit=100&limit=10','/v1/events?stream=client%3A01ARZ3NDEKTSV4RRFFQ69G5FAV&sinceSeq=-1','/v1/events?stream=client%3A01ARZ3NDEKTSV4RRFFQ69G5FAV&secret=1'])await assert.rejects(request('GET',route),{code:'ROUTE_INVALID'});assert.equal(seen.length,1);
});

test('agent Client-only routes are exact and bounded; admin create/cancel never become CP routes',async t=>{
 const seen=[];const origin=await listen(t,(req,res)=>{seen.push(req.url);res.setHeader('content-type','application/json');res.end('{}')});
 const cp=createTransport({serverUrl:origin,allowInsecureHttp:true,apiMode:'cp'}),id='01M6QHK9V6X4PW4F7C95EGMCMD';
 await cp('GET','/v1/agent-tasks/queue?sinceId=0&limit=100');await cp('POST',`/v1/agent-tasks/${id}/progress`,{epoch:1});await cp('POST',`/v1/agent-tasks/${id}/result`,{epoch:1});
 assert.deepEqual(seen,['/cp/agent-tasks/queue?sinceId=0&limit=100',`/cp/agent-tasks/${id}/progress`,`/cp/agent-tasks/${id}/result`]);
 for(const [m,r] of [['POST','/v1/agent-tasks'],['POST',`/v1/agent-tasks/${id}/cancel`],['GET',`/v1/agent-tasks/${id}`],['GET','/v1/agent-tasks/queue?sinceId=-1'],['GET','/v1/agent-tasks/queue?limit=101'],['GET','/v1/agent-tasks/queue?limit=1&limit=2'],['GET','/v1/agent-tasks/queue?clientId=x'],['POST',`/v1/agent-tasks/${id}/result?x=1`]])await assert.rejects(cp(m,r),{code:'ROUTE_INVALID'});
 assert.equal(seen.length,3);
});

test('queue JSON preserves Chinese and emoji when HTTP chunks split UTF-8 code points',async t=>{
 const expected={commands:[{args:{document:{sampleExtractText:'支付成功',name:'同意开通😀',padding:'x'.repeat(20000)}}}]};
 const bytes=Buffer.from(JSON.stringify(expected));const split=bytes.indexOf(Buffer.from('支'))+1;
 const origin=await listen(t,(_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.write(bytes.subarray(0,split));setTimeout(()=>res.end(bytes.subarray(split)),20);});
 const request=createTransport({serverUrl:origin,allowInsecureHttp:true,apiMode:'cp'});
 assert.deepEqual(await request('GET','/v1/lab/queue'),expected);
});
