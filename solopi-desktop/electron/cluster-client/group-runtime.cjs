'use strict';
// Main-owned group subscriber; driven by the existing Desktop heartbeat, no timer/Agent loop.
const {GroupDispatchConsumer}=require('./group-dispatch.cjs');
const {GroupGrantProvider}=require('./group-grant-provider.cjs');
const {bindingFromConsumerEnvelope,checkGrantVerdict}=require('./group-grant-contract.cjs');
const fail=code=>Object.assign(new Error(code),{code});
class GroupRuntime {
 constructor({directory,connector,service,trustedExecution=()=>false,authority=null}){
  if(connector.state.clientId!==service.clientId)throw fail('GROUP_OWNER_MISMATCH');
  Object.assign(this,{connector,service,trustedExecution,authority});this.closed=false;this.readReady=false;this.active=new Map();this.errors=new Map();this.queue=Promise.resolve();
  this.bridge=new GroupGrantProvider({getSession:()=>this.session(),call:(...args)=>connector.call(...args),normalize:bindingFromConsumerEnvelope,checkVerdict:checkGrantVerdict,trustedExecution:(...a)=>this.readReady&&trustedExecution(...a)===true});
  this.consumer=new GroupDispatchConsumer({directory,clientId:service.clientId,service,grantBridge:this.bridge});
  this.consumer.db.exec("CREATE TABLE IF NOT EXISTS group_transport_cursor(subscriber TEXT PRIMARY KEY CHECK(subscriber='group'),seq INTEGER NOT NULL CHECK(seq>=0)) STRICT; INSERT OR IGNORE INTO group_transport_cursor VALUES('group',0)");
 }
 session(){
  if(this.closed)return null;const raw=this.connector.session,clientId=this.connector.state.clientId;
  if(!raw||clientId!==this.service.clientId)return null;
  if(this.raw!==raw||this.handle?.sessionId!==raw.sessionId||this.handle?.epoch!==raw.epoch){this.raw=raw;this.handle={clientId,sessionId:raw.sessionId,epoch:raw.epoch};}
  return this.handle;
 }
 same(s){if(!s||this.session()!==s)throw fail('GROUP_RECONCILIATION_REQUIRED');}
 tick(signal){const p=this.queue.then(()=>this.poll(signal));this.queue=p.catch(()=>{});return p;}
 async cancel(item,ctx){
  if(item.cancelRequestedAt==null)return;
  const v=this.consumer.validate({...item.clientWire,clientId:item.clientId,dispatchId:item.dispatchId,memberSha256:item.memberSha256,cancelRequestedAt:item.cancelRequestedAt});
  this.consumer.tx(()=>this.consumer.putCancel({...v,cancelRequestedAt:item.cancelRequestedAt},'pending-transport'));await this.consumer.driveCancel(v.requestId);
 }
 async poll(signal){
  if(this.closed)return {status:'closed'};this.readReady=false;const s=this.session();this.same(s);
  const ctx={clientId:s.clientId,epoch:s.epoch,signal};
  let more=true,pages=0;
  while(more){if(++pages>10000)throw fail('GROUP_RECONCILIATION_REQUIRED');
   const seq=this.consumer.db.prepare("SELECT seq FROM group_transport_cursor WHERE subscriber='group'").get().seq;
   const page=await this.connector.groupEvents(seq,signal);this.same(s);
   for(const e of page.events){
    if(e.type==='group.dispatch.cancel-requested'&&e.epoch!==s.epoch){
     // Historical stop fact is delivered over the current authenticated owner stream.
     // Keep its original epoch; never relabel a historical requested event as current.
     this.consumer.tx(()=>this.consumer.putCancel(e.data,'historical-event'));await this.consumer.driveCancel(e.data.requestId);
    }else if(['group.dispatch.requested','group.dispatch.cancel-requested'].includes(e.type)&&e.epoch===s.epoch)await this.consumer.ingest(e,ctx);
    this.same(s);this.consumer.db.prepare("UPDATE group_transport_cursor SET seq=? WHERE subscriber='group'").run(e.seq);
   }more=page.hasMore;
  }
  await this.consumer.reconcilePending(async cursor=>{
   const page=await this.connector.call('GET','/v1/group-dispatches?'+new URLSearchParams({clientId:s.clientId,...cursor}),undefined,s.sessionId,signal);this.same(s);
   if(!Array.isArray(page?.items))throw fail('GROUP_INVALID');
   for(const item of page.items)await this.cancel(item,ctx);
   // Missing mirror state is not proof of successful catch-up. Preserve known stops,
   // but never admit new execution on 503, absent state, or any non-null mirror error.
   if(page.items.some(i=>!Object.hasOwn(i,'mirrorError')||i.mirrorError!==null))throw fail('GROUP_RECONCILIATION_REQUIRED');
   return page;
  },ctx);this.same(s);this.readReady=true;
  for(const r of this.consumer.db.prepare("SELECT request_id FROM dispatch_inbox WHERE wire IS NOT NULL AND phase!='done'").all()){
   if(this.active.has(r.request_id))continue;
   const p=(async()=>{const row=this.consumer.row(r.request_id);if(this.authority&&row.phase==='received'&&!row.cancel_at)await this.authority.prepare(row.wire,ctx);return this.consumer.execute(r.request_id,ctx);})().then(()=>this.errors.delete(r.request_id)).catch(e=>{this.errors.set(r.request_id,/^[A-Z_]+$/.test(e.code||'')?e.code:'GROUP_RECONCILIATION_REQUIRED');}).finally(()=>this.active.delete(r.request_id));
   this.active.set(r.request_id,p);
  }
  return {status:'reconciled',active:this.active.size,blocked:[...this.errors.values()].length};
 }
 async close(){
  this.closed=true;this.readReady=false;this.authority?.invalidate();await this.queue;
  for(const id of this.active.keys()){const rec=this.service.request(id);if(rec)await this.service.stop(rec.groupExecutionId);}
  await Promise.allSettled([...this.active.values()]);await this.consumer.close();this.authority?.close();
 }
}
module.exports={GroupRuntime};
