'use strict';
// Private native-state projection. No execution authority; never read renderer-provided task data.
const fail=()=>Object.assign(new Error('GROUP_EXECUTION_CONFLICT'),{code:'GROUP_EXECUTION_CONFLICT'});
function projectGroupTask(rec,task){
 const a=task?.groupExecution;
 if(!rec||!task||task.id!==rec.taskId||!a||a.clientId!==rec.clientId||a.requestId!==rec.requestId||a.groupExecutionId!==rec.groupExecutionId||a.groupId!==rec.groupSnapshot.groupId||a.revision!==rec.groupSnapshot.revision)throw fail();
 const cases=rec.payload?.cases;if(!Array.isArray(cases)||!Array.isArray(task.cases))throw fail();
 const members=rec.groupSnapshot.members.map(({deviceId,role})=>({deviceId,role}));
 const projected=task.cases.map(c=>{
  const source=cases.find(x=>x.id===c.caseId);if(!source||!Array.isArray(source.steps))throw fail();
  const results=Array.isArray(c.results)?c.results:[];
  return {caseId:c.caseId,steps:results.map(r=>{
   const step=source.steps.find(x=>x.id===r.stepId);if(!step||!['running','success','succeeded','passed','failed','stopped','skipped','pending'].includes(r.status))throw fail();
   // No stdout/stderr, error payload, filesystem paths or invented per-step device attribution.
   return {stepId:step.id,status:r.status};
  })};
 });
 return {requestId:rec.requestId,groupExecutionId:rec.groupExecutionId,taskId:rec.taskId,clientId:rec.clientId,groupId:rec.groupSnapshot.groupId,revision:rec.groupSnapshot.revision,members,cases:projected,reportRef:rec.receipt?.reportRef??null};
}
module.exports={projectGroupTask};
