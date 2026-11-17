'use strict';
const {createHash,randomUUID}=require('node:crypto');
const error=code=>Object.assign(new Error(code),{code});
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const digest=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
// References are generated from the active native library, never a second case store.
function caseReference(state,c){
 const components=c.components||state.components||[];
 return {caseId:c.id,name:c.name||c.id,revision:digest({case:c,components}),flow:{nodes:(c.steps||[]).map((s,i)=>({id:s.id,name:s.name||components.find(x=>x.id===s.componentId)?.name||s.type||s.id,type:s.type||s.componentId||'step',position:s.position||{x:i*240,y:0}})),edges:c.edges||state.caseEdges?.[c.id]||[]}};
}
function classifyDevices(rows,connection){
 const groups=connection?.groupService?.store.list()||[],mappings=connection?.deviceReporter?.data.mappings||{};
 return rows.map(d=>{const fingerprint='sha256:'+createHash('sha256').update('android:ro.serialno\0'+d.stableId.trim()).digest('hex'),id=mappings[fingerprint]?.deviceId;
  const roles=new Set(groups.flatMap(g=>g.members.filter(m=>m.deviceId===id&&m.sourceIdentity===fingerprint).map(m=>m.role)).filter(r=>['phone','glasses'].includes(r)));
  return {...d,kind:roles.size===1?[...roles][0]:d.kind};
 });
}
async function catalog({connection,readState,hostname,signal,includeDevices=true}){
 const rows=includeDevices?await connection.discoverDevices(signal):[],mappings=connection.deviceReporter.data.mappings;
 const devices=rows.map(d=>{const fingerprint='sha256:'+createHash('sha256').update('android:ro.serialno\0'+d.stableId.trim()).digest('hex'),m=mappings[fingerprint];if(!m)throw error('DEVICE_IDENTITY_NOT_PUBLISHED');return {deviceId:m.deviceId,name:d.name||d.serial,serial:d.serial,kind:d.kind||'other',sourceIdentity:fingerprint};});
 const state=readState()||{};
 return {hostname,contextModel:!!state.llmProviders?.length,devices,groups:connection.groupService.store.list(),cases:(state.cases||[]).map(c=>caseReference(state,c))};
}
async function saveGroup({connection,input}){
 if(input.confirm!==true)throw error('GROUP_ROLE_CONFIRMATION_REQUIRED');
 const live=await catalog({connection,readState:()=>({}),hostname:''}),roles=new Set();
 const members=input.members.map(m=>{const d=live.devices.find(d=>d.deviceId===m.deviceId);if(!d)throw error('DEVICE_NOT_AVAILABLE');if(!['phone','glasses'].includes(m.role)||roles.has(m.role))throw error('GROUP_ROLE_UNSUPPORTED');roles.add(m.role);return {deviceId:m.deviceId,role:m.role,sourceIdentity:d.sourceIdentity};});
 const group=connection.groupService.store.save({groupId:input.groupId||randomUUID(),expectedRevision:input.expectedRevision,name:input.name,members,alias:input.alias,code:input.code,enabled:input.enabled});
 await connection.groupService.publish(connection.connector);if(connection.lab)connection.lab.lastCatalog=0;
 return {success:true,group};
}
async function groupBinding(connection,input,signal){
 const group=connection.groupService?.store.get(input.groupId);
 if(!group||group.deleted)throw error('GROUP_NOT_FOUND');if(group.revision!==input.expectedRevision)throw error('GROUP_REVISION_CONFLICT');if(group.enabled===false)throw error('GROUP_DISABLED');
 const devices={};for(const m of group.members){if(!['phone','glasses'].includes(m.role)||devices[m.role])throw error('GROUP_ROLE_UNSUPPORTED');const mapping=connection.deviceReporter.data.mappings[m.sourceIdentity];if(mapping?.deviceId!==m.deviceId)throw error('GROUP_DEVICE_IDENTITY_MISMATCH');const resolved=await connection.deviceReporter.resolveDevice(m.deviceId,connection.discoverDevices,signal);devices[m.role]={serial:resolved.serial,runtime:'android'};}
 return {clientId:connection.connector.state.clientId,groupId:group.groupId,revision:group.revision,members:group.members.map(({deviceId,role})=>({deviceId,role})),devices};
}
function executionTools(connection,context={}){
 const props={groupId:{type:'string'},caseIds:{type:'array',minItems:1,maxItems:100,items:{type:'string'},uniqueItems:true},name:{type:'string'},options:{type:'object',properties:{startOptions:{type:'object',properties:Object.fromEntries(['keepScreenAwake','recordPhoneScreen','recordGlassesScreen','showPhoneScreen','showGlassesScreen'].map(x=>[x,{type:'boolean'}])),additionalProperties:false},stress:{type:'object',properties:{mode:{enum:['rounds','duration']},value:{type:'integer',minimum:1}},required:['mode','value'],additionalProperties:false}},additionalProperties:false}};
 return [{name:'create_execution_task',description:'在本电脑真实设备组执行正式用例。与用户手动创建完全相同的任务。先查询用例和设备组，使用实际ID；返回taskId/taskUrl，不能重复提交来等结果。',schema:{type:'object',properties:props,required:['groupId','caseIds'],additionalProperties:false},confirm:true,operationReceipt:{kind:'lab-execution-task',key:args=>({groupId:args.groupId,caseIds:[...args.caseIds].sort(),options:args.options||{}}),lookupId:id=>'agent-'+id,acknowledged:r=>typeof r.taskId==='string'},execute:async(args,{operationId,signal})=>{
  const session=connection.connector.session;if(!session)throw error('SESSION_REQUIRED');
  const task=await connection.connector.call('POST','/v1/lab/client-tasks',{sessionId:session.sessionId,epoch:session.epoch,input:{...args,requestId:operationId,clientId:connection.connector.state.clientId,source:'agent',...(context.chatCommandId?{originCommandId:context.chatCommandId}:{})}},session.sessionId,signal);
  return {success:true,taskId:task.taskId,status:task.status,taskUrl:task.taskUrl||connection.connector.config.serverUrl+'/#/execution/'+encodeURIComponent(task.taskId)};
 }}];
}
function planningTools(){return [{name:'propose_execution_plan',description:'给Server提交执行计划，仅引用输入catalog中的正式caseId和真实groupId/clientId。每个子任务是一个设备组上的正式用例执行。信息不足时tasks为空并说明reason。',schema:{type:'object',properties:{reason:{type:'string',maxLength:2000},tasks:{type:'array',maxItems:16,items:{type:'object',properties:{clientId:{type:'string'},groupId:{type:'string'},name:{type:'string'},caseIds:{type:'array',minItems:1,maxItems:100,uniqueItems:true,items:{type:'string'}}},required:['clientId','groupId','caseIds'],additionalProperties:false}}},required:['tasks'],additionalProperties:false},execute:async proposal=>({success:true,proposal})}];}
module.exports={caseReference,catalog,saveGroup,executionTools,planningTools,classifyDevices,groupBinding};
