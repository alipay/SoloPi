'use strict';
const {DeviceGroupStore,DeviceGroupExecution,resolveSnapshotMembers}=require('./device-groups.cjs');
const error=code=>Object.assign(new Error(code),{code});
class GroupService {
 constructor({directory,clientId,gate,native,snapshot,discover}){
  try{this.store=new DeviceGroupStore({directory,clientId});
  if(this.store.db.prepare('SELECT count(*) n FROM group_event').get().n&&!this.store.db.prepare('SELECT count(*) n FROM group_projection_outbox').get().n){throw error('GROUP_RECONCILIATION_REQUIRED');}
  Object.assign(this,{clientId,gate,native,snapshot,discover});
  this.runner=new DeviceGroupExecution({store:this.store,gate,resolveMember:(...a)=>this.binding?.resolveMember(...a)});this.queue=Promise.resolve();this.publishQueue=Promise.resolve();
  }catch(e){this.store?.close();native.close();throw e;}
 }
 enqueue(fn){const p=this.queue.then(fn);this.queue=p.catch(()=>{});return p;}
 async publish(connector,signal){const work=async()=>{
  if(connector.state.clientId!==this.clientId||!connector.session)throw error('GROUP_OWNER_MISMATCH');
  for(const r of this.store.db.prepare('SELECT seq,route,body FROM group_projection_outbox WHERE acked=0 ORDER BY seq LIMIT 100').all()){
   signal?.throwIfAborted();const body=JSON.parse(r.body),session=connector.session;
   const ack=await connector.call('POST',r.route,body,session.sessionId,signal);
   if(connector.session!==session)throw error('GROUP_RECONCILIATION_REQUIRED');
   const valid=r.route.endsWith('registrations')?ack?.groupId===body.groupId&&Number.isSafeInteger(ack.currentRevision)&&ack.currentRevision>=body.revision:
    ack?.groupExecutionId===body.groupExecutionId&&ack.phase===body.phase&&Number.isSafeInteger(ack.eventSeq)&&ack.eventSeq>=body.eventSeq;
   if(!valid||ack.accepted!==true)throw error('GROUP_RECONCILIATION_REQUIRED');
   this.store.db.prepare('UPDATE group_projection_outbox SET acked=1 WHERE seq=?').run(r.seq);
  }
 };const p=this.publishQueue.then(work);this.publishQueue=p.catch(()=>{});return p;}
 // Internal Main-only entry. Server dispatch has NOT been wired or granted by this module.
 request(requestId){const row=this.store.db.prepare('SELECT body FROM group_execution WHERE request_id=?').get(requestId);return row?JSON.parse(row.body):null;}
 // Private synchronous fences: no renderer context or execution authority is created here.
 async run({groupId,expectedRevision,requestId,payload},signal,control={}){return this.enqueue(async()=>{
  const check=(phase,rec)=>{const result=control.check?.(phase,rec);if(result?.then)throw error('GROUP_INVALID');};
  signal?.throwIfAborted();const prior=this.store.db.prepare('SELECT body FROM group_execution WHERE request_id=?').get(requestId);
  const group=prior?JSON.parse(prior.body).groupSnapshot:this.store.get(groupId);if(!group||(!prior&&group.deleted))throw error('GROUP_NOT_FOUND');if(group.revision!==expectedRevision)throw error('GROUP_REVISION_CONFLICT');
  const roles=new Set();for(const m of group.members){if(!['phone','glasses'].includes(m.role)||roles.has(m.role))throw error('GROUP_RUNNER_UNSUPPORTED');roles.add(m.role);}
  await control.refresh?.('beforePrepare',{requestId,groupSnapshot:group});
  check('beforePrepare',{requestId,groupSnapshot:group});
  const ids=await this.native.prepare(requestId,payload);
  const rec=this.store.prepare({groupId,expectedRevision,...ids,payload});
  const bound=control.bind?.(rec);if(bound?.then)throw error('GROUP_INVALID');
  await control.refresh?.('afterPrepared',rec);
  check('afterPrepared',rec);
  if(rec.phase!=='prepared')return this.reconcile(rec.groupExecutionId);
  this.binding=await resolveSnapshotMembers({snapshot:this.snapshot,clientId:this.clientId,groupMembers:rec.groupSnapshot.members,discover:this.discover,signal});
  try{signal?.throwIfAborted();await control.refresh?.('beforeAdmit',rec);signal?.throwIfAborted();check('beforeAdmit',rec);return await this.runner.run({groupId,expectedRevision,...ids,payload},r=>this.native.execute(r));}finally{this.binding=null;}
 });}
 async reconcile(id){const rec=this.store.execution(id);if(!rec)throw error('GROUP_EXECUTION_NOT_FOUND');if(rec.phase==='done')return rec;const receipt=await this.native.recover(rec);return this.runner.finish(id,receipt);}
 async stop(id){const rec=this.store.requestStop(id);if(rec.phase==='done')return rec;await this.native.stop(rec);return this.store.execution(id);}
 async close(){await this.queue;await this.publishQueue;this.native.close();this.store.close();}
}
module.exports={GroupService};
