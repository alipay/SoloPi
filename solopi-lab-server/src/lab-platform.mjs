import {notifyTaskUpdate} from './task-updates.mjs';
import {recordDiagnostic,diagnosticBundle,diagnosticScope} from './diagnostics.mjs';
import {LabArtifacts} from './lab-artifact.mjs';
import {createHash,randomUUID} from 'node:crypto';
const terminal=new Set(['succeeded','failed','cancelled']);
const sha=x=>createHash('sha256').update(JSON.stringify(x,(_k,v)=>v&&Object.getPrototypeOf(v)===Object.prototype?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)).digest('hex');
const parse=x=>JSON.parse(x);
function fail(status,code,message){throw Object.assign(new Error(message),{status,code});}
function text(x,max=1000){if(typeof x!=='string'||!x.trim()||x.length>max)fail(422,'INVALID_INPUT','invalid text');return x;}
function uuid(x){if(typeof x!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x))fail(422,'INVALID_INPUT','requestId must be UUID v4');return x;}
function array(x,max=100){if(!Array.isArray(x)||!x.length||x.length>max||new Set(x).size!==x.length)fail(422,'INVALID_INPUT','invalid selection');return x.map(v=>text(v,128));}
function keys(body,allowed){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!allowed.includes(k)))fail(422,'INVALID_INPUT','unknown request fields');}
export class LabPlatform {
 constructor(db,{contextProvider}={}){this.db=db;this.contextProvider=contextProvider;}
 tx(fn){if(this.inTransaction)return fn();this.db.exec('BEGIN IMMEDIATE');this.inTransaction=true;try{const out=fn();this.db.exec('COMMIT');return out;}catch(e){this.db.exec('ROLLBACK');throw e;}finally{this.inTransaction=false;}}
 catalog(scope,clientId){const r=this.db.prepare('SELECT * FROM lab_catalog WHERE client_uid=? AND org_uid=? AND project_uid=?').get(clientId,scope.orgId,scope.projectId);if(!r)fail(404,'CLIENT_CATALOG_MISSING','Client catalog not published');return {...parse(r.body_json),updatedAt:r.updated_at_ms};}
 catalogs(scope){return this.db.prepare('SELECT body_json,updated_at_ms FROM lab_catalog WHERE org_uid=? AND project_uid=? ORDER BY client_uid').all(scope.orgId,scope.projectId).map(r=>({...parse(r.body_json),updatedAt:r.updated_at_ms}));}
 publish(scope,clientId,body){
  if(body?.section==='cases'){
   keys(body,['section','cases']);
   if(!Array.isArray(body.cases)||Buffer.byteLength(JSON.stringify(body))>4*1024*1024)fail(422,'INVALID_INPUT','invalid case catalog');
   const current=this.catalog(scope,clientId);
   return this.publish(scope,clientId,{...current,cases:body.cases});
  }
  if(!Array.isArray(body.groups)||!Array.isArray(body.cases)||!Array.isArray(body.devices)||Buffer.byteLength(JSON.stringify(body))>4*1024*1024)fail(422,'INVALID_INPUT','invalid catalog');
  const catalog={clientId,hostname:body.hostname||clientId,contextModel:body.contextModel===true,devices:body.devices,groups:body.groups,cases:body.cases};
  this.db.prepare('INSERT INTO lab_catalog(client_uid,org_uid,project_uid,body_json,updated_at_ms) VALUES(?,?,?,?,?) ON CONFLICT(client_uid) DO UPDATE SET org_uid=excluded.org_uid,project_uid=excluded.project_uid,body_json=excluded.body_json,updated_at_ms=excluded.updated_at_ms').run(clientId,scope.orgId,scope.projectId,JSON.stringify(catalog),Date.now());return catalog;
 }
 command(scope,{commandId,clientId,kind,payload}){
  const hash=sha({clientId,kind,payload}),old=this.db.prepare('SELECT * FROM lab_command WHERE command_uid=?').get(commandId);
  if(old){if(old.org_uid!==scope.orgId||old.project_uid!==scope.projectId)fail(404,'NOT_FOUND','request not found');if(old.request_sha!==hash)fail(409,'REQUEST_CONFLICT','requestId reused with different input');return this.commandOut(old);}
  if(this.contextProvider&&['chat','plan'].includes(kind)){const context=this.contextProvider(scope,{clientId,conversationId:payload.conversationId,query:payload.text||payload.request?.text});if(context)payload={...payload,context};}
  recordDiagnostic({event:'command.queued',scopeKey:diagnosticScope(scope),requestId:commandId,clientId,toolName:payload.tool,taskId:payload.args?.taskId,caseId:payload.args?.caseId});
  const at=Date.now();this.db.prepare('INSERT INTO lab_command(command_uid,org_uid,project_uid,client_uid,kind,body_json,request_sha,status,result_json,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(commandId,scope.orgId,scope.projectId,clientId,kind,JSON.stringify(payload),hash,'queued',null,at,at);return this.commandOut(this.db.prepare('SELECT * FROM lab_command WHERE command_uid=?').get(commandId));
 }
 commandOut(r){return {commandId:r.command_uid,clientId:r.client_uid,kind:r.kind,payload:parse(r.body_json),status:r.status,result:r.result_json?parse(r.result_json):null,createdAt:r.created_at_ms,updatedAt:r.updated_at_ms};}
 getCommand(scope,id){const r=this.db.prepare('SELECT * FROM lab_command WHERE command_uid=? AND org_uid=? AND project_uid=?').get(id,scope.orgId,scope.projectId);if(!r)fail(404,'NOT_FOUND','request not found');return this.commandOut(r);}
 queue(scope,clientId){return this.db.prepare("SELECT * FROM lab_command WHERE org_uid=? AND project_uid=? AND client_uid=? AND status IN ('queued','running') ORDER BY created_at_ms,command_uid LIMIT 100").all(scope.orgId,scope.projectId,clientId).map(r=>this.commandOut(r));}
 task(scope,id){const r=this.db.prepare('SELECT body_json FROM lab_task WHERE task_uid=? AND org_uid=? AND project_uid=?').get(id,scope.orgId,scope.projectId);if(!r)fail(404,'TASK_NOT_FOUND','execution task not found');return parse(r.body_json);}
 tasks(scope){return this.db.prepare('SELECT body_json FROM lab_task WHERE org_uid=? AND project_uid=? ORDER BY created_at_ms DESC LIMIT 200').all(scope.orgId,scope.projectId).map(r=>{const t=parse(r.body_json);return {...t,report:undefined,cases:t.cases.map(({caseId,name,revision})=>({caseId,name,revision}))};});}
 createTask(scope,body){
  keys(body,['requestId','clientId','groupId','caseIds','name','options','source','originCommandId']);uuid(body.requestId);text(body.clientId,128);text(body.groupId,128);const caseIds=array(body.caseIds),hash=sha(body);
  return this.tx(()=>{
   const old=this.db.prepare('SELECT * FROM lab_task WHERE org_uid=? AND project_uid=? AND request_uid=?').get(scope.orgId,scope.projectId,body.requestId);
   if(old){if(old.request_sha!==hash)fail(409,'REQUEST_CONFLICT','requestId reused with different task');return {...parse(old.body_json),duplicate:true};}
   const catalog=this.catalog(scope,body.clientId),group=catalog.groups.find(g=>g.groupId===body.groupId&&!g.deleted);
   if(!group||!Array.isArray(group.members)||!group.members.length)fail(422,'GROUP_NOT_FOUND','select a real device group');
   if(group.enabled===false)fail(422,'GROUP_DISABLED','设备组已停用，请选择启用的设备组');
   const cases=caseIds.map(id=>{const c=catalog.cases.find(c=>c.caseId===id);if(!c)fail(422,'CASE_NOT_FOUND','case not in current Client library');return c;});
   const options=body.options||{};keys(options,['startOptions','stress','performanceOptions']);
   if(body.source!==undefined&&!['manual','agent'].includes(body.source))fail(422,'INVALID_INPUT','invalid task source');
   let origin;
   if(body.originCommandId){const c=this.getCommand(scope,uuid(body.originCommandId));if(c.kind!=='chat'||c.clientId!==body.clientId||body.source!=='agent')fail(403,'ORIGIN_SCOPE_INVALID','task origin does not belong to this Client conversation');origin={conversationId:c.payload.conversationId,messageId:c.payload.messageId,commandId:c.commandId};}
   const at=Date.now(),task={taskId:'agent-'+body.requestId,requestId:body.requestId,name:body.name?text(body.name):'设备组任务',clientId:body.clientId,group:structuredClone(group),cases:structuredClone(cases),options,source:body.source||'manual',...(origin?{origin}:{}),status:'queued',createdAt:at,updatedAt:at,progress:null,report:null};
   this.db.prepare('INSERT INTO lab_task(task_uid,org_uid,project_uid,client_uid,request_uid,request_sha,group_uid,body_json,status,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(task.taskId,scope.orgId,scope.projectId,task.clientId,task.requestId,hash,group.groupId,JSON.stringify(task),task.status,at,at);
   this.command(scope,{commandId:body.requestId,clientId:task.clientId,kind:'execute-task',payload:task});return task;
  });
 }
 updateTask(scope,clientId,body){
  const task=this.task(scope,body.taskId);if(task.clientId!==clientId)fail(403,'WRONG_CLIENT','task belongs to another Client');
  if(!['queued','running','succeeded','failed','cancelled','unknown'].includes(body.status))fail(422,'INVALID_INPUT','invalid task state');
  // A late observation cannot reverse a terminal result or rewrite its identity/bindings.
  if(terminal.has(task.status)&&body.status!==task.status)fail(409,'TASK_TERMINAL','task is terminal');
  if(body.localTaskId&&body.localTaskId!==task.taskId)fail(409,'TASK_ID_MISMATCH','native and Server taskId must be identical');
  // A pre-completion poll can arrive after the readable execution report.
  if(task.progress?.finishedAt&&['success','failed','stopped'].includes(task.progress.status)&&body.progress&&!body.progress.finishedAt)return task;
  const next={...task,status:body.status,progress:body.progress??task.progress,report:body.report??task.report,updatedAt:Date.now()};
  if(Buffer.byteLength(JSON.stringify(next))>16*1024*1024)fail(422,'PAYLOAD_TOO_LARGE','report too large');
  this.db.prepare('UPDATE lab_task SET body_json=?,status=?,updated_at_ms=? WHERE task_uid=?').run(JSON.stringify(next),next.status,next.updatedAt,task.taskId);
  if(terminal.has(next.status)&&next.origin){
   const count=next.progress?`${next.progress.completed}/${next.progress.total}`:'',outcome={succeeded:'成功',failed:'失败',cancelled:'已停止'}[next.status];
   const text=`任务「${next.name}」执行${outcome} ${count}。\n设备组：${next.group.name}\n任务链接：#/execution/${next.taskId}`+(next.report?.error?'\n原因：'+String(next.report.error).slice(0,2000):'');
   const h=sha({taskId:next.taskId,conversationId:next.origin.conversationId}),id=h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32),at=Date.now();
   this.db.prepare('INSERT INTO lab_message(message_uid,conversation_uid,sender_uid,text,status,request_uid,request_sha,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(message_uid) DO UPDATE SET text=excluded.text,updated_at_ms=excluded.updated_at_ms').run(id,next.origin.conversationId,next.clientId,text,'sent',next.taskId,sha({taskId:next.taskId}),at,at);
   this.db.prepare('UPDATE lab_conversation SET updated_at_ms=? WHERE conversation_uid=?').run(at,next.origin.conversationId);
  }
  notifyTaskUpdate(this.db,next);
  return next;
 }
 cancelTask(scope,id){const task=this.task(scope,id);if(terminal.has(task.status))return task;return this.tx(()=>{const next={...task,stopRequestedAt:task.stopRequestedAt||Date.now(),stopRequestId:task.stopRequestId||randomUUID()};this.db.prepare('UPDATE lab_task SET body_json=?,updated_at_ms=? WHERE task_uid=?').run(JSON.stringify(next),Date.now(),id);this.command(scope,{commandId:next.stopRequestId,clientId:task.clientId,kind:'stop-task',payload:{taskId:id}});return next;});}
 tool(scope,body){keys(body,['requestId','clientId','tool','args']);uuid(body.requestId);this.catalog(scope,body.clientId);if(!['list_cases','read_case','list_components','list_tasks','read_task_report','read_performance_report','read_case_results','read_case_artifact','read_task_result','search_task_log','read_task_attachments','list_device_groups','save_device_group','export_support_bundle','read_support_export','agent_runtime_config','read_configuration','save_configuration','save_case','execute_host_command','search_task_logs','list_devices','download_file','install_apk','list_packages'].includes(body.tool))fail(422,'TOOL_NOT_ALLOWED','use the unified task creation endpoint for execution');return this.command(scope,{commandId:body.requestId,clientId:body.clientId,kind:'tool',payload:{tool:body.tool,args:body.args||{}}});}
 createRequest(scope,body){
  keys(body,['requestId','text','groupId','groupName','caseName']);uuid(body.requestId);text(body.text,12000);const hash=sha(body);
  return this.tx(()=>{
   const prior=this.db.prepare('SELECT * FROM lab_request WHERE request_uid=?').get(body.requestId);
   if(prior){if(prior.org_uid!==scope.orgId||prior.project_uid!==scope.projectId)fail(404,'NOT_FOUND','request not found');if(prior.request_sha!==hash)fail(409,'REQUEST_CONFLICT','request parameters changed');return this.request(scope,body.requestId);}
   const catalogs=this.catalogs(scope).filter(c=>Date.now()-c.updatedAt<60000&&c.groups.some(g=>g.enabled!==false)&&c.cases.length);
   if(!catalogs.length)fail(422,'NO_EXECUTION_CLIENT','没有在线且具备真实设备组和用例的Client');
   const at=Date.now(),request={requestId:body.requestId,text:body.text,status:'planning',taskIds:[],createdAt:at,updatedAt:at};
   this.db.prepare('INSERT INTO lab_request(request_uid,org_uid,project_uid,request_sha,body_json,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?)').run(body.requestId,scope.orgId,scope.projectId,hash,JSON.stringify(request),at,at);
   this.command(scope,{commandId:body.requestId,clientId:catalogs[0].clientId,kind:'plan',payload:{request:body,catalogs:catalogs.map(c=>({...c,groups:c.groups.filter(g=>g.enabled!==false),cases:c.cases.map(x=>({caseId:x.caseId,name:x.name,revision:x.revision}))}))}});
   return request;
  });
 }
 request(scope,id){
  const row=this.db.prepare('SELECT body_json FROM lab_request WHERE request_uid=? AND org_uid=? AND project_uid=?').get(id,scope.orgId,scope.projectId);if(!row)fail(404,'REQUEST_NOT_FOUND','request not found');
  const request=parse(row.body_json),tasks=request.taskIds.map(id=>this.task(scope,id));
  const done=tasks.length>0&&tasks.every(t=>terminal.has(t.status));
  return {...request,status:tasks.length?(done?(tasks.every(t=>t.status==='succeeded')?'succeeded':'failed'):tasks.some(t=>t.status==='running')?'running':'queued'):request.status,terminal:done||['failed','needs-input'].includes(request.status),tasks};
 }
 applyPlan(scope,command,result){
  const request=this.request(scope,command.payload.request.requestId);
  const proposal=result?.toolCalls?.find(c=>c.name==='propose_execution_plan')?.result?.proposal;
  let status='queued',reason,taskIds=[];
  if(!proposal||!Array.isArray(proposal.tasks)||!proposal.tasks.length){status='needs-input';reason=proposal?.reason||result?.text||result?.error||'未生成可执行计划，请明确已有用例和设备组。';}
  else {
   if(proposal.tasks.length>16)fail(422,'PLAN_TOO_LARGE','too many tasks');
   // Validate the complete plan before committing any native execution request.
   const inputs=proposal.tasks.map((t,index)=>{
    keys(t,['clientId','groupId','caseIds','name','options']);const c=this.catalog(scope,t.clientId);
    if(!c.groups.some(g=>g.groupId===t.groupId)||!array(t.caseIds).every(id=>c.cases.some(c=>c.caseId===id)))fail(422,'PLAN_REFERENCE_INVALID','计划引用了不存在的设备组或正式用例');
    const h=sha({requestId:request.requestId,index});const requestId=h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);
    return {...t,requestId,source:'agent'};
   });
   taskIds=inputs.map(input=>this.createTask(scope,input).taskId);
  }
  const next={...request,status,reason,taskIds,updatedAt:Date.now()};delete next.tasks;delete next.terminal;
  this.db.prepare('UPDATE lab_request SET body_json=?,updated_at_ms=? WHERE request_uid=?').run(JSON.stringify(next),next.updatedAt,request.requestId);
 }
 conversations(scope){return this.db.prepare('SELECT * FROM lab_conversation WHERE org_uid=? AND project_uid=? ORDER BY updated_at_ms DESC').all(scope.orgId,scope.projectId).map(r=>({conversationId:r.conversation_uid,kind:r.kind,title:r.title,members:parse(r.members_json),createdAt:r.created_at_ms,updatedAt:r.updated_at_ms}));}
 conversation(scope,id){const c=this.conversations(scope).find(c=>c.conversationId===id);if(!c)fail(404,'CONVERSATION_NOT_FOUND','conversation not found');return {...c,messages:this.db.prepare('SELECT * FROM lab_message WHERE conversation_uid=? ORDER BY created_at_ms,message_uid').all(id).map(r=>({messageId:r.message_uid,sender:r.sender_uid,text:r.text,status:r.status,requestId:r.request_uid,createdAt:r.created_at_ms,updatedAt:r.updated_at_ms}))};}
 createConversation(scope,body){
  keys(body,['requestId','kind','title','members']);const id=uuid(body.requestId),members=array(body.members,32);if(!['direct','group'].includes(body.kind)||body.kind==='direct'&&members.length!==1)fail(422,'INVALID_INPUT','invalid conversation');
  for(const member of members)this.catalog(scope,member);
  const old=this.conversations(scope).find(c=>c.conversationId===id||body.kind==='direct'&&c.kind==='direct'&&c.members[0]===members[0]);
  if(old){if(old.conversationId===id&&(old.kind!==body.kind||JSON.stringify(old.members)!==JSON.stringify(members)))fail(409,'REQUEST_CONFLICT','conversation request conflict');return old;}
  const at=Date.now();this.db.prepare('INSERT INTO lab_conversation(conversation_uid,org_uid,project_uid,kind,title,members_json,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?)').run(id,scope.orgId,scope.projectId,body.kind,body.title?text(body.title):this.catalog(scope,members[0]).hostname,JSON.stringify(members),at,at);return this.conversation(scope,id);
 }
 send(scope,conversationId,body){
  keys(body,['requestId','text','recipients']);uuid(body.requestId);text(body.text,12000);const hash=sha(body);
  return this.tx(()=>{
   const c=this.conversation(scope,conversationId),prior=this.db.prepare("SELECT * FROM lab_message WHERE conversation_uid=? AND request_uid=? AND sender_uid='user'").get(conversationId,body.requestId);
   if(prior){if(prior.request_sha!==hash)fail(409,'REQUEST_CONFLICT','message request conflict');return this.conversation(scope,conversationId);}
   const recipients=body.recipients?array(body.recipients,32):c.members;if(recipients.some(x=>!c.members.includes(x)))fail(422,'INVALID_RECIPIENT','recipient is not a conversation member');
   const at=Date.now();this.db.prepare('INSERT INTO lab_message(message_uid,conversation_uid,sender_uid,text,status,request_uid,request_sha,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),conversationId,'user',body.text,'sent',body.requestId,hash,at,at);
   const history=this.conversation(scope,conversationId).messages.filter(m=>m.status==='sent').slice(-40).map(m=>({sender:m.sender,text:m.text}));
   for(const clientId of recipients){const messageId=randomUUID();this.db.prepare('INSERT INTO lab_message(message_uid,conversation_uid,sender_uid,text,status,request_uid,request_sha,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?)').run(messageId,conversationId,clientId,'','queued',body.requestId,hash,at+1,at+1);this.command(scope,{commandId:messageId,clientId,kind:'chat',payload:{conversationId,messageId,history,text:body.text}});}
   this.db.prepare('UPDATE lab_conversation SET updated_at_ms=? WHERE conversation_uid=?').run(at,conversationId);return this.conversation(scope,conversationId);
  });
 }
 reply(scope,clientId,body){
  uuid(body.commandId);const command=this.getCommand(scope,body.commandId);if(command.clientId!==clientId)fail(403,'WRONG_CLIENT','command belongs to another Client');
  if(!['running','succeeded','failed','unknown'].includes(body.status))fail(422,'INVALID_INPUT','invalid command status');
  if(terminal.has(command.status)){if(command.status!==body.status||sha(command.result)!==sha(body.result??null))fail(409,'REPLY_CONFLICT','terminal command cannot change');return command;}
  recordDiagnostic({event:'command.reply',scopeKey:diagnosticScope(scope),requestId:body.commandId,clientId,toolName:command.payload?.tool,status:body.status,durationMs:Date.now()-command.createdAt});
  return this.tx(()=>{
   this.db.prepare('UPDATE lab_command SET status=?,result_json=?,updated_at_ms=? WHERE command_uid=?').run(body.status,body.result==null?null:JSON.stringify(body.result),Date.now(),body.commandId);
   if(command.kind==='plan'){
    this.db.exec('SAVEPOINT plan_selection');
    try{this.applyPlan(scope,command,body.result);this.db.exec('RELEASE plan_selection');}
    catch(e){this.db.exec('ROLLBACK TO plan_selection');this.db.exec('RELEASE plan_selection');if(!e.status)throw e;
     const r=this.request(scope,command.payload.request.requestId),next={...r,status:'failed',reason:e.message,taskIds:[],updatedAt:Date.now()};delete next.tasks;delete next.terminal;
     this.db.prepare('UPDATE lab_request SET body_json=?,updated_at_ms=? WHERE request_uid=?').run(JSON.stringify(next),next.updatedAt,r.requestId);
    }
   }
   if(command.kind==='chat'){
    const result=body.result??{},message=typeof result.text==='string'?result.text:typeof result.error==='string'?result.error:'';
    this.db.prepare('UPDATE lab_message SET text=?,status=?,updated_at_ms=? WHERE message_uid=?').run(message,body.status==='succeeded'?'sent':body.status,Date.now(),command.payload.messageId);
    this.db.prepare('UPDATE lab_conversation SET updated_at_ms=? WHERE conversation_uid=?').run(Date.now(),command.payload.conversationId);
   }
   return this.getCommand(scope,body.commandId);
  });
 }
}
export function registerLabRoutes(route,{db,adminScope,clientScope,contextProvider}){
 const lab=new LabPlatform(db,{contextProvider}),artifacts=new LabArtifacts(db,{root:process.env.SOLOPI_LAB_ARTIFACT_ROOT,task:(scope,id)=>lab.task(scope,id)}),ok=body=>({status:200,body});
 const wrap=fn=>ctx=>{try{return ok(fn(ctx));}catch(e){if(e.status)return {status:e.status,body:{error:{code:e.code,message:e.message,retryable:false}}};throw e;}};
 route('GET','/v1/lab/diagnostics',wrap(c=>{const scope=adminScope(c);return {format:'solopi-server-diagnostics-v1',encoding:'base64',data:diagnosticBundle(scope).toString('base64')};}));
 route('POST','/v1/lab/diagnostics/events',wrap(c=>{const scope=adminScope(c);const input=c.body.input;keys(input,['event','requestId','clientId','taskId','caseId','stage','toolName','durationMs','status','polls','code']);if(input.clientId)lab.catalog(scope,input.clientId);if(!['web.read.completed','web.read.failed','web.media.failed','web.media.ready'].includes(input.event))fail(422,'INVALID_EVENT','unsupported diagnostic event');recordDiagnostic({...input,scopeKey:diagnosticScope(scope),source:'browser'});return {success:true};}));
 route('POST','/v1/lab/context-identity',wrap(c=>clientScope(c)));
 route('POST','/v1/lab/artifact-begin',wrap(c=>{const s=clientScope(c);return artifacts.begin(s.scope,s.clientId,c.body.input);}));
 route('POST','/v1/lab/artifact-chunk',wrap(c=>{const s=clientScope(c);return artifacts.chunk(s.scope,s.clientId,c.body.input);}));
 route('POST','/v1/lab/artifact-finish',wrap(c=>{const s=clientScope(c);return artifacts.finish(s.scope,s.clientId,c.body.artifactId);}));
 route('GET','/v1/lab/artifacts/{artifactId}',wrap(c=>artifacts.metadata(adminScope(c),c.params.artifactId)));
 route('POST','/v1/lab/requests',wrap(c=>lab.createRequest(adminScope(c),c.body.input)));
 route('GET','/v1/lab/requests/{requestId}',wrap(c=>lab.request(adminScope(c),c.params.requestId)));
 route('GET','/v1/lab/catalog',wrap(c=>({items:lab.catalogs(adminScope(c)).map(c=>({...c,cases:c.cases.map(({caseId,name,revision})=>({caseId,name,revision}))}))})));
 route('GET','/v1/lab/tasks',wrap(c=>({items:lab.tasks(adminScope(c))})));
 route('POST','/v1/lab/tasks',wrap(c=>lab.createTask(adminScope(c),c.body.input)));
 route('GET','/v1/lab/tasks/{taskId}',wrap(c=>lab.task(adminScope(c),c.params.taskId)));
 route('POST','/v1/lab/tasks/{taskId}/stop',wrap(c=>lab.cancelTask(adminScope(c),c.params.taskId)));
 route('POST','/v1/lab/commands',wrap(c=>lab.tool(adminScope(c),c.body.input)));
 route('POST','/v1/lab/client-tasks',wrap(c=>{const s=clientScope(c);if(c.body.input?.clientId!==s.clientId)fail(403,'WRONG_CLIENT','cannot create another Client task');return lab.createTask(s.scope,c.body.input);}));
 route('GET','/v1/lab/conversations',wrap(c=>({items:lab.conversations(adminScope(c))})));
 route('POST','/v1/lab/conversations',wrap(c=>lab.createConversation(adminScope(c),c.body.input)));
 route('GET','/v1/lab/conversations/{conversationId}',wrap(c=>lab.conversation(adminScope(c),c.params.conversationId)));
 route('POST','/v1/lab/conversations/{conversationId}/messages',wrap(c=>lab.send(adminScope(c),c.params.conversationId,c.body.input)));
 route('GET','/v1/lab/commands/{commandId}',wrap(c=>lab.getCommand(adminScope(c),c.params.commandId)));
 route('GET','/v1/lab/queue',wrap(c=>{const s=clientScope(c);return {items:lab.queue(s.scope,s.clientId)};}));
 route('POST','/v1/lab/catalog',wrap(c=>{const s=clientScope(c);return lab.publish(s.scope,s.clientId,c.body.catalog);}));
 route('POST','/v1/lab/reply',wrap(c=>{const s=clientScope(c);return lab.reply(s.scope,s.clientId,c.body.reply);}));
 route('POST','/v1/lab/task-state',wrap(c=>{const s=clientScope(c);const t=lab.updateTask(s.scope,s.clientId,c.body.task);return {taskId:t.taskId,status:t.status,updatedAt:t.updatedAt};}));
 return lab;
}
