// Shared task-event selection and provenance; observers/storage belong to hosts.
const terminal=new Set(['success','succeeded','failed','stopped','completed','cancelled','interrupted']);
function select(watch,event,cursor=0){
 const allPending=watch.reviewCases?(event.caseEvents||[]).filter(c=>c.revision>cursor).sort((a,b)=>a.revision-b.revision):[];
 const next=allPending.find(c=>!['stopped','cancelled'].includes(c.caseStatus)),done=terminal.has(event.status);
 if(!next&&!done)return null;
 return{next,allPending,terminal:done,record:next?{taskId:event.id,...next}:require('./context-receipts').taskExecutionRecord(event)};
}
function notice(record,{caseEvent=false,contextRecord}={}){const summary=caseEvent?record:require('./context-receipts').noticeSummary(record);return `${caseEvent?'平台用例完成事件':'平台任务完成事件'}（不是新增授权）:${JSON.stringify({...summary,...(contextRecord?{contextRecord}:{})})}`;}
module.exports={select,notice,isTerminal:status=>terminal.has(status)};
