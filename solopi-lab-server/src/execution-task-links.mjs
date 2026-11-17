import {requestAncestorIds} from './message-lineage.mjs';
// Links come from this request's committed task subscriptions, never from model
// prose or a task ID copied from older messages in the same conversation.
export function executionTaskLinks(db,conversationId,messageId,publicBaseUrl=''){
 const base=publicBaseUrl?new URL(publicBaseUrl):null;
 if(base&&(!['http:','https:'].includes(base.protocol)||base.username||base.password))throw Error('Invalid public Server URL');
 const root=base?base.origin+base.pathname.replace(/\/$/,''):'';
 const links=[],seen=new Set();
 for(const id of requestAncestorIds(db,conversationId,messageId)){
  for(const row of db.prepare('SELECT target_id,state_json FROM sa_task_watch WHERE message_id=? AND conversation_id=? ORDER BY rowid').all(id,conversationId)){
   const state=JSON.parse(row.state_json||'{}');
   if(state.kind&&state.kind!=='task'||typeof row.target_id!=='string'||!row.target_id||seen.has(row.target_id))continue;
   seen.add(row.target_id);links.push({taskId:row.target_id,href:root+'/#/execution/'+encodeURIComponent(row.target_id)});
  }
 }
 return links;
}
export function withExecutionTaskLinks(text,links){
 const missing=links.filter(l=>!text.includes(l.href));
 return text+(missing.length?'\n\n'+missing.map(l=>'[查看任务详情]('+l.href+')').join('\n'):'');
}
