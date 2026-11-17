'use strict';
// Local selection -> existing owner-session dispatch API. Never executes, grants or resubmits unknown work.
const {createHash}=require('node:crypto');
const {digest,libraryOf}=require('../case-edit-guard');
const {assertImportReviewed}=require('../solopi-case-converter');
const {deterministicWaitOnly}=require('./group-native-authority.cjs');
const fail=code=>Object.assign(new Error(code),{code});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const canonical=v=>JSON.stringify(v,(_k,x)=>x&&Object.getPrototypeOf(x)===Object.prototype?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
function matchesSubmittedSelection(store,metadata){
 const db=store.db;if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='local_group_submission'").get())return false;
 const row=db.prepare('SELECT selection,cancel_at FROM local_group_submission WHERE request_id=?').get(metadata.binding.requestId);if(!row)return false;if(row.cancel_at)return false;
 const s=JSON.parse(row.selection),refs=metadata.caseRefs.map(c=>({caseId:c.caseId,libraryId:c.libraryId,revision:c.libraryRevision,contentSha256:c.contentSha256}));
 return s.clientId===metadata.binding.clientId&&s.groupId===metadata.binding.groupId&&s.revision===metadata.binding.expectedRevision&&s.configurationSha256===metadata.configurationSha256&&canonical(s.cases)===canonical(refs);
}
class GroupSubmission {
 constructor({store,connector,readState,waitForState,assets,publish,stopLocal,readTask=()=>null}){
  Object.assign(this,{store,connector,readState,waitForState,assets,publish,stopLocal,readTask});this.queue=Promise.resolve();
  store.db.exec("CREATE TABLE IF NOT EXISTS local_group_submission(request_id TEXT PRIMARY KEY,selection TEXT NOT NULL,wire_sha TEXT NOT NULL,phase TEXT NOT NULL,dispatch_id TEXT,cancel_at TEXT,created_at TEXT NOT NULL) STRICT;");
 }
 session(){const raw=this.connector.session;if(!raw||typeof raw.sessionId!=='string'||!raw.sessionId||!Number.isSafeInteger(raw.epoch)||raw.epoch<1||this.connector.state.clientId!==this.store.clientId)throw fail('SESSION_REQUIRED');return {raw,id:raw.sessionId,epoch:raw.epoch};}
 fresh(s){const n=this.session();if(n.raw!==s.raw||n.id!==s.id||n.epoch!==s.epoch)throw fail('GROUP_RECONCILIATION_REQUIRED');}
 row(id){return this.store.db.prepare('SELECT * FROM local_group_submission WHERE request_id=?').get(id);}
 async selection(req,s){
  if(!uuid.test(req.groupId)||!Number.isSafeInteger(req.expectedRevision)||req.expectedRevision<1||!Array.isArray(req.caseIds)||!req.caseIds.length||req.caseIds.length>8||new Set(req.caseIds).size!==req.caseIds.length||req.caseIds.some(x=>typeof x!=='string'||!x||Buffer.byteLength(x)>128))throw fail('GROUP_INVALID');
  await this.waitForState();const a=await this.assets();this.fresh(s);const group=this.store.get(req.groupId);
  if(!group||group.deleted)throw fail('GROUP_NOT_FOUND');if(group.revision!==req.expectedRevision)throw fail('GROUP_REVISION_CONFLICT');
  const roles=new Set();for(const m of group.members){const d=a.devices.find(d=>d.deviceId===m.deviceId);if(!d?.confirmation||d.confirmation.role!==m.role||d.sourceIdentity!==m.sourceIdentity)throw fail('GROUP_LOCAL_CONFIRMATION_REQUIRED');if(!['phone','glasses'].includes(m.role)||roles.has(m.role))throw fail('GROUP_RUNNER_UNSUPPORTED');roles.add(m.role);}
  const state=this.readState(),cases=[],refs=[];
  for(const id of req.caseIds){const found=(state.cases||[]).filter(c=>c.id===id);if(found.length!==1)throw fail('GROUP_CASE_NOT_FOUND');const c=found[0];assertImportReviewed(c);const libraryId=libraryOf(state,c),libs=(state.caseLibraries||[]).filter(l=>l.id===libraryId),lib=libs[0];if(libs.length!==1||!lib||!/^[0-9a-f]{64}$/.test(lib.localRevision||''))throw fail('GROUP_AUTHORIZATION_REQUIRED');cases.push(c);refs.push({caseId:id,libraryId,revision:lib.localRevision,contentSha256:digest(state,c)});}
  if(!deterministicWaitOnly({cases,configuration:{caseEdges:state.caseEdges||{}}}))throw fail('GROUP_RUNNER_UNSUPPORTED');
  const payload={cases:cases.map(c=>({id:c.id,steps:c.steps}))};if(Buffer.byteLength(canonical(payload))>262144)throw fail('GROUP_INVALID');
  return JSON.parse(canonical({wire:{clientId:this.store.clientId,groupId:group.groupId,expectedRevision:group.revision,requestId:req.requestId,payload},summary:{clientId:this.store.clientId,groupId:group.groupId,revision:group.revision,members:group.members.map(({deviceId,role})=>({deviceId,role})),cases:refs,configurationSha256:hash({components:state.components||[],caseEdges:state.caseEdges||{},llmProviders:state.llmProviders||[],selectedLlmProviderId:state.selectedLlmProviderId||'',ttsProvider:state.ttsProvider||null})}}));
 }
 invoke(req){if(req?.action==='cancel')return this.handle(req);const work=()=>this.handle(req);const p=this.queue.then(work);this.queue=p.catch(()=>{});return p;}
 async handle(req){
  const fields={catalog:['action','offset','limit'],list:['action'],prepare:['action','requestId','groupId','expectedRevision','caseIds'],submit:['action','requestId','groupId','expectedRevision','caseIds'],status:['action','requestId'],detail:['action','requestId'],cancel:['action','requestId']};
  if(!req||Object.getPrototypeOf(req)!==Object.prototype||!fields[req.action]||Object.keys(req).some(k=>!fields[req.action].includes(k))||(!['list','catalog'].includes(req.action)&&!uuid.test(req.requestId)))throw fail('GROUP_INVALID');
  const s=this.session();if(req.action==='catalog'){
   const offset=req.offset??0,limit=req.limit??50;if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>200)throw fail('GROUP_INVALID');
   await this.waitForState();const a=await this.assets();this.fresh(s);const state=this.readState(),all=state.cases||[];
   const cases=all.slice(offset,offset+limit).map(c=>{const libraryId=libraryOf(state,c),libs=(state.caseLibraries||[]).filter(l=>l.id===libraryId);let reason=null;try{assertImportReviewed(c);}catch{reason='IMPORT_REVIEW_REQUIRED';}if(libs.length!==1||!/^[0-9a-f]{64}$/.test(libs[0]?.localRevision||''))reason='GROUP_AUTHORIZATION_REQUIRED';if(!reason&&!deterministicWaitOnly({cases:[c],configuration:{caseEdges:state.caseEdges||{}}}))reason='GROUP_RUNNER_UNSUPPORTED';return {caseId:c.id,name:c.name||'',libraryId,revision:libs.length===1?libs[0].localRevision:null,contentSha256:digest(state,c),eligible:reason===null,reason};});
   return {clientId:this.store.clientId,cases,total:all.length,nextOffset:offset+limit<all.length?offset+limit:null,groups:a.groups||this.store.list(),executionApproved:false};
  }if(req.action==='list')return this.store.db.prepare('SELECT request_id FROM local_group_submission ORDER BY created_at DESC').all().map(r=>this.summary(r.request_id));if(req.action==='status')return this.status(req.requestId,s);if(req.action==='detail')return this.detail(req.requestId,s);
  if(req.action==='cancel'){
   const r=this.row(req.requestId);if(!r)throw fail('GROUP_NOT_FOUND');
   this.store.db.prepare('UPDATE local_group_submission SET cancel_at=COALESCE(cancel_at,?) WHERE request_id=?').run(new Date().toISOString(),req.requestId);
   if(r.phase==='preparing'){this.store.db.prepare("UPDATE local_group_submission SET phase='cancelled-before-send' WHERE request_id=?").run(req.requestId);return {...this.summary(req.requestId),cancelDelivery:'not-required',actualStopConfirmed:false};}
   const local=this.store.db.prepare('SELECT body FROM group_execution WHERE request_id=?').get(req.requestId);if(local)await this.stopLocal?.(JSON.parse(local.body));
   try{await this.connector.call('POST','/v1/group-dispatches/cancel',{clientId:this.store.clientId,requestId:req.requestId},s.id);this.fresh(s);}catch{return {...this.summary(req.requestId),cancelDelivery:'unknown',actualStopConfirmed:false};}
   return {...this.summary(req.requestId),cancelDelivery:'accepted',actualStopConfirmed:false};
  }
  const prepared=await this.selection(req,s),sha=hash(prepared.wire),old=this.row(req.requestId);
  if(old&&old.wire_sha!==sha)throw fail('GROUP_EXECUTION_CONFLICT');
  if(req.action==='prepare')return {...prepared.summary,requestId:req.requestId,payloadSha256:hash(prepared.wire.payload),executionApproved:false};
  if(old)return this.status(req.requestId,s); // Durable sending/unknown never emits another POST.
  this.store.tx(()=>this.store.db.prepare("INSERT INTO local_group_submission VALUES (?,?,?,'preparing',NULL,NULL,?)").run(req.requestId,canonical(prepared.summary),sha,new Date().toISOString()));
  await this.publish();this.fresh(s);
  const again=await this.selection(req,s);if(hash(again)!==hash(prepared))throw fail('GROUP_EXECUTION_CONFLICT');
  if(this.row(req.requestId).cancel_at)return this.summary(req.requestId);
  this.store.db.prepare("UPDATE local_group_submission SET phase='sending' WHERE request_id=?").run(req.requestId);
  let ack;try{ack=await this.connector.call('POST','/v1/group-dispatches',prepared.wire,s.id);this.fresh(s);}catch{this.store.db.prepare("UPDATE local_group_submission SET phase='unknown' WHERE request_id=?").run(req.requestId);return this.summary(req.requestId);}
  if(ack?.accepted!==true||ack.requestId!==req.requestId||!uuid.test(ack.dispatchId)){this.store.db.prepare("UPDATE local_group_submission SET phase='unknown' WHERE request_id=?").run(req.requestId);throw fail('GROUP_RECONCILIATION_REQUIRED');}
  this.store.db.prepare("UPDATE local_group_submission SET phase='accepted',dispatch_id=? WHERE request_id=?").run(ack.dispatchId,req.requestId);return this.summary(req.requestId);
 }
 summary(id){const r=this.row(id);if(!r)throw fail('GROUP_NOT_FOUND');const rec=this.store.db.prepare('SELECT body FROM group_execution WHERE request_id=?').get(id);const execution=rec?JSON.parse(rec.body):null;const task=execution?this.readTask(execution.taskId):null;
  const evidence=execution&&task?.groupExecution?.groupExecutionId?require('./group-task-evidence.cjs').projectGroupTask(execution,task):null;
  return {requestId:id,dispatchId:r.dispatch_id,submission:r.phase,cancelRequestedAt:r.cancel_at,selection:JSON.parse(r.selection),groupExecutionId:execution?.groupExecutionId||null,taskId:execution?.taskId||null,phase:execution?.phase||null,outcome:execution?.receipt?.outcome||null,task,evidence};
 }
 async detail(id,s){
  const r=this.row(id);if(!r)throw fail('GROUP_NOT_FOUND');
  const selection=JSON.parse(r.selection);
  const d=await this.connector.call('GET','/v1/group-dispatches-by-request/'+id,undefined,s.id);this.fresh(s);
  if(!d||d.requestId!==id||d.clientId!==this.store.clientId||d.groupId!==selection.groupId||d.expectedRevision!==selection.revision||!uuid.test(d.dispatchId)||(r.dispatch_id&&d.dispatchId!==r.dispatch_id))throw fail('GROUP_EXECUTION_CONFLICT');
  const local=this.store.db.prepare('SELECT body FROM group_execution WHERE request_id=?').get(id);
  if(local){const execution=JSON.parse(local.body);if(d.taskUid!==execution.taskId||(d.execution&&(d.execution.taskId!==execution.taskId||d.execution.groupExecutionId!==execution.groupExecutionId)))throw fail('GROUP_EXECUTION_CONFLICT');}
  // Server receipt/reference is evidence, never a command, URL or stop confirmation.
  return {...this.summary(id),serverDetail:d};
 }
 async status(id,s){const r=this.row(id);if(!r)throw fail('GROUP_NOT_FOUND');let cursor={},seen=new Set();
  for(let page=0;page<10000;page++){const p=await this.connector.call('GET','/v1/group-dispatches?'+new URLSearchParams({clientId:this.store.clientId,limit:'200',...cursor}),undefined,s.id);this.fresh(s);if(!Array.isArray(p?.items)||p.items.length>200)throw fail('GROUP_RECONCILIATION_REQUIRED');
   const found=p.items.find(x=>x.clientWire?.requestId===id||x.requestId===id);if(found){if(found.mirrorError!==null)throw fail('GROUP_RECONCILIATION_REQUIRED');const wire=found.clientWire;if(found.clientId!==this.store.clientId||!wire||hash({clientId:found.clientId,groupId:wire.groupId,expectedRevision:wire.expectedRevision,requestId:wire.requestId,payload:wire.payload})!==r.wire_sha||!uuid.test(found.dispatchId))throw fail('GROUP_EXECUTION_CONFLICT');if(r.dispatch_id&&r.dispatch_id!==found.dispatchId)throw fail('GROUP_EXECUTION_CONFLICT');this.store.db.prepare("UPDATE local_group_submission SET phase='accepted',dispatch_id=? WHERE request_id=?").run(found.dispatchId,id);return this.summary(id);}
   if(!Object.hasOwn(p,'nextCursor'))throw fail('GROUP_RECONCILIATION_REQUIRED');if(p.nextCursor===null)return this.summary(id);if(!p.nextCursor||Object.keys(p.nextCursor).some(k=>!['afterCreatedMs','afterDispatchUid'].includes(k))||!Number.isSafeInteger(p.nextCursor.afterCreatedMs)||p.nextCursor.afterCreatedMs<0||!uuid.test(p.nextCursor.afterDispatchUid)||seen.has(canonical(p.nextCursor)))throw fail('GROUP_RECONCILIATION_REQUIRED');seen.add(canonical(p.nextCursor));cursor=p.nextCursor;
  }throw fail('GROUP_RECONCILIATION_REQUIRED');
 }
}
module.exports={GroupSubmission,matchesSubmittedSelection};
