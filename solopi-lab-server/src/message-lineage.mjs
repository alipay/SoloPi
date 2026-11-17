// A platform continuation belongs to the original request. A new user message
// in the same conversation is a separate request and must never leak into it.
export function requestMessageIds(db, messageId) {
 return db.prepare(`WITH RECURSIVE lineage(id,conversation_id) AS (
  SELECT id,conversation_id FROM sa_message WHERE id=?
  UNION
  SELECT m.id,m.conversation_id FROM sa_message m JOIN lineage p
   ON m.parent_message_id=p.id AND m.conversation_id=p.conversation_id
   WHERE m.source_kind='platform'
 ) SELECT m.id FROM lineage l JOIN sa_message m ON m.id=l.id ORDER BY m.rowid`).all(messageId).map(row=>row.id);
}

export function requestAncestorIds(db, conversationId, messageId) {
 const ids=[],seen=new Set();let id=messageId;
 while(id&&!seen.has(id)) {
  seen.add(id);
  const row=db.prepare('SELECT id,parent_message_id,source_kind FROM sa_message WHERE id=? AND conversation_id=?').get(id,conversationId);
  if(!row)break;
  ids.push(row.id);
  id=row.source_kind==='platform'?row.parent_message_id:null;
 }
 return ids;
}

export function requestExecutionEvents(db, messageId, projectSnapshot) {
 const seen=new Set(),events=[];
 for(const id of requestMessageIds(db,messageId)) {
  for(const row of db.prepare('SELECT state_json FROM sa_task_watch WHERE message_id=? ORDER BY rowid').all(id)) {
   const state=JSON.parse(row.state_json);
   for(const event of state.executionEvents||projectSnapshot(state.snapshot)) {
    if(seen.has(event.eventId))continue;
    seen.add(event.eventId);events.push(event);
   }
  }
 }
 return events;
}

export function requestProcess(db, messageId) {
 const seen=new Set(),process=[];
 for(const id of requestMessageIds(db,messageId)) {
  const result=JSON.parse(db.prepare('SELECT result_json FROM sa_message WHERE id=?').get(id)?.result_json||'{}');
  for(const item of result.process||[]) {
   const key=JSON.stringify(item);
   if(seen.has(key))continue;
   seen.add(key);process.push(item);
  }
 }
 return process;
}

export function requestSourceMetadata(db, row) {
 const ids=requestAncestorIds(db,row.conversation_id,row.id);
 const origin=ids.length?db.prepare('SELECT id,sender,external_id,channel,source_kind FROM sa_message WHERE id=? AND conversation_id=?').get(ids.at(-1),row.conversation_id):null;
 return {senderId:row.sender,externalMessageId:row.external_id,sourceKind:row.source_kind||'user',
  ...(origin&&origin.source_kind!=='platform'?{origin:{messageId:origin.id,senderId:origin.sender,externalMessageId:origin.external_id,channel:origin.channel}}:{})};
}

// Project only protocol metadata from this request and its platform continuations.
export function requestToolCalls(db, messageId) {
 return requestMessageIds(db,messageId).flatMap(id=>db.prepare(
  'SELECT id,model_call_id,name,status,gmt_create,message_id AS messageId FROM sa_call WHERE message_id=? ORDER BY rowid'
 ).all(id));
}
