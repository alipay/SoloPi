'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createTransport}=require('./transport.cjs');
test('owner group submit/cancel map exact methods; admin routes and write query remain blocked',async t=>{
 const paths=[];const server=http.createServer(async(req,res)=>{paths.push(req.method+' '+req.url);assert.equal(req.headers.authorization,'Bearer fixture-session');let body='';for await(const c of req)body+=c;assert.equal(JSON.parse(body).requestId,'fixture-request');res.setHeader('content-type','application/json');res.end('{"accepted":true}');});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const call=createTransport({serverUrl:`http://127.0.0.1:${server.address().port}`,allowInsecureHttp:true,apiMode:'cp'});
 for(const route of ['/v1/group-dispatches','/v1/group-dispatches/cancel'])assert.equal((await call('POST',route,{requestId:'fixture-request'},'fixture-session')).accepted,true);
 for(const [m,p] of [['GET','/v1/group-dispatches/cancel'],['POST','/v1/group-grants'],['POST','/v1/group-dispatches?clientId=ignored'],['POST','/v1/group-dispatches/cancel?clientId=ignored']])await assert.rejects(call(m,p,{},'fixture-session'),{code:'ROUTE_INVALID'});
 assert.deepEqual(paths,['POST /cp/group-dispatches','POST /cp/group-dispatches/cancel']);
});
test('original request detail exact GET mapping, credential and method boundaries over real transport',async t=>{
 const id='11111111-1111-4111-8111-111111111111',seen=[];const server=http.createServer((req,res)=>{seen.push(req.url);assert.equal(req.headers.authorization,'Bearer fixture-session');res.setHeader('content-type','application/json');res.end('{"status":"done"}');});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const call=createTransport({serverUrl:`http://127.0.0.1:${server.address().port}`,allowInsecureHttp:true,apiMode:'cp'}),route='/v1/group-dispatches-by-request/'+id;
 assert.equal((await call('GET',route,undefined,'fixture-session')).status,'done');for(const [method,p] of [['POST',route],['GET',route+'?clientId=other'],['GET',route+'/extra'],['GET','/v1/group-dispatches-by-request/bad']])await assert.rejects(call(method,p,undefined,'fixture-session'),{code:'ROUTE_INVALID'});assert.deepEqual(seen,['/cp/group-dispatches-by-request/'+id]);
});
