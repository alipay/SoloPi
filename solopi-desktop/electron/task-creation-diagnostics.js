// Task creation metadata only. Never persist task names, parameters or business logs.
const {randomUUID}=require('node:crypto');
const diagnostics=require('./diagnostics');
function metadata(payload={}) {
 const performance=payload.performanceOptions || {};
 const starts=payload.startConfigOverride || {};
 return {creationId:payload.creationId,source:payload.creationSource || payload.source || 'unknown',taskId:payload.taskId,
  sourceTaskId:payload.sourceTaskId,folderId:payload.folderId,caseCount:Array.isArray(payload.cases)?payload.cases.length:payload.caseCount,
  phonePerformance:performance.phone===true,glassesPerformance:performance.glasses===true,
  threadStacks:performance.threadStacks?.enabled===true,recordPhoneScreen:starts.recordPhoneScreen===true,recordGlassesScreen:starts.recordGlassesScreen===true,
  phoneSelected:!!(payload.devices?.phone?.serial || payload.cases?.[0]?.defaults?.phoneSerial),glassesSelected:!!(payload.devices?.glasses?.serial || payload.cases?.[0]?.defaults?.glassesSerial)};
}
function recordClientEvent(payload={}) {
 if(!['clicked','rejected','accepted','ignored'].includes(payload.stage)||typeof payload.creationId!=='string'||payload.creationId.length>160)return {success:false,errorCode:'INVALID_TASK_DIAGNOSTIC'};
 diagnostics.record({...metadata(payload),event:'task.creation.client',stage:payload.stage,code:payload.code,taskId:payload.taskId});
 return {success:true};
}
function instrument(channel,handler) {
 const stage=channel==='workflow:validate-task-selection'?'validation':'submission';
 return async(event,payload={})=>{
  const start=Date.now(),meta=metadata({...payload,creationId:payload.creationId || `backend-${randomUUID()}`});
  diagnostics.record({...meta,event:'task.creation.backend',stage,status:'started'});
  try {
   const result=await handler(event,payload);
   const errors=Array.isArray(result?.validationErrors)?result.validationErrors:[];
   diagnostics.record({...meta,event:'task.creation.backend',stage,status:result?.success===true?'accepted':'rejected',taskId:result?.taskId || meta.taskId,
    code:result?.errorCode || errors[0]?.code || (result?.success===true?'OK':'TASK_REJECTED'),errorCount:errors.length,warningCount:result?.validationWarnings?.length || 0,durationMs:Date.now()-start});
   for(const error of errors.slice(0,20)) diagnostics.record({...meta,event:'task.creation.validation-error',stage,code:error.code,caseId:error.caseId,node:error.node,field:error.field});
   return result;
  }catch(error){
   diagnostics.record({...meta,event:'task.creation.backend',stage,status:'exception',code:error.code || 'IPC_EXCEPTION',errorName:error.name,durationMs:Date.now()-start});
   throw error;
  }
 };
}
module.exports={instrument,recordClientEvent,metadata};
