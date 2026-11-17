'use strict';
// Transport/reconciliation only. Platform receipts and HarnessRuntime own execution.
const fs=require('node:fs'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {ULID}=require('./identity.cjs');
const fail=code=>Object.assign(new Error(code),{code});
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
class AgentTasks {
  constructor({directory,connector,executor,now=Date.now}) {
    Object.assign(this,{directory,connector,executor,now});
    fs.mkdirSync(directory,{recursive:true,mode:0o700});this.file=path.join(directory,'tasks.json');
    this.state=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{version:1,clientId:connector.state.clientId,sinceId:0,seq:0,records:{}};
    if(this.state.version!==1||this.state.clientId!==connector.state.clientId)throw fail('AGENT_IDENTITY_CHANGED');
    this.active=new Map();this.closed=false;this.queue=Promise.resolve();
  }
  save(){const f=this.file+'.'+randomUUID()+'.tmp';const fd=fs.openSync(f,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(this.state));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(f,this.file);if(process.platform!=='win32'){const parent=fs.openSync(this.directory,'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}}}
  async call(method,route,body,signal){const s=this.connector.session;if(!s)throw fail('SESSION_REQUIRED');return this.connector.call(method,route,body==null?undefined:{...body,sessionId:s.sessionId,epoch:s.epoch},s.sessionId,signal);}
  tick(signal){const p=this.queue.then(()=>this.reconcile(signal));this.queue=p.catch(()=>{});return p;}
  async reconcile(signal){
    if(this.closed)return;
    for(const rec of Object.values(this.state.records)){if(!rec.reported&&Date.parse(rec.task.expiresAt)<=this.now())await this.stop(rec,'expired');if(rec.report&&!rec.reported)await this.flush(rec,signal);}
    // Separate cursor: never consume/checkpoint the media subscriber's cursor.
    let more=true;while(more){const r=await this.call('GET','/v1/events?'+new URLSearchParams({stream:'client:'+this.state.clientId,sinceSeq:String(this.state.seq),limit:'100'}),null,signal);
      if(!Array.isArray(r.events)||!Number.isSafeInteger(r.snapshotSeq))throw fail('CONTRACT_MISMATCH');
      if(Object.keys(this.state.records).length>0&&r.snapshotSeq>this.state.seq+1){for(const rec of Object.values(this.state.records))if(!rec.reported)await this.stop(rec,'event-gap');}
      for(const e of r.events){if(!Number.isSafeInteger(e.seq)||e.seq<=this.state.seq)throw fail('CONTRACT_MISMATCH');
        if(e.type==='agent.task.cancelled'){const rec=this.state.records[e.data?.agentTaskId];if(rec)await this.stop(rec,'cancelled');}
        this.state.seq=e.seq;this.save();
      }more=r.hasMore===true;
    }
    // Re-scan from zero, not only the latest cursor: delivered/running old tasks survive reconnect.
    let cursor=0;more=true;while(more){let r;try{r=await this.call('GET','/v1/agent-tasks/queue?'+new URLSearchParams({sinceId:String(cursor),limit:'100'}),null,signal);}catch(e){if(e.code!=='AGENT_TASK_INVALID')throw e;for(const rec of Object.values(this.state.records))if(!rec.reported)await this.stop(rec,'capability-denied');return;}
      if(!Array.isArray(r.items)||!Number.isSafeInteger(r.nextSinceId)||r.nextSinceId<cursor)throw fail('CONTRACT_MISMATCH');
      for(const task of r.items){if(!ULID.test(task.agentTaskId)||task.clientId!==this.state.clientId||!Number.isFinite(Date.parse(task.expiresAt))||!['tool-call','prompt'].includes(task.kind))throw fail('CONTRACT_MISMATCH');
        const digest=hash({kind:task.kind,tool:task.tool,prompt:task.prompt});let rec=this.state.records[task.agentTaskId];
        if(rec&&rec.digest!==digest)throw fail('AGENT_TASK_CONFLICT');
        if(!rec){rec={agentTaskId:task.agentTaskId,digest,requestId:randomUUID(),stopRequestId:randomUUID(),task,phase:'prepared'};this.state.records[task.agentTaskId]=rec;this.save();}
        if(!rec.reported&&!this.active.has(rec.agentTaskId))await this.dispatch(rec,signal);
      }
      if(r.hasMore&&r.nextSinceId===cursor)throw fail('CONTRACT_MISMATCH');cursor=r.nextSinceId;this.state.sinceId=Math.max(this.state.sinceId,cursor);this.save();more=r.hasMore===true;
    }
    for(const rec of Object.values(this.state.records)){
      if(!rec.reported&&Date.parse(rec.task.expiresAt)<=this.now())await this.stop(rec,'expired');
      if(rec.report&&!rec.reported)await this.flush(rec,signal);
    }
  }
  async flush(rec,signal){const reply=await this.call('POST',`/v1/agent-tasks/${rec.agentTaskId}/result`,rec.report,signal);if(reply.agentTaskId!==rec.agentTaskId)throw fail('CONTRACT_MISMATCH');rec.reported=true;rec.serverStatus=reply.status;rec.late=reply.late===true;this.save();}
  async dispatch(rec,signal){
    if(rec.phase==='prepared'){
      // Local mapping is durable before any executor/model/tool invocation.
      if(Date.parse(rec.task.expiresAt)<=this.now()){rec.phase='done';rec.report={outcome:'failed',error:'expired before dispatch'};this.save();return;}
      const reply=await this.call('POST',`/v1/agent-tasks/${rec.agentTaskId}/progress`,{note:'Client accepted; execution identity persisted'},signal);
      if(reply.status!=='running'){await this.stop(rec,reply.status);return;}
      rec.phase='dispatching';this.save();
      const controller=new AbortController();const entry={controller};this.active.set(rec.agentTaskId,entry);entry.timer=setTimeout(()=>{void this.stop(rec,'expired').catch(()=>{});},Math.max(0,Date.parse(rec.task.expiresAt)-this.now()));
      entry.promise=Promise.resolve().then(()=>this.executor.execute(rec,{signal:controller.signal,persist:()=>this.save()})).then(result=>{
        rec.report=result;rec.phase='done';this.save();
      },e=>{rec.phase='unknown';rec.errorCode=e.code||'EXECUTION_OUTCOME_UNKNOWN';this.save();}).finally(()=>{clearTimeout(entry.timer);this.active.delete(rec.agentTaskId);});
    }else if(!rec.report){
      const result=await this.executor.recover(rec); // Query existing receipt/session; NEVER resubmit unknown execution.
      if(result){rec.report=result;rec.phase='done';this.save();}else{rec.phase='unknown';this.save();}
    }
  }
  async stop(rec,reason){
    if(rec.report)return;
    if(rec.phase==='prepared'){rec.phase='done';rec.report={outcome:'failed',error:'not dispatched: '+reason,result:{stopped:true}};this.save();return;}
    if(!this.active.has(rec.agentTaskId)){const actual=await this.executor.recover(rec);if(actual){rec.report=actual;rec.phase='done';this.save();return;}}
    rec.stopReason=reason;this.save();const active=this.active.get(rec.agentTaskId);active?.controller.abort();
    const confirmed=await this.executor.stop(rec);if(active)await active.promise;
    // A server cancel receipt is NOT an executor stop confirmation.
    if(!rec.report&&confirmed){rec.phase='done';rec.report={outcome:'failed',error:'executor stopped: '+reason,result:{stopped:true}};this.save();}
  }
  async close(){this.closed=true;await this.queue;for(const rec of Object.values(this.state.records))if(!rec.report)await this.stop(rec,'desktop-closed');await Promise.all([...this.active.values()].map(x=>x.promise));}
}
module.exports={AgentTasks};
