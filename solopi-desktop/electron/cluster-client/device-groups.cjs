'use strict';
// Local deterministic group registry/admission. No Connector, scheduler, model loop or device I/O.
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {prepareWorkflowExecution}=require('../workflow-execution-gate');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ulid=/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const error=(code,message=code)=>Object.assign(new Error(message),{code});
function text(v,name,max=256){if(typeof v!=='string'||!v.trim()||v.length>max)throw error('GROUP_INVALID',name);return v.trim();}
function json(value){
  function visit(v){
    if(v===null||typeof v==='string'||typeof v==='boolean')return v;
    if(typeof v==='number'&&Number.isFinite(v))return v;
    if(Array.isArray(v))return v.map(visit);
    if(v&&Object.getPrototypeOf(v)===Object.prototype)return Object.fromEntries(Object.keys(v).sort().map(k=>[k,visit(v[k])]));
    throw error('GROUP_INVALID','JSON values required');
  }
  return JSON.stringify(visit(value));
}
const digest=v=>createHash('sha256').update(json(v)).digest('hex');
const copy=v=>JSON.parse(json(v));
const id=v=>{if(!uuid.test(v))throw error('GROUP_INVALID','UUIDv4 required');return v;};
function members(input){
  if(!Array.isArray(input)||input.length<1||input.length>128)throw error('GROUP_INVALID','1..128 explicit members required');
  const ids=new Set(),sources=new Set();
  return input.map(m=>{
    if(!m||!ulid.test(m.deviceId))throw error('GROUP_INVALID','deviceId must be stable ULID');
    const role=text(m.role,'role',64),sourceIdentity=text(m.sourceIdentity,'sourceIdentity',256);
    if(ids.has(m.deviceId)||sources.has(sourceIdentity))throw error('GROUP_DUPLICATE_MEMBER');
    ids.add(m.deviceId);sources.add(sourceIdentity);return {deviceId:m.deviceId,role,sourceIdentity};
  }).sort((a,b)=>a.deviceId.localeCompare(b.deviceId));
}
class DeviceGroupStore {
  constructor({directory,clientId}){
    if(!directory||!ulid.test(clientId))throw error('GROUP_INVALID','explicit directory and Desktop clientId required');
    fs.mkdirSync(directory,{recursive:true,mode:0o700});this.clientId=clientId;
    this.db=new DatabaseSync(path.join(directory,'device-groups.sqlite'));fs.chmodSync(path.join(directory,'device-groups.sqlite'),0o600);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.db.exec([
      'CREATE TABLE IF NOT EXISTS group_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;',
      'CREATE TABLE IF NOT EXISTS device_group (group_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,deleted INTEGER NOT NULL,body TEXT NOT NULL) STRICT;',
      'CREATE TABLE IF NOT EXISTS group_execution (execution_id TEXT PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,task_id TEXT NOT NULL UNIQUE,plan_sha TEXT NOT NULL,phase TEXT NOT NULL,body TEXT NOT NULL) STRICT;',
      'CREATE TABLE IF NOT EXISTS group_reservation (device_id TEXT PRIMARY KEY,execution_id TEXT NOT NULL REFERENCES group_execution(execution_id),serial TEXT NOT NULL UNIQUE) STRICT;',
      "CREATE TRIGGER IF NOT EXISTS group_execution_immutable BEFORE UPDATE ON group_execution WHEN NEW.execution_id IS NOT OLD.execution_id OR NEW.request_id IS NOT OLD.request_id OR NEW.task_id IS NOT OLD.task_id OR NEW.plan_sha IS NOT OLD.plan_sha OR json_extract(NEW.body,'$.groupExecutionId') IS NOT OLD.execution_id OR json_extract(NEW.body,'$.requestId') IS NOT OLD.request_id OR json_extract(NEW.body,'$.taskId') IS NOT OLD.task_id OR json_extract(NEW.body,'$.clientId') IS NOT json_extract(OLD.body,'$.clientId') OR json_extract(NEW.body,'$.createdAt') IS NOT json_extract(OLD.body,'$.createdAt') OR json_extract(NEW.body,'$.groupSnapshot') IS NOT json_extract(OLD.body,'$.groupSnapshot') OR json_extract(NEW.body,'$.payload') IS NOT json_extract(OLD.body,'$.payload') BEGIN SELECT RAISE(ABORT,'GROUP_IMMUTABLE_EXECUTION'); END;",
      'CREATE TABLE IF NOT EXISTS group_projection_outbox(seq INTEGER PRIMARY KEY,route TEXT NOT NULL,body TEXT NOT NULL,acked INTEGER NOT NULL DEFAULT 0) STRICT;',
      'CREATE TABLE IF NOT EXISTS group_event (seq INTEGER PRIMARY KEY AUTOINCREMENT,at_ms INTEGER NOT NULL,body TEXT NOT NULL) STRICT;'
    ].join('\n'));
    try{this.tx(()=>{
      const row=this.db.prepare("SELECT value FROM group_meta WHERE key='clientId'").get();
      if(row&&row.value!==clientId)throw error('GROUP_OWNER_MISMATCH');
      this.db.prepare("INSERT OR IGNORE INTO group_meta VALUES ('clientId',?)").run(clientId);
      this.db.prepare("INSERT OR IGNORE INTO group_meta VALUES ('schemaVersion','1')").run();
      if(this.db.prepare("SELECT value FROM group_meta WHERE key='schemaVersion'").get().value!=='1')throw error('GROUP_STORE_VERSION');
    });}catch(e){this.db.close();throw e;}
  }
  tx(fn){this.db.exec('BEGIN IMMEDIATE');try{const r=fn();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  event(type,data){
    const seq=Number(this.db.prepare('INSERT INTO group_event(at_ms,body) VALUES (?,?)').run(Date.now(),json({type,clientId:this.clientId,...data})).lastInsertRowid);
    const cleanMembers=items=>items.map(({deviceId,role})=>({deviceId,role}));
    let route,wire;
    if(type==='group.saved'||type==='group.removed'){
      const g=this.get(data.groupId);route='/v1/group-registrations';wire={clientId:g.clientId,groupId:g.groupId,revision:g.revision,name:g.alias||g.name,deleted:g.deleted,members:cleanMembers(g.members)};
    }else if(data.groupExecutionId){
      const r=this.execution(data.groupExecutionId);route='/v1/group-executions';wire={groupExecutionId:r.groupExecutionId,clientId:r.clientId,groupSnapshot:{groupId:r.groupSnapshot.groupId,revision:r.groupSnapshot.revision,members:cleanMembers(r.groupSnapshot.members)},requestId:r.requestId,taskId:r.taskId,phase:r.phase,eventSeq:seq,...(r.stopRequestedAt?{stopRequestedAt:r.stopRequestedAt}:{}),...(r.receipt?{receipt:r.receipt}:{})};
    }
    if(wire)this.db.prepare('INSERT INTO group_projection_outbox(seq,route,body) VALUES (?,?,?)').run(seq,route,json(wire));
  }
  get(groupId){const r=this.db.prepare('SELECT body FROM device_group WHERE group_id=?').get(id(groupId));return r?JSON.parse(r.body):null;}
  list(){return this.db.prepare('SELECT body FROM device_group WHERE deleted=0 ORDER BY group_id').all().map(r=>JSON.parse(r.body));}
  save({groupId=randomUUID(),expectedRevision,name,members:input,alias,code,enabled}, receipt){
    id(groupId);if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw error('GROUP_INVALID','expectedRevision required');
    const nextMembers=members(input),nextName=text(name,'name',128);
    return this.tx(()=>{
      const old=this.get(groupId);if((old?.revision??0)!==expectedRevision)throw error('GROUP_REVISION_CONFLICT');
      if(old?.deleted)throw error('GROUP_DELETED');
      const optional=(value,prior,max)=>value===undefined?(prior||''):value===''?'':text(value,'group metadata',max);
      const nextAlias=optional(alias,old?.alias,128),nextCode=optional(code,old?.code,128),nextEnabled=enabled===undefined?(old?.enabled!==false):enabled;
      if(typeof nextEnabled!=='boolean')throw error('GROUP_INVALID','enabled must be boolean');
      if(nextCode&&this.list().some(g=>g.groupId!==groupId&&g.code===nextCode))throw error('GROUP_CODE_CONFLICT');
      if(old&&this.db.prepare("SELECT 1 FROM group_execution WHERE json_extract(body,'$.groupSnapshot.groupId')=? AND phase NOT IN ('prepared','done')").get(groupId))throw error('GROUP_BUSY','An active or unresolved execution owns this group');
      const body={clientId:this.clientId,groupId,revision:expectedRevision+1,name:nextName,alias:nextAlias,code:nextCode,enabled:nextEnabled,members:nextMembers,deleted:false};
      this.db.prepare('INSERT INTO device_group VALUES (?,?,0,?) ON CONFLICT(group_id) DO UPDATE SET revision=excluded.revision,body=excluded.body').run(groupId,body.revision,json(body));
      this.event('group.saved',{groupId,revision:body.revision});if(receipt)receipt(copy(body));return copy(body);
    });
  }
  remove(groupId,expectedRevision){return this.tx(()=>{
    const old=this.get(groupId);if(!old||old.deleted)throw error('GROUP_NOT_FOUND');
    if(old.revision!==expectedRevision)throw error('GROUP_REVISION_CONFLICT');
    const body={...old,revision:old.revision+1,deleted:true};
    this.db.prepare('UPDATE device_group SET revision=?,deleted=1,body=? WHERE group_id=?').run(body.revision,json(body),groupId);
    this.event('group.removed',{groupId,revision:body.revision});return copy(body);
  });}
  execution(executionId){const r=this.db.prepare('SELECT body FROM group_execution WHERE execution_id=?').get(id(executionId));return r?JSON.parse(r.body):null;}
  putExecution(rec){this.db.prepare('UPDATE group_execution SET phase=?,body=? WHERE execution_id=?').run(rec.phase,json(rec),rec.groupExecutionId);}
  prepare({groupId,expectedRevision,requestId,taskId,payload={}}){
    id(groupId);id(requestId);id(taskId);if(!payload||Object.getPrototypeOf(payload)!==Object.prototype)throw error('GROUP_INVALID','payload object required');if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)throw error('GROUP_INVALID');
    const planSha=digest({groupId,expectedRevision,requestId,taskId,payload});
    return this.tx(()=>{
      const prior=this.db.prepare('SELECT plan_sha,body FROM group_execution WHERE request_id=?').get(requestId);
      if(prior){if(prior.plan_sha!==planSha)throw error('GROUP_EXECUTION_CONFLICT');return {...JSON.parse(prior.body),duplicate:true};}
      if(this.db.prepare('SELECT 1 FROM group_execution WHERE task_id=?').get(taskId))throw error('GROUP_EXECUTION_CONFLICT');
      const group=this.get(groupId);if(!group||group.deleted)throw error('GROUP_NOT_FOUND');
      if(group.revision!==expectedRevision)throw error('GROUP_REVISION_CONFLICT');
      if(group.enabled===false)throw error('GROUP_DISABLED');
      const roles=new Set();for(const m of group.members){if(!['phone','glasses'].includes(m.role)||roles.has(m.role))throw error('GROUP_RUNNER_UNSUPPORTED','current runner supports one device per phone/glasses role');roles.add(m.role);}
      const rec={clientId:this.clientId,groupExecutionId:randomUUID(),requestId,taskId,phase:'prepared',groupSnapshot:group,payload:copy(payload),createdAt:new Date().toISOString()};
      this.db.prepare('INSERT INTO group_execution VALUES (?,?,?,?,?,?)').run(rec.groupExecutionId,requestId,taskId,planSha,rec.phase,json(rec));
      this.event('group.execution.prepared',{groupExecutionId:rec.groupExecutionId,groupId,revision:group.revision});return copy(rec);
    });
  }
  requestStop(executionId){return this.tx(()=>{
    const rec=this.execution(executionId);if(!rec)throw error('GROUP_EXECUTION_NOT_FOUND');
    if(rec.phase==='done'||rec.stopRequestedAt)return rec;
    rec.stopRequestedAt=new Date().toISOString();this.putExecution(rec);this.event('group.execution.stop-requested',{groupExecutionId:executionId});return rec;
  });}
  eventsSince(cursor=0,limit=100){if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isSafeInteger(limit)||limit<1||limit>1000)throw error('GROUP_INVALID');return this.db.prepare('SELECT seq,at_ms,body FROM group_event WHERE seq>? ORDER BY seq LIMIT ?').all(cursor,limit).map(r=>({seq:r.seq,atMs:r.at_ms,...JSON.parse(r.body)}));}
  close(){this.db.close();} // Closing persistence never claims a native task/lease has stopped.
}
class DeviceGroupExecution {
  constructor({store,gate,resolveMember}){if(!gate?.acquire||typeof resolveMember!=='function')throw error('GROUP_INVALID');Object.assign(this,{store,gate,resolveMember});this.leases=new Map();this.restoreReservations();}
  restoreReservations(){
    // Broker bootstrap only, before accepting any execution entry. A missing in-memory lease is not release evidence.
    for(const r of this.store.db.prepare('SELECT DISTINCT execution_id FROM group_reservation').all()){
      if(this.leases.has(r.execution_id))continue;
      const rec=this.store.execution(r.execution_id);
      this.leases.set(r.execution_id,this.gate.acquire({id:rec.taskId,status:'reconciliation-required',reservedDeviceSerials:rec.resolvedMembers.map(m=>m.serial)}));
    }
  }
  admit(executionId){
    const rec=this.store.execution(executionId);if(!rec)throw error('GROUP_EXECUTION_NOT_FOUND');
    if(rec.phase==='prepared'&&rec.stopRequestedAt)throw error('GROUP_STOP_REQUESTED');
    if(rec.phase!=='prepared')return {...rec,duplicate:true,needsReconciliation:rec.phase!=='done'};
    const resolved=rec.groupSnapshot.members.map(m=>{
      const live=this.resolveMember(copy(m),this.store.clientId);
      if(!live||live.clientId!==this.store.clientId||live.deviceId!==m.deviceId||live.sourceIdentity!==m.sourceIdentity)throw error('GROUP_DEVICE_IDENTITY_MISMATCH');
      if(live.online!==true)throw error('GROUP_DEVICE_OFFLINE');
      return {...m,serial:text(live.serial,'resolved serial')};
    });
    if(new Set(resolved.map(m=>m.serial)).size!==resolved.length)throw error('GROUP_DEVICE_IDENTITY_MISMATCH');
    const devices=Object.fromEntries(resolved.map(m=>[m.role,{serial:m.serial}]));
    const nativePayload=prepareWorkflowExecution({...copy(rec.payload),devices});
    const serials=resolved.map(m=>m.serial).sort();
    if(json([...nativePayload.reservedDeviceSerials].sort())!==json(serials))throw error('GROUP_PAYLOAD_OUTSIDE_SNAPSHOT');
    let lease;
    try{const admitted=this.store.tx(()=>{
      const current=this.store.execution(executionId);if(current.phase==='prepared'&&current.stopRequestedAt)throw error('GROUP_STOP_REQUESTED');if(current.phase!=='prepared')return {...current,duplicate:true,needsReconciliation:current.phase!=='done'};
      for(const m of resolved)if(this.store.db.prepare('SELECT 1 FROM group_reservation WHERE device_id=? OR serial=?').get(m.deviceId,m.serial))throw error('GROUP_BUSY');
      lease=this.gate.acquire({id:rec.taskId,name:rec.groupSnapshot.name,status:'admitted',reservedDeviceSerials:serials});
      for(const m of resolved)this.store.db.prepare('INSERT INTO group_reservation VALUES (?,?,?)').run(m.deviceId,executionId,m.serial);
      const next={...current,phase:'dispatching',resolvedMembers:resolved,admittedAt:new Date().toISOString()};this.store.putExecution(next);
      this.store.event('group.execution.admitted',{groupExecutionId:executionId});return {...next,nativePayload};
    });if(lease)this.leases.set(executionId,lease);return admitted;}catch(e){lease?.release();throw e;}
  }
  finish(executionId,receipt){
    if(receipt?.terminal!==true||receipt?.resourcesReleased!==true||!['succeeded','failed','cancelled'].includes(receipt.outcome))throw error('GROUP_RECONCILIATION_REQUIRED');
    const next=this.store.tx(()=>{
      const rec=this.store.execution(executionId);if(!rec)throw error('GROUP_EXECUTION_NOT_FOUND');
      if(receipt.taskId!==rec.taskId)throw error('GROUP_EXECUTION_CONFLICT');
      if(rec.phase==='done'){if(digest(rec.receipt)!==digest(receipt))throw error('GROUP_EXECUTION_CONFLICT');return rec;}
      if(!['dispatching','unknown'].includes(rec.phase)&&!(rec.phase==='prepared'&&rec.stopRequestedAt&&receipt.outcome==='cancelled'))throw error('GROUP_RECONCILIATION_REQUIRED');
      const next={...rec,phase:'done',receipt:copy(receipt),endedAt:new Date().toISOString()};this.store.putExecution(next);
      this.store.db.prepare('DELETE FROM group_reservation WHERE execution_id=?').run(executionId);
      this.store.event('group.execution.finished',{groupExecutionId:executionId,outcome:receipt.outcome});return next;
    });this.leases.get(executionId)?.release();this.leases.delete(executionId);return next;
  }
  async run(input,execute){
    const prepared=this.store.prepare(input),rec=this.admit(prepared.groupExecutionId);
    if(rec.duplicate)return rec;
    try{const receipt=await execute(copy(rec));return this.finish(rec.groupExecutionId,receipt);}
    catch(e){this.store.tx(()=>{const latest=this.store.execution(rec.groupExecutionId);if(latest.phase!=='done'){this.store.putExecution({...latest,phase:'unknown'});this.store.event('group.execution.unknown',{groupExecutionId:rec.groupExecutionId});}});throw e;}
  }
}
// Read-only thin adapter over the existing DeviceSnapshot identity resolver. Caller owns discovery/queue.
async function resolveSnapshotMembers({snapshot,clientId,groupMembers,discover,signal}){
  const owner=json(snapshot.data.owner);if(snapshot.data.owner?.clientId!==clientId)throw error('GROUP_OWNER_MISMATCH');
  const input=members(groupMembers),observed=await discover(signal),resolved=new Map();signal?.throwIfAborted();
  for(const m of input){
    const mappings=Object.entries(snapshot.data.mappings).filter(([,v])=>v.deviceId===m.deviceId);
    if(mappings.length!==1||mappings[0][0]!==m.sourceIdentity)throw error('GROUP_DEVICE_IDENTITY_MISMATCH');
    let target;try{target=await snapshot.resolveDevice(m.deviceId,async()=>observed,signal);}catch(e){if(signal?.aborted)throw e;throw error(e.code==='DEVICE_NOT_AVAILABLE'?'GROUP_DEVICE_OFFLINE':'GROUP_DEVICE_IDENTITY_MISMATCH');}
    resolved.set(m.deviceId,{clientId,deviceId:m.deviceId,sourceIdentity:m.sourceIdentity,serial:target.serial,online:true});
  }
  if(json(snapshot.data.owner)!==owner)throw error('GROUP_OWNER_MISMATCH');
  return {observedAt:new Date().toISOString(),resolveMember(m,ownerId){
    if(ownerId!==clientId||json(snapshot.data.owner)!==owner)throw error('GROUP_OWNER_MISMATCH');
    const matches=Object.entries(snapshot.data.mappings).filter(([,v])=>v.deviceId===m.deviceId);
    if(matches.length!==1||matches[0][0]!==m.sourceIdentity)throw error('GROUP_DEVICE_IDENTITY_MISMATCH');
    return resolved.has(m.deviceId)?copy(resolved.get(m.deviceId)):null;
  }};
}
module.exports={DeviceGroupStore,DeviceGroupExecution,resolveSnapshotMembers};
