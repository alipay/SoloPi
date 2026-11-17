import {requestAncestorIds,requestMessageIds} from './message-lineage.mjs';

// Record protocol boundaries in the same transaction as their durable rows.
// Old rows intentionally retain null timestamps; no historical duration is guessed.
export function installRequestTiming(db) {
 for(const [table,columns] of [['sa_message',['accepted_at_ms','finished_at_ms']],['sa_call',['started_at_ms','finished_at_ms']]]) {
  const existing=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name));
  for(const column of columns)if(!existing.has(column))db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} BIGINT`);
 }
 const now="CAST(unixepoch('subsec') * 1000 AS INTEGER)";
 db.exec(`
 CREATE TRIGGER IF NOT EXISTS sa_message_timing_insert AFTER INSERT ON sa_message BEGIN
  UPDATE sa_message SET accepted_at_ms=${now} WHERE id=NEW.id;
 END;
 CREATE TRIGGER IF NOT EXISTS sa_message_timing_finish AFTER UPDATE OF status ON sa_message
 WHEN NEW.status IN ('succeeded','failed','interrupted','cancelled') AND OLD.status IS NOT NEW.status BEGIN
  UPDATE sa_message SET finished_at_ms=${now} WHERE id=NEW.id;
 END;
 CREATE TRIGGER IF NOT EXISTS sa_call_timing_insert AFTER INSERT ON sa_call BEGIN
  UPDATE sa_call SET started_at_ms=${now} WHERE id=NEW.id;
 END;
 CREATE TRIGGER IF NOT EXISTS sa_call_timing_finish AFTER UPDATE OF status ON sa_call
 WHEN NEW.status IN ('done','failed') AND OLD.status IS NOT NEW.status BEGIN
  UPDATE sa_call SET finished_at_ms=${now} WHERE id=NEW.id;
 END;`);
}
const iso=value=>value===null||value===undefined?null:new Date(value).toISOString();
const interval=(start,end)=>({startedAt:iso(start),finishedAt:iso(end),durationMs:start!==null&&end!==null&&end>=start?end-start:null});
export function requestTiming(db,conversationId,messageId,{offset=0,limit=20,names}={}) {
 const rootId=requestAncestorIds(db,conversationId,messageId).at(-1);
 if(!rootId)throw Object.assign(Error('Request not found'),{code:'MESSAGE_NOT_FOUND'});
 const ids=requestMessageIds(db,rootId),root=db.prepare('SELECT * FROM sa_message WHERE id=?').get(rootId);
 const calls=ids.flatMap(id=>db.prepare('SELECT * FROM sa_call WHERE message_id=? ORDER BY rowid').all(id));
 const filtered=names?calls.filter(c=>names.includes(c.name)):calls;
 const observedAt=Date.now();
 const result={requestId:rootId,status:root.status,source:'server-durable-protocol-timestamps',observedAt:iso(observedAt),
  ...interval(root.accepted_at_ms,root.finished_at_ms),complete:root.finished_at_ms!==null,
  elapsedMs:root.accepted_at_ms===null?null:observedAt-root.accepted_at_ms,
  toolDurationMeaning:'Summed tool wall time; overlapping calls must not be added to request duration.',
  totalCalls:calls.length,matchedCalls:filtered.length,offset,
  nextOffset:offset+limit<filtered.length?offset+limit:null,
  calls:filtered.slice(offset,offset+limit).map(c=>{
   const result=JSON.parse(c.result_json||'null');
   return {receiptId:c.id,messageId:c.message_id,name:c.name,status:c.status,...interval(c.started_at_ms,c.finished_at_ms),
    ...(result?.path&&result?.sha256?{artifact:{path:result.path,sha256:result.sha256,writtenAt:result.writtenAt}}:{})};
  })};
 while(JSON.stringify(result).length>5500&&result.calls.length>1)result.calls.pop();
 result.nextOffset=offset+result.calls.length<filtered.length?offset+result.calls.length:null;
 return result;
}
