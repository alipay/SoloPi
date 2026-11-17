'use strict';
// Durable transport around the SAME native platform API used by Desktop and CLI.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const error=code=>Object.assign(new Error(code),{code});
const readTools=new Set(['list_cases','read_case','list_components','read_task_result','read_performance_report','list_device_groups','read_configuration','list_tasks','read_task_report','read_case_results','search_task_log','search_task_logs','read_case_artifact','read_support_export']);
const isReadCommand=c=>c?.kind==='tool'&&(readTools.has(c.payload?.tool)||c.payload?.tool==='export_support_bundle');
const compactReadReceipt=rec=>{if(rec.acked&&rec.command?.kind==='tool'&&readTools.has(rec.command.payload?.tool)){delete rec.reply;rec.phase='acknowledged';const {commandId,clientId,kind}=rec.command;rec.command={commandId,clientId,kind,payload:{tool:rec.command.payload.tool}};}};
const endState=s=>({success:'succeeded',failed:'failed',stopped:'cancelled',cancelled:'cancelled'})[s]||null;
function caseSteps(native,c){
 const rows=[...(c.results||[])];
 if(['running','stopping'].includes(native.status)&&native.currentCaseId===c.caseId&&native.currentStepId&&!rows.some(r=>r.stepId===native.currentStepId))rows.push({stepId:native.currentStepId,stepName:native.currentStepName,status:'running'});
 return rows;
}
function projectTask(native,selection){
 const binding=native.groupExecution;const members=items=>hash(items.map(({deviceId,role})=>({deviceId,role})).sort((a,b)=>a.deviceId.localeCompare(b.deviceId)));
 if(!binding||binding.clientId!==selection.clientId||binding.groupId!==selection.group.groupId||binding.revision!==selection.group.revision||members(binding.members||[])!==members(selection.group.members))throw error('GROUP_TASK_BINDING_MISMATCH');
 const expected=selection.cases.map(c=>c.caseId),actual=native.caseIds||(native.cases||[]).map(c=>c.caseId);
 if(native.id!==selection.taskId||actual.length!==expected.length||actual.some(id=>!expected.includes(id)))throw error('TASK_BINDING_MISMATCH');
 return {taskId:native.id,status:native.executionFinalized===false?'running':endState(native.status)||'running',progress:{completed:native.completed||0,total:native.total||expected.length,status:native.status,currentCaseId:native.currentCaseId||null,currentStepId:native.currentStepId||null,currentStepName:native.currentStepName||null,phase:native.executionFinalized===false&&endState(native.status)?'finalizing':native.currentStepId?'executing':'preparing',startedAt:native.startedAt||null,finishedAt:native.finishedAt||null},report:{nativeGroup:binding,summary:native.summary||null,error:native.error||null,caseIds:expected,devices:native.devices||null,cases:(native.cases||[]).map(c=>({caseId:c.caseId,name:c.caseName||c.name||c.caseSnapshot?.name||c.caseId,status:c.status,flow:selection.cases.find(x=>x.caseId===c.caseId)?.flow||null,steps:caseSteps(native,c).map(r=>({stepId:r.stepId,name:r.stepName||r.name||r.stepId,status:r.status||(r.success===true?'success':r.success===false?'failed':'pending'),error:r.error||null,startedAt:r.startedAt||null,finishedAt:r.finishedAt||r.completedAt||r.endedAt||null,durationMs:r.durationMs??null,output:typeof r.output==='string'?r.output.slice(0,32000):typeof r.stdout==='string'?r.stdout.slice(0,32000):null})),recordings:(c.artifacts?.recordings||[]).map((r,i)=>({recordingId:String(i),role:r.deviceType||r.role||null,available:false,duration:r.durationSeconds||null}))}))}};
}
class LabClient{
 constructor({directory,connector,catalog,resolveDevice,api,readTask,chatExecutor,planExecutor,inferContext,onState=()=>{}}){
  Object.assign(this,{directory,connector,catalog,resolveDevice,api,readTask,chatExecutor,planExecutor,inferContext,onState});fs.mkdirSync(directory,{recursive:true,mode:0o700});this.file=path.join(directory,'state.json');this.state=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{clientId:connector.state.clientId,records:{}};if(this.state.clientId!==connector.state.clientId)throw error('CLIENT_IDENTITY_CHANGED');this.active=new Map();this.closed=false;this.lastCatalog=0;
 }
 save(){for(const rec of Object.values(this.state.records))compactReadReceipt(rec);const temp=this.file+'.tmp';const fd=fs.openSync(temp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(this.state));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,this.file);}
 async call(method,route,body,signal){const s=this.connector.session;if(!s)throw error('SESSION_REQUIRED');return this.connector.call(method,route,body?{...body,sessionId:s.sessionId,epoch:s.epoch}:undefined,s.sessionId,signal);}
 async catalogWrite(build,signal){
  const pending=(this.catalogWriteJob||Promise.resolve()).catch(()=>{}).then(async()=>{signal?.throwIfAborted();const catalog=await build();signal?.throwIfAborted();await this.call('POST','/v1/lab/catalog',{catalog},signal);return catalog;});
  this.catalogWriteJob=pending;return pending;
 }
 async publish(signal){const version=this.caseCatalogVersion||0,discovered=await this.catalog(signal);const catalog=await this.catalogWrite(async()=>version===(this.caseCatalogVersion||0)?discovered:{...discovered,cases:(await this.catalog(signal,{includeDevices:false})).cases},signal);this.lastCatalog=Date.now();return catalog;}
 async publishCases(signal){return this.catalogWrite(async()=>({section:'cases',cases:(await this.catalog(signal,{includeDevices:false})).cases}),signal);}
 async tick(signal){
  if(this.closed)return;signal?.throwIfAborted();
  // Device discovery must not block queued report/log reads or stop requests.
  // Execution still refreshes and validates the live catalog inside submit().
  if(!this.catalogJob && Date.now()-this.lastCatalog>10000 && Date.now()>=(this.catalogRetryAfter||0)){
   this.catalogController=new AbortController();
   const discoverySignal=signal?AbortSignal.any([signal,this.catalogController.signal]):this.catalogController.signal;
   this.catalogJob=this.publish(discoverySignal).then(()=>{this.catalogErrorCode=null;this.catalogRetryAfter=0;},e=>{
    if(!discoverySignal.aborted){this.catalogErrorCode=e.code||'LAB_CATALOG_UNAVAILABLE';this.catalogRetryAfter=Date.now()+10000;}
   }).finally(()=>{this.catalogJob=null;});
  }
  signal?.throwIfAborted();
  const blockedCommandIds=[];const queue=await this.call('GET','/v1/lab/queue',null,signal);if(!Array.isArray(queue.items))throw error('LAB_PROTOCOL_INVALID');
  for(const command of [...queue.items].sort((a,b)=>(isReadCommand(a)?(['read_support_export','export_support_bundle'].includes(a.payload.tool)?1:2):0)-(isReadCommand(b)?(['read_support_export','export_support_bundle'].includes(b.payload.tool)?1:2):0))){if(isReadCommand(command)&&!this.active.has(command.commandId)&&[...this.active.keys()].filter(id=>isReadCommand(this.state.records[id]?.command)).length>=4)continue;if(command.clientId!==this.state.clientId)throw error('CLIENT_IDENTITY_CHANGED');let rec=this.state.records[command.commandId];if(rec&&rec.hash!==hash(command.payload)){blockedCommandIds.push(command.commandId);continue;}if(!rec){rec={command,hash:hash(command.payload),phase:'prepared'};this.state.records[command.commandId]=rec;this.save();}
   if(rec.acked)continue;
   if(rec.reply){await this.flush(rec,signal);continue;}if(this.active.has(command.commandId))continue;
   const work=this.dispatch(rec,signal).catch(e=>{rec.error=e.code||e.message;this.save();this.onState({status:'error',errorCode:e.code||'LAB_COMMAND_FAILED'});}).finally(()=>this.active.delete(command.commandId));this.active.set(command.commandId,work);
  }
  // Monitor accepted native tasks even after their transport command has been acknowledged.
  for(const rec of Object.values(this.state.records))if(rec.command.kind==='execute-task'&&!this.active.has(rec.command.commandId)&&['submitted','unknown'].includes(rec.phase))await this.observeTask(rec,signal);
  this.onState({status:'connected',active:this.active.size,...(blockedCommandIds.length?{commandStatus:'blocked',commandErrorCode:'COMMAND_CONFLICT',blockedCommandIds}:{}),...(this.catalogErrorCode?{catalogStatus:'unavailable',catalogErrorCode:this.catalogErrorCode}:{})});
 }
 async flush(rec,signal){if(rec.reply?.status==='succeeded'&&rec.command.kind==='tool'&&['save_case','save_cases_from_file'].includes(rec.command.payload?.tool)&&rec.command.payload.args?.dryRun!==true){if(!rec.catalogInvalidated){this.caseCatalogVersion=(this.caseCatalogVersion||0)+1;rec.catalogInvalidated=true;}await this.publishCases(signal);}const started=performance.now();await this.call('POST','/v1/lab/reply',{reply:{commandId:rec.command.commandId,...rec.reply}},signal);require('../diagnostics').record({event:'lab.reply.acknowledged',requestId:rec.command.commandId,durationMs:performance.now()-started});rec.acked=true;this.save();}
 async dispatch(rec,signal){
  const c=rec.command;
  const started=performance.now();require('../diagnostics').record({event:'lab.command.started',requestId:c.commandId,toolName:c.payload?.tool,taskId:c.payload?.args?.taskId,caseId:c.payload?.args?.caseId});
  if(c.kind==='execute-task')return this.submit(rec,signal);
  if(c.kind==='context-llm'){
   if(rec.phase!=='prepared'){rec.reply={status:'failed',result:{error:'CONTEXT_MODEL_INTERRUPTED'}};this.save();return this.flush(rec,signal);}
   rec.phase='dispatching';this.save();
   try{if(!this.inferContext)throw error('CONTEXT_MODEL_UNAVAILABLE');const result=await this.inferContext(c.payload,signal);rec.reply={status:'succeeded',result};}
   catch(e){rec.reply={status:'failed',result:{error:e.code||'CONTEXT_MODEL_FAILED'}};}
   this.save();return this.flush(rec,signal);
  }
  if(c.kind==='chat'||c.kind==='plan'){
   const executor=c.kind==='plan'?this.planExecutor:this.chatExecutor;
   if(rec.phase==='prepared'){rec.phase='dispatching';rec.native={agentTaskId:c.commandId,requestId:c.commandId,task:{kind:'prompt',prompt:{text:c.kind==='plan'?'你是Server superagent的规划模型。根据用户需求自动选择真实Client、设备组与已有正式用例，必要时拆成多个组级任务。只调用一次propose_execution_plan；禁止编造ID，禁止添加未要求的压测、支付或业务动作。无法唯一确定用例范围时tasks=[]并说明需澄清的信息。这里只规划，Server将验证计划并调用统一的任务能力执行。\n需求和真实目录：'+JSON.stringify(c.payload):'你在实验室IM会话中。消息只属于本会话。执行任务必须调用create_execution_task并使用真实设备组和正式用例；不能用聊天或查询回执冒充任务。任务执行后返回taskUrl。历史仅供上下文，不自动重跑历史请求。当前用户消息：'+c.payload.text+'\n会话历史：\n'+JSON.stringify(c.payload.history)}}};this.save();
    if(c.payload.context)rec.native.task.prompt.context=c.payload.context;this.save();
    const r=await executor.execute(rec.native,{signal,persist:()=>this.save()});rec.reply={status:r.outcome==='succeeded'?'succeeded':'failed',result:{...(r.result||{}),...(r.error?{error:r.error}:{})}};this.save();
   }else{const result=await executor.recover(rec.native);if(!result){if(['MODULE_NOT_FOUND','ERR_MODULE_NOT_FOUND'].includes(rec.error)){rec.reply={status:'failed',result:{error:'Client Agent启动失败：'+rec.error}};this.save();return this.flush(rec,signal);}return;}rec.reply={status:result.outcome==='succeeded'?'succeeded':'failed',result:{...(result.result||{}),...(result.error?{error:result.error}:{})}};this.save();}
   return this.flush(rec,signal);
  }
  if(c.kind==='tool'||c.kind==='stop-task'){
   const name=c.kind==='stop-task'?'stop_task':c.payload.tool,args=c.kind==='stop-task'?{taskId:c.payload.taskId}:c.payload.args;
   let result;
   if(rec.phase==='prepared'){rec.phase='dispatching';this.save();result=await this.api({action:'call',name,arguments:args,requestId:c.commandId},signal);}
   else{const receipt=await this.api({action:'result',requestId:c.commandId},signal);if(receipt.status!=='done')return;result=receipt.result;}
   require('../diagnostics').record({event:'lab.command.completed',requestId:c.commandId,toolName:name,taskId:args?.taskId,caseId:args?.caseId,durationMs:performance.now()-started,status:result.success===false?'failed':'succeeded',code:result.errorCode});
   rec.reply={status:result.success===false?'failed':'succeeded',result};this.save();if(name==='save_device_group')this.lastCatalog=0;return this.flush(rec,signal);
  }
  throw error('LAB_COMMAND_UNSUPPORTED');
 }
 async submit(rec,signal){
  const task=rec.command.payload;
  if(rec.phase!=='prepared'){
   if(rec.phase==='dispatching'){const result=await this.api({action:'result',requestId:task.requestId},signal);if(result.status==='done'&&result.result?.taskId===task.taskId){rec.phase='submitted';this.save();}else{rec.phase='unknown';this.save();}}
   return this.observeTask(rec,signal);
  }
  try{
   rec.preflightStage='catalog';
   const live=await this.catalog(signal,{includeDevices:false}),group=live.groups.find(g=>g.groupId===task.group.groupId);
   if(!group||hash(group)!==hash(task.group))throw error('GROUP_REVISION_CHANGED');
   for(const selected of task.cases){const found=live.cases.find(c=>c.caseId===selected.caseId);if(!found||found.revision!==selected.revision)throw error('CASE_DEFINITION_CHANGED');}
   rec.preflightStage='target-devices';
   const devices={};for(const member of group.members){if(!['phone','glasses'].includes(member.role)||devices[member.role])throw error('GROUP_ROLE_UNSUPPORTED');const binding=await this.resolveDevice(member.deviceId,signal);devices[member.role]={serial:binding.serial,runtime:binding.runtime||'android'};}
   const startOptions={recordPhoneScreen:!!devices.phone,recordGlassesScreen:!!devices.glasses,...task.options?.startOptions};
   const args={groupId:group.groupId,expectedGroupRevision:group.revision,caseIds:task.cases.map(c=>c.caseId),devices,taskName:task.name,startOptions,...(task.options?.stress?{stress:task.options.stress}:{}),...(task.options?.performanceOptions?{performanceOptions:task.options.performanceOptions}:{})};
   rec.phase='dispatching';rec.arguments=args;this.save();
   const result=await this.api({action:'call',name:'submit_task',arguments:args,requestId:task.requestId},signal);
   if(result.success===false){if(result.submissionOutcome==='unknown'||result.code==='OPERATION_OUTCOME_UNKNOWN'||result.errorCode==='OPERATION_OUTCOME_UNKNOWN'){rec.phase='unknown';this.save();await this.call('POST','/v1/lab/task-state',{task:{taskId:task.taskId,status:'unknown',progress:{error:result.error||result.message}}},signal);return;}
    rec.phase='done';rec.reply={status:'failed',result};this.save();await this.call('POST','/v1/lab/task-state',{task:{taskId:task.taskId,status:'failed',report:{error:result.error||result.errorCode||'VALIDATION_FAILED',validation:result}}},signal);return this.flush(rec,signal);
   }
   if(result.taskId!==task.taskId)throw error('TASK_ID_MISMATCH');rec.phase='submitted';this.save();await this.observeTask(rec,signal);
  }catch(e){if(rec.phase!=='prepared')throw e;rec.phase='done';rec.reply={status:'failed',result:{error:e.code||e.message}};this.save();await this.call('POST','/v1/lab/task-state',{task:{taskId:task.taskId,status:'failed',report:{error:e.code||e.message,submissionOutcome:'not-submitted',stage:rec.preflightStage||'catalog'}}},signal);await this.flush(rec,signal);}
 }
 async publishTaskResult(native,signal){
  if(this.closed||!this.connector.session)return;
  const rec=Object.values(this.state.records).find(r=>r.command.kind==='execute-task'&&r.command.payload.taskId===native.id);
  if(!rec||!endState(native.status)||!native.finishedAt)return;
  // Keep archival ownership active; only the execution report is complete.
  rec.executionReadyAt=native.finishedAt;this.save();
  const projection=projectTask({...native,executionFinalized:false},rec.command.payload),digest=hash(projection);
  if(digest!==rec.lastProjection){await this.call('POST','/v1/lab/task-state',{task:{...projection,localTaskId:native.id}},signal);rec.lastProjection=digest;this.save();}
 }
 async observeTask(rec,signal){
  const native=await this.readTask(rec.command.payload.taskId);if(!native)return;
  if(rec.executionReadyAt&&(!endState(native.status)||native.finishedAt!==rec.executionReadyAt))return;
  const projection=projectTask(native,rec.command.payload),digest=hash(projection);
  if(digest!==rec.lastProjection){await this.call('POST','/v1/lab/task-state',{task:{...projection,localTaskId:native.id}},signal);rec.lastProjection=digest;this.save();}
  if(endState(native.status)&&native.executionFinalized!==false){
   await require('./lab-recordings.cjs').uploadRecordings(native,projection,{call:(...args)=>this.call(...args),devices:rec.arguments?.devices,signal});
   const complete=hash(projection);if(complete!==rec.lastProjection){await this.call('POST','/v1/lab/task-state',{task:{...projection,localTaskId:native.id}},signal);rec.lastProjection=complete;this.save();}
   rec.phase='done';rec.reply={status:'succeeded',result:{taskId:native.id,outcome:projection.status}};this.save();await this.flush(rec,signal);}
 }
 start(signal){const poll=async()=>{if(this.closed||signal.aborted)return;try{await this.tick(signal);}catch(e){this.onState({status:'error',errorCode:e.code||'LAB_CONNECTION_FAILED'});}finally{if(!this.closed&&!signal.aborted)this.timer=setTimeout(poll,250);}};void poll();return this;}
 async close(){this.closed=true;this.catalogController?.abort();clearTimeout(this.timer);await Promise.allSettled([this.chatExecutor?.close(),this.planExecutor?.close()]);await Promise.allSettled([...this.active.values()]);}
}
module.exports={LabClient,projectTask,hash};
