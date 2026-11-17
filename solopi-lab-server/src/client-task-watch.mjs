import {randomUUID} from 'node:crypto';
import continuation from './desktop-agent/task-continuation.js';

// Server storage/transport adapter for Desktop watch_operation. The pending
// command is durable: a disconnect/restart observes it instead of issuing it again.
export function observeClientTask(lab,scope,state,save,{now=Date.now(),pollMs=30000}={}) {
 // A Server-owned task already has a scoped, validated Client push stream.
 // Prefer it even while an older read is queued; never dispatch another action.
 const hasTaskMirror=!lab.db||lab.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='lab_task'").get();
 if(hasTaskMirror&&typeof lab.task==='function'){
  let pushed;try{pushed=lab.task(scope,state.id);}catch(error){if(error.code!=='TASK_NOT_FOUND')throw error;}
  if(pushed){
   if(pushed.taskId!==state.id||pushed.clientId!==state.clientId)throw Object.assign(Error('Task watch binding mismatch'),{code:'WATCH_TARGET_CONFLICT'});
   state.snapshot=pushed;save(state);return pushed;
  }
 }
 if(state.snapshot&&continuation.isTerminal(state.snapshot.status))return state.snapshot;
 if(!state.commandId){
  if(now<(state.nextPollAt||0))return null;
  const command=lab.tool(scope,{requestId:randomUUID(),clientId:state.clientId,tool:'read_task_result',args:{taskId:state.id,limit:1}});
  state.commandId=command.commandId;save(state);
 }
 const command=lab.getCommand(scope,state.commandId);
 if(['queued','running'].includes(command.status))return null;
 state.lastCommandId=state.commandId;delete state.commandId;state.nextPollAt=now+pollMs;
 const receipt=command.result;
 if(command.status!=='succeeded'||receipt?.success!==true||receipt.taskId!==state.id||typeof receipt.status!=='string'){
  state.lastError={code:receipt?.error?.code||'TASK_OBSERVATION_FAILED',commandStatus:command.status,commandId:state.lastCommandId};save(state);return null;
 }
 delete state.lastError;state.snapshot={taskId:state.id,status:receipt.status,report:receipt};save(state);return state.snapshot;
}
