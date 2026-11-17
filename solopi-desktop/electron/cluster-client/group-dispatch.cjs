'use strict';
// Private Main-side consumer. No HTTP routes, timers, renderer grant or device executor.
const {DatabaseSync}=require('node:sqlite');
const {createHash}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ULID=/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/,SHA=/^[0-9a-f]{64}$/;
const fail=code=>Object.assign(new Error(code),{code});
const invalid=()=>{throw fail('GROUP_INVALID');};
const plain=x=>x&&Object.getPrototypeOf(x)===Object.prototype;
function canonical(value){
 const seen=new Set();
 function visit(v){
  if(v===null||typeof v==='string'||typeof v==='boolean')return v;
  if(typeof v==='number'&&Number.isFinite(v))return v;
  if(!v||(!Array.isArray(v)&&!plain(v))||seen.has(v))return invalid();
  seen.add(v);const out=Array.isArray(v)?v.map(visit):Object.fromEntries(Object.keys(v).sort().map(k=>[k,visit(v[k])]));seen.delete(v);return out;
 }
 return JSON.stringify(visit(value));
}
const sha=v=>createHash('sha256').update(v).digest('hex');
const memberSha=members=>sha(canonical(members.map(({deviceId,role})=>({deviceId,role})).sort((a,b)=>a.deviceId.localeCompare(b.deviceId))));
function date(v){if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(v)||!Number.isFinite(Date.parse(v)))invalid();return v;}
function payload(v){
 if(!plain(v)||Object.keys(v).some(k=>k!=='cases')||!Array.isArray(v.cases)||!v.cases.length||v.cases.length>512)invalid();
 for(const c of v.cases)if(!plain(c)||Object.keys(c).some(k=>!['id','steps'].includes(k))||typeof c.id!=='string'||!Buffer.byteLength(c.id)||Buffer.byteLength(c.id)>128||!Array.isArray(c.steps)||c.steps.length>512||c.steps.some(x=>!plain(x)))invalid();
 const body=canonical(v);if(Buffer.byteLength(body)>262144)invalid();return body;
}
class GroupDispatchConsumer {
 constructor({directory,clientId,service,authorize=()=>false,grantBridge=null,checkpoint=()=>{}}){
  if(!ULID.test(clientId)||service?.clientId!==clientId||typeof authorize!=='function')invalid();
  Object.assign(this,{clientId,service,authorize,grantBridge,checkpoint});this.active=new Map();this.stopping=new Map();this.syncing=false;this.closed=false;
  fs.mkdirSync(directory,{recursive:true,mode:0o700});const file=path.join(directory,'group-dispatch.sqlite');
  this.db=new DatabaseSync(file);fs.chmodSync(file,0o600);
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS dispatch_owner(client_id TEXT PRIMARY KEY) STRICT;
   CREATE TABLE IF NOT EXISTS dispatch_inbox(request_id TEXT PRIMARY KEY,dispatch_id TEXT NOT NULL,wire TEXT,cancel_at TEXT,cancel_source TEXT,phase TEXT NOT NULL,execution_id TEXT,task_id TEXT,error TEXT) STRICT;
   CREATE TABLE IF NOT EXISTS dispatch_cursor(epoch INTEGER PRIMARY KEY,seq INTEGER NOT NULL,needs_scan INTEGER NOT NULL) STRICT;
   CREATE TABLE IF NOT EXISTS dispatch_event(epoch INTEGER NOT NULL,seq INTEGER NOT NULL,sha TEXT NOT NULL,PRIMARY KEY(epoch,seq)) STRICT;`);
  try{this.tx(()=>{const owner=this.db.prepare('SELECT client_id FROM dispatch_owner').get();if(owner&&owner.client_id!==clientId)throw fail('GROUP_OWNER_MISMATCH');if(!owner)this.db.prepare('INSERT INTO dispatch_owner VALUES (?)').run(clientId);this.db.exec('UPDATE dispatch_cursor SET needs_scan=1');});}catch(e){this.db.close();throw e;}
 }
 tx(fn){this.db.exec('BEGIN IMMEDIATE');try{const v=fn();this.db.exec('COMMIT');return v;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 context(c){if(this.closed||!plain(c)||c.clientId!==this.clientId||!Number.isSafeInteger(c.epoch)||c.epoch<1)throw fail('GROUP_OWNER_MISMATCH');const latest=this.db.prepare('SELECT max(epoch) epoch FROM dispatch_cursor').get().epoch;if(latest!=null&&c.epoch<latest)throw fail('GROUP_OWNER_MISMATCH');return c;}
 row(id){const r=this.db.prepare('SELECT * FROM dispatch_inbox WHERE request_id=?').get(id);return r?{...r,wire:r.wire?JSON.parse(r.wire):null}:null;}
 cursor(epoch){return this.db.prepare('SELECT * FROM dispatch_cursor WHERE epoch=?').get(epoch)||{seq:0,needs_scan:1};}
 validate(v){
  if(!plain(v)||v.clientId!==this.clientId)throw fail('GROUP_OWNER_MISMATCH');
  for(const k of ['dispatchId','requestId','groupId'])if(!UUID.test(v[k]))invalid();
  if(!Number.isSafeInteger(v.expectedRevision)||v.expectedRevision<1||!SHA.test(v.payloadSha256)||!SHA.test(v.dispatchPlanSha256)||(v.memberSha256!==null&&!SHA.test(v.memberSha256)))invalid();
  const body=payload(v.payload);
  if(v.payloadBytes!==Buffer.byteLength(body)||v.payloadSha256!==sha(body)||v.dispatchPlanSha256!==sha(canonical({groupId:v.groupId,expectedRevision:v.expectedRevision,requestId:v.requestId,payload:v.payload})))throw fail('GROUP_EXECUTION_CONFLICT');
  if(v.cancelRequestedAt!=null)date(v.cancelRequestedAt);
  return {clientId:v.clientId,dispatchId:v.dispatchId,requestId:v.requestId,groupId:v.groupId,expectedRevision:v.expectedRevision,payload:JSON.parse(body),payloadSha256:v.payloadSha256,payloadBytes:v.payloadBytes,dispatchPlanSha256:v.dispatchPlanSha256,memberSha256:v.memberSha256};
 }
 put(v,cancelAt,source,serverPhase='requested'){
  const old=this.row(v.requestId),body=canonical(v);
  if(old&&(old.dispatch_id!==v.dispatchId||(old.wire&&canonical(old.wire)!==body)))throw fail('GROUP_EXECUTION_CONFLICT');
  if(!old)this.db.prepare("INSERT INTO dispatch_inbox VALUES (?,?,?,?,?,?,NULL,NULL,NULL)").run(v.requestId,v.dispatchId,body,cancelAt||null,cancelAt?source:null,serverPhase==='requested'?'received':'unknown');
  else this.db.prepare("UPDATE dispatch_inbox SET wire=?,cancel_at=COALESCE(cancel_at,?),cancel_source=COALESCE(cancel_source,?),phase=CASE WHEN phase='received' AND ?!='requested' THEN 'unknown' ELSE phase END WHERE request_id=?").run(body,cancelAt||null,cancelAt?source:null,serverPhase,v.requestId);
 }
 putCancel(v,source){
  if(!plain(v)||v.clientId!==this.clientId)throw fail('GROUP_OWNER_MISMATCH');
  if(!UUID.test(v.requestId)||!UUID.test(v.dispatchId))invalid();date(v.cancelRequestedAt);
  const old=this.row(v.requestId);if(old&&old.dispatch_id!==v.dispatchId)throw fail('GROUP_EXECUTION_CONFLICT');
  if(!old)this.db.prepare("INSERT INTO dispatch_inbox VALUES (?,?,NULL,?,?,'received',NULL,NULL,NULL)").run(v.requestId,v.dispatchId,v.cancelRequestedAt,source);
  else this.db.prepare('UPDATE dispatch_inbox SET cancel_at=COALESCE(cancel_at,?),cancel_source=COALESCE(cancel_source,?) WHERE request_id=?').run(v.cancelRequestedAt,source,v.requestId);
 }
 // Caller supplies authenticated transport context, never values copied from event.data.
 async ingest(event,context){
  this.context(context);
  if(!plain(event)||event.stream!=='client:'+this.clientId||event.epoch!==context.epoch||!Number.isSafeInteger(event.seq)||event.seq<1)throw fail('GROUP_OWNER_MISMATCH');
  if(!['group.dispatch.requested','group.dispatch.cancel-requested'].includes(event.type))invalid();
  const bodySha=sha(canonical(event)),run=event.type==='group.dispatch.requested';const v=run?this.validate(event.data):event.data;
  const out=this.tx(()=>{
   const old=this.db.prepare('SELECT sha FROM dispatch_event WHERE epoch=? AND seq=?').get(event.epoch,event.seq);
   if(old){if(old.sha!==bodySha)throw fail('GROUP_EXECUTION_CONFLICT');return {duplicate:true,gap:!!this.cursor(event.epoch).needs_scan};}
   if(run)this.put(v,event.data.cancelRequestedAt,'event');else this.putCancel(v,'event');
   const c=this.cursor(event.epoch),gap=!!c.needs_scan||event.seq>c.seq+1;
   this.db.prepare('INSERT INTO dispatch_event VALUES (?,?,?)').run(event.epoch,event.seq,bodySha);
   this.db.prepare('INSERT INTO dispatch_cursor VALUES (?,?,?) ON CONFLICT(epoch) DO UPDATE SET seq=excluded.seq,needs_scan=excluded.needs_scan').run(event.epoch,Math.max(c.seq,event.seq),Number(gap));return {duplicate:false,gap};
  });
  this.checkpoint('inboxCommitted',this.row(v.requestId));
  if(!run)await this.driveCancel(v.requestId);return out;
 }
 // No run is started while a full, restart-from-zero pending pass is incomplete.
 async reconcilePending(fetchPage,context){
  this.context(context);if(this.syncing)throw fail('GROUP_BUSY');this.syncing=true;
  this.db.prepare('INSERT INTO dispatch_cursor VALUES (?,0,1) ON CONFLICT(epoch) DO UPDATE SET needs_scan=1').run(context.epoch);
  let cursor={},previous=null;
  try{for(let pageNo=0;pageNo<10000;pageNo++){
   const page=await fetchPage({limit:100,...cursor},context);this.context(context);
   if(!plain(page)||!Array.isArray(page.items)||!Object.hasOwn(page,'nextCursor')||page.items.length>100)invalid();
   const rows=page.items.map(item=>{
    if(!plain(item)||!plain(item.clientWire)||!Number.isSafeInteger(item.createdAtMs)||item.createdAtMs<0||!['requested','confirmed','dispatching','unknown'].includes(item.status))invalid();
    for(const k of ['groupId','requestId','expectedRevision','payloadSha256','payloadBytes','dispatchPlanSha256'])if(item[k]!==item.clientWire[k])throw fail('GROUP_EXECUTION_CONFLICT');
    if((item.cancelRequestedAt??null)!==(item.clientWire.cancelRequestedAt??null))throw fail('GROUP_EXECUTION_CONFLICT');
    const v=this.validate({...item.clientWire,clientId:item.clientId,dispatchId:item.dispatchId,memberSha256:item.memberSha256});
    const key=[item.createdAtMs,item.dispatchId];if(previous&&(key[0]<previous[0]||(key[0]===previous[0]&&key[1]<=previous[1])))invalid();previous=key;
    return {v,cancel:item.cancelRequestedAt,status:item.status};
   });
   const next=page.nextCursor;
   if(next!==null&&(!plain(next)||!rows.length||next.afterCreatedMs!==previous[0]||next.afterDispatchUid!==previous[1]))invalid();
   this.tx(()=>{for(const {v,cancel,status}of rows)this.put(v,cancel,'pending',status);});this.checkpoint('pageCommitted',cursor);
   for(const {v}of rows)await this.driveCancel(v.requestId);
   if(next===null){this.db.prepare('UPDATE dispatch_cursor SET needs_scan=0 WHERE epoch=?').run(context.epoch);return;}
   cursor={afterCreatedMs:next.afterCreatedMs,afterDispatchUid:next.afterDispatchUid};
  }throw fail('GROUP_RECONCILIATION_REQUIRED');}finally{this.syncing=false;}
 }
 bind(id,rec){
  const r=this.row(id);if(!r||rec.clientId!==this.clientId||rec.requestId!==id||!UUID.test(rec.taskId)||!UUID.test(rec.groupExecutionId))throw fail('GROUP_EXECUTION_CONFLICT');
  if((r.execution_id&&r.execution_id!==rec.groupExecutionId)||(r.task_id&&r.task_id!==rec.taskId))throw fail('GROUP_EXECUTION_CONFLICT');
  this.db.prepare("UPDATE dispatch_inbox SET execution_id=?,task_id=?,phase=CASE WHEN phase='done' THEN phase ELSE 'mapped' END WHERE request_id=?").run(rec.groupExecutionId,rec.taskId,id);this.checkpoint('mappingCommitted',this.row(id));
 }
 async driveCancel(id){
  if(this.stopping.has(id))return this.stopping.get(id);
  const row=this.row(id);if(!row?.cancel_at)return;
  const rec=this.service.request(id);if(!rec)return;this.bind(id,rec);
  const p=this.service.stop(rec.groupExecutionId);this.stopping.set(id,p);
  try{await p;}finally{this.stopping.delete(id);}
 }
 check(id,context,phase,rec,permit,localOnly=false){
  this.context(context);const r=this.row(id);if(!r?.wire)throw fail('GROUP_RECONCILIATION_REQUIRED');
  if(r.cancel_at&&rec.phase!=='done'){if(rec.groupExecutionId)this.service.store.requestStop(rec.groupExecutionId);throw fail('GROUP_STOP_REQUESTED');}
  if(this.cursor(context.epoch).needs_scan)throw fail('GROUP_RECONCILIATION_REQUIRED');
  const g=rec.groupSnapshot;if(!g||g.clientId!==this.clientId||g.groupId!==r.wire.groupId||g.revision!==r.wire.expectedRevision||!r.wire.memberSha256||memberSha(g.members)!==r.wire.memberSha256)throw fail('GROUP_EXECUTION_CONFLICT');
  // Trusted host must implement real approval/scope/step checks; missing provider denies.
  if(localOnly)return;
  if((this.grantBridge?this.grantBridge.check(permit,r.wire,context,phase):this.authorize(r.wire,context,phase))!==true)throw fail('GROUP_AUTHORIZATION_REQUIRED');
 }
 async execute(id,context){
  this.context(context);if(this.active.has(id))return this.active.get(id);
  const operation=this.executeOne(id,context);this.active.set(id,operation);
  try{return await operation;}finally{this.active.delete(id);}
 }
 async executeOne(id,context){
  let r=this.row(id);if(!r?.wire)throw fail('GROUP_RECONCILIATION_REQUIRED');
  if(r.phase==='done')return this.service.request(id);
  if(r.cancel_at)await this.driveCancel(id);
  const existing=this.service.request(id);
  if(existing||r.phase!=='received'){
   // A durable attempt without a receipt is UNKNOWN, including a prepare-only crash.
   if(!existing)throw fail('GROUP_RECONCILIATION_REQUIRED');this.bind(id,existing);
   const result=await this.service.reconcile(existing.groupExecutionId);return this.finish(id,result);
  }
  const permits=new Map();
  const refresh=async(phase,rec)=>{
   if(!this.grantBridge){if(phase==='beforeClaim')this.check(id,context,phase,rec);return;}
   this.check(id,context,phase,rec,undefined,true);
   if(this.grantBridge){
    const permit=await this.grantBridge.verify(this.row(id).wire,context,phase);
    const cancelAt=this.grantBridge.cancelRequestedAt(permit);
    if(cancelAt){this.tx(()=>this.putCancel({...this.row(id).wire,cancelRequestedAt:cancelAt},'grant-verdict'));await this.driveCancel(id);}
    permits.set(phase,permit);
   }
   this.check(id,context,phase,rec,permits.get(phase));
  };
  const g=this.service.store.get(r.wire.groupId);await refresh('beforeClaim',{groupSnapshot:g});
  if(this.db.prepare("UPDATE dispatch_inbox SET phase='attempting' WHERE request_id=? AND phase='received'").run(id).changes!==1)throw fail('GROUP_RECONCILIATION_REQUIRED');this.checkpoint('attemptCommitted',this.row(id));
  try{
   const result=await this.service.run(r.wire,undefined,{refresh,check:(phase,rec)=>this.check(id,context,phase,rec,permits.get(phase)),bind:rec=>this.bind(id,rec)});
   this.checkpoint('resultBeforeInbox',result);return this.finish(id,result);
  }catch(e){this.db.prepare("UPDATE dispatch_inbox SET error=?,phase=CASE WHEN phase='done' THEN phase ELSE 'unknown' END WHERE request_id=?").run(e.code||'GROUP_RECONCILIATION_REQUIRED',id);await this.driveCancel(id);throw e;}
 }
 finish(id,rec){
  this.bind(id,rec);
  if(rec.phase!=='done'||rec.receipt?.terminal!==true||rec.receipt?.resourcesReleased!==true)throw fail('GROUP_RECONCILIATION_REQUIRED');
  this.db.prepare("UPDATE dispatch_inbox SET phase='done',error=NULL WHERE request_id=?").run(id);return rec;
 }
 async close(){if(this.active.size||this.stopping.size||this.syncing)throw fail('GROUP_RECONCILIATION_REQUIRED');this.closed=true;this.db.close();}
}
module.exports={GroupDispatchConsumer};
