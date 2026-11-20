// Passive HTTP observations for any Undici-backed model SDK. No payload/header
// mutation, fetch replacement, retry policy or provider-specific branches.
const dc=require('node:diagnostics_channel');
const {AsyncLocalStorage}=require('node:async_hooks');
const {createHash}=require('node:crypto');
const {requestIdentifiers}=require('./upstream-diagnostics');
const scope=new AsyncLocalStorage(),requests=new WeakMap();
let installed=false;
const safeCode=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,100}$/.test(v)?v:undefined;
function causes(error){const result=[],seen=new Set();for(let e=error;e&&result.length<5&&!seen.has(e);e=e.cause){seen.add(e);result.push({...(safeCode(e.name)?{name:e.name}:{}),...(safeCode(e.code)?{code:e.code}:{}),...(safeCode(e.syscall)?{syscall:e.syscall}:{})});}return result;}
function endpoint(url){try{const u=new URL(url);return {endpointOrigin:u.origin,endpointPathHash:createHash('sha256').update(u.pathname).digest('hex')};}catch{return {};}}
function emit(t,event,extra={}){if(t.owner.closed)return;try{t.owner.record({event,requestId:t.owner.requestId,purpose:t.owner.purpose,...t.fields,...extra});}catch{/* Observation must never affect execution. */}}
function subscribe(name,fn){dc.channel(name).subscribe(value=>{try{fn(value);}catch{}});}
function install(){if(installed)return;installed=true;
 subscribe('undici:request:create',({request})=>{
  const owner=scope.getStore();if(!owner||owner.closed||new URL(request.origin).origin!==owner.origin)return;
  const t={owner,started:performance.now(),fields:{...endpoint(new URL(request.path,request.origin)),transportAttempt:++owner.count,transportPhase:'created',transportObserved:true}};
  requests.set(request,t);emit(t,'model.http.start');
 });
 subscribe('undici:client:sendHeaders',({request})=>{const t=requests.get(request);if(!t)return;t.fields.requestSendStartMs=performance.now()-t.started;t.fields.transportPhase='sending';emit(t,'model.http.send');});
 subscribe('undici:request:bodyChunkSent',({request,chunk})=>{const t=requests.get(request);if(t)t.fields.requestBytes=(t.fields.requestBytes||0)+chunk.byteLength;});
 subscribe('undici:request:bodySent',({request})=>{const t=requests.get(request);if(!t)return;t.sent=performance.now();t.fields.requestBodySentMs=t.sent-t.started;t.fields.transportPhase='waiting-response';emit(t,'model.http.body-sent');});
 subscribe('undici:request:headers',({request,response})=>{
  const t=requests.get(request);if(!t)return;const now=performance.now();
  const raw=response.headers||[],headers=new Map();for(let i=0;i+1<raw.length;i+=2)headers.set(String(raw[i]).toLowerCase(),String(raw[i+1]));
  const ids=requestIdentifiers({get:name=>headers.get(name)});
  Object.assign(t.fields,{httpStatus:response.statusCode,headersMs:now-t.started,transportPhase:'receiving',...(t.sent===undefined?{}:{responseWaitMs:now-t.sent}),...(ids.requestId?{upstreamRequestId:ids.requestId}:{}),...(ids.traceId?{upstreamTraceId:ids.traceId}:{})});
  emit(t,'model.http.headers');
 });
 subscribe('undici:request:bodyChunkReceived',({request,chunk})=>{const t=requests.get(request);if(!t)return;if(t.fields.firstResponseByteMs===undefined){t.fields.firstResponseByteMs=performance.now()-t.started;emit(t,'model.http.first-byte');}t.fields.responseBytes=(t.fields.responseBytes||0)+chunk.byteLength;});
 subscribe('undici:request:trailers',({request})=>{const t=requests.get(request);if(t)emit(t,'model.http.end',{durationMs:performance.now()-t.started,transportPhase:'complete'});});
 subscribe('undici:request:error',({request,error})=>{const t=requests.get(request);if(t)emit(t,'model.http.error',{durationMs:performance.now()-t.started,errorCauses:causes(error)});});
}
function observeModelTransport({url,requestId,purpose,record}){
 install();let origin;try{origin=new URL(url).origin;}catch{}
 const owner={origin,requestId,purpose,record,count:0,closed:false};
 return {run:fn=>scope.run(owner,fn),finish(){owner.closed=true;return {transportObserved:owner.count>0,transportRequestCount:owner.count};}};
}
module.exports={observeModelTransport,endpoint,causes};
