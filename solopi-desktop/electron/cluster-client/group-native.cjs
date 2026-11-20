'use strict';
// Private Main adapter. No IPC/remote dispatch authority; host owns the existing native runner.
const {DatabaseSync}=require('node:sqlite');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=code=>Object.assign(new Error(code),{code});
const canonical=v=>JSON.stringify(v,(_k,x)=>x&&Object.getPrototypeOf(x)===Object.prototype?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
class GroupNative {
 constructor({directory,host}){
  for(const k of ['prepare','run','recover','stop'])if(typeof host?.[k]!=='function')throw fail('GROUP_NATIVE_UNAVAILABLE');
  fs.mkdirSync(directory,{recursive:true,mode:0o700});this.host=host;this.db=new DatabaseSync(path.join(directory,'native.sqlite'));fs.chmodSync(path.join(directory,'native.sqlite'),0o600);
  this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS native_group_request(request_id TEXT PRIMARY KEY,task_id TEXT NOT NULL UNIQUE,payload TEXT NOT NULL,phase TEXT NOT NULL,execution_id TEXT UNIQUE,receipt TEXT) STRICT;');
  this.running=new Map();
 }
 tx(fn){this.db.exec('BEGIN IMMEDIATE');try{const r=fn();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 async prepare(requestId,payload){
  if(!uuid.test(requestId)||!payload||Object.getPrototypeOf(payload)!==Object.prototype)throw fail('GROUP_INVALID');
  const body=canonical(payload);
  const row=this.tx(()=>{const old=this.db.prepare('SELECT * FROM native_group_request WHERE request_id=?').get(requestId);if(old){if(old.payload!==body)throw fail('GROUP_EXECUTION_CONFLICT');return old;}
   // This is the native task allocation point, not a Server/caller fabricated identity.
   const taskId=randomUUID();this.db.prepare("INSERT INTO native_group_request VALUES (?,?,?,'prepared',NULL,NULL)").run(requestId,taskId,body);return {request_id:requestId,task_id:taskId,payload:body,phase:'prepared'};});
  // Retrying this deterministic native-record write is safe; it must never execute a task.
  if(row.phase==='prepared')await this.host.prepare({requestId,taskId:row.task_id,payload:JSON.parse(row.payload)});
  return {requestId,taskId:row.task_id};
 }
 row(rec){const r=this.db.prepare('SELECT * FROM native_group_request WHERE request_id=?').get(rec.requestId);if(!r||r.task_id!==rec.taskId||r.payload!==canonical(rec.payload)||(r.execution_id&&r.execution_id!==rec.groupExecutionId))throw fail('GROUP_EXECUTION_CONFLICT');return r;}
 async execute(rec){
  const row=this.tx(()=>{const r=this.row(rec);if(r.phase!=='prepared')return r;this.db.prepare("UPDATE native_group_request SET phase='dispatching',execution_id=? WHERE request_id=?").run(rec.groupExecutionId,rec.requestId);return {...r,fresh:true};});
  if(!row.fresh)return this.recover(rec); // Unknown is never resubmitted.
  const operation=Promise.resolve().then(()=>this.host.run(rec));this.running.set(rec.taskId,operation);
  try{const receipt=await operation;return this.accept(rec,receipt);}finally{this.running.delete(rec.taskId);}
 }
 accept(rec,r){
  if(r?.taskId!==rec.taskId||r.terminal!==true||r.resourcesReleased!==true||!['succeeded','failed','cancelled'].includes(r.outcome))throw fail('GROUP_RECONCILIATION_REQUIRED');
  this.tx(()=>{this.row(rec);this.db.prepare("UPDATE native_group_request SET phase='done',receipt=? WHERE request_id=?").run(canonical(r),rec.requestId);});return r;
 }
 async recover(rec){const r=this.row(rec);if(r.receipt)return JSON.parse(r.receipt);const receipt=await this.host.recover(rec);if(!receipt)throw fail('GROUP_RECONCILIATION_REQUIRED');return this.accept(rec,receipt);}
 async stop(rec){this.row(rec);await this.host.stop(rec);/* intent/ack alone is not a terminal receipt */return {stopRequested:true,taskId:rec.taskId};}
 close(){if(this.running.size)throw fail('GROUP_RECONCILIATION_REQUIRED');this.db.close();}
}
module.exports={GroupNative};
