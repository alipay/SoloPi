import {createHash} from 'node:crypto';
import {executionCaseEvents} from './execution-progress.mjs';
// Presentation of committed native facts. No model, reporting hook, archive or device call.
export function deliverExecutionResult(agent,task,{publicBaseUrl=''}={}){
 const events=executionCaseEvents(task,{publicBaseUrl});if(!events.length)return;
 const revision=createHash('sha256').update(JSON.stringify(events.map(e=>e.eventId))).digest('hex');
 const rows=agent.db.prepare(`SELECT w.* FROM sa_task_watch w JOIN sa_conversation c ON c.id=w.conversation_id WHERE w.target_id=? AND c.scope=?`).all(task.taskId,agent.scopeKey);
 for(const row of rows){
  const state=JSON.parse(row.state_json);
  if(state.clientId&&state.clientId!==task.clientId)continue;
  if(state.progressRevision===revision)continue;
  state.progressRevision=revision;state.executionEvents=events;state.executionPublishedAt=new Date().toISOString();
  agent.db.prepare('UPDATE sa_task_watch SET state_json=? WHERE message_id=? AND target_id=?').run(JSON.stringify(state),row.message_id,row.target_id);
  agent.notifyMessage(row.conversation_id,row.message_id);
 }
}
