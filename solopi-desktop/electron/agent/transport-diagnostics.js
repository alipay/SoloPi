// Observe Undici without changing its pool, request headers, or transport policy.
const dc=require('node:diagnostics_channel');
const {AsyncLocalStorage}=require('node:async_hooks');
const {randomUUID}=require('node:crypto');
const scope=new AsyncLocalStorage();
const requests=new WeakMap(),connections=new WeakMap(),attempts=new WeakMap();
const diagnostics=require('../diagnostics');
let installed=false;
function subscribe(name,handler) {
 dc.channel(name).subscribe(data=>{try{handler(data);}catch{/* Observability must never break transport. */}});
}
function install() {
 if(installed)return;installed=true;
 subscribe('undici:request:create',({request})=>{
  const trace=scope.getStore();
  if(!trace || trace.closed || new URL(request.origin).origin!==trace.origin)return;
  requests.set(request,trace);
  trace.metadata.transportObserved=true;
  trace.metadata.transportRequestCount=(trace.metadata.transportRequestCount || 0)+1;
  trace.metadata.requestHeadersSent ??= false;
  trace.metadata.requestBodySent ??= false;
 });
 // These connection channels are not request-specific. Associate the attempt
 // with its socket, then join to a request only at sendHeaders.
 subscribe('undici:client:beforeConnect',({connectParams})=>{
  const trace=scope.getStore();
  if(!trace || trace.closed)return;
  let pending=attempts.get(trace);if(!pending){pending=new Map();attempts.set(trace,pending);}
  const key=JSON.stringify([connectParams.host,connectParams.protocol,connectParams.port]);
  const list=pending.get(key)||[];list.push({connectionId:randomUUID(),started:performance.now()});pending.set(key,list);
 });
 subscribe('undici:client:connectError',({connectParams,error})=>{
  const trace=scope.getStore();if(!trace || trace.closed)return;
  if(new URL(trace.origin).hostname.replace(/^\[|\]$/g,'')!==connectParams.hostname)return;
  const key=JSON.stringify([connectParams.host,connectParams.protocol,connectParams.port]);
  const pending=attempts.get(trace),list=pending?.get(key);pending?.delete(key);
  if(list?.length!==1)return; // Ambiguous pool activity is not proof of a request-specific failure.
  Object.assign(trace.metadata,{connectionFailureObserved:true,connectionId:list[0].connectionId,
    connectionAttemptMs:Math.max(0,performance.now()-list[0].started),transportPhase:'connect-failed'});
  if(/^[A-Z0-9_]{1,80}$/.test(error?.code || ''))trace.metadata.connectionErrorCode=error.code;
  diagnostics.record({event:'model.transport-connect-error',requestId:trace.requestId,purpose:trace.purpose,...trace.metadata});
 });
 subscribe('undici:client:connected',({socket,connectParams})=>{
  const trace=scope.getStore();
  const key=JSON.stringify([connectParams.host,connectParams.protocol,connectParams.port]);
  const pending=trace && attempts.get(trace), list=pending?.get(key);
  // Undici copies connectParams between events. Only pair an unambiguous
  // attempt within its async scope; pooled concurrent attempts stay unknown.
  const attempt=list?.length===1?list[0]:undefined;pending?.delete(key);
  connections.set(socket,{connectionId:attempt?.connectionId || randomUUID(),uses:0,
   ...(attempt?{connectionEstablishMs:Math.max(0,performance.now()-attempt.started)}:{}),observedNew:true});
 });
 subscribe('undici:client:sendHeaders',({request,socket})=>{
  const trace=requests.get(request);if(!trace || trace.closed)return;
  let connection=connections.get(socket);
  if(!connection){connection={connectionId:randomUUID(),uses:0,observedNew:false};connections.set(socket,connection);}
  const elapsed=performance.now()-trace.started;
  const connectionUse=connection.uses>0?'reused':connection.observedNew?'new':'unknown';
  connection.uses++;
  Object.assign(trace.metadata,{requestHeadersSent:true,transportPhase:'sending',connectionId:connection.connectionId,connectionUse,requestSendStartMs:elapsed,
   ...(connectionUse==='new' && connection.connectionEstablishMs!==undefined?{connectionEstablishMs:connection.connectionEstablishMs}:{})});
  trace.sendStarted=performance.now();
  diagnostics.record({event:'model.transport-send',requestId:trace.requestId,purpose:trace.purpose,...trace.metadata});
 });
 subscribe('undici:request:bodySent',({request})=>{
  const trace=requests.get(request);if(!trace || trace.closed)return;
  trace.bodySentAt=performance.now();
  Object.assign(trace.metadata,{requestBodySent:true,transportPhase:'waiting-response',requestBodySentMs:trace.bodySentAt-trace.started,
   ...(trace.sendStarted===undefined?{}:{requestUploadMs:trace.bodySentAt-trace.sendStarted})});
  diagnostics.record({event:'model.transport-body-sent',requestId:trace.requestId,purpose:trace.purpose,...trace.metadata});
 });
 subscribe('undici:request:headers',({request})=>{
  const trace=requests.get(request);if(!trace || trace.closed)return;
  if(trace.bodySentAt!==undefined)trace.metadata.responseWaitMs=performance.now()-trace.bodySentAt;
 });
}
function observeTransport({url,requestId,purpose,metadata}) {
 install();
 const trace={origin:new URL(url).origin,requestId,purpose,metadata,started:performance.now(),closed:false};
 return {
  run:operation=>scope.run(trace,operation),
  finish(){if(trace.bodySentAt!==undefined && metadata.responseWaitMs===undefined)metadata.responseWaitMs=performance.now()-trace.bodySentAt;trace.closed=true;},
 };
}
module.exports={observeTransport};
