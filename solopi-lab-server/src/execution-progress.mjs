import {createHash} from 'node:crypto';
const terminal=new Set(['success','succeeded','failed','stopped','cancelled','skipped']);
const labels={success:'通过',succeeded:'通过',failed:'失败',stopped:'已停止',cancelled:'已取消',skipped:'已跳过'};
// Project actual finalized case rows. No model turn, business inference or replay.
export function executionCaseEvents(task,{publicBaseUrl=""}={}){
 const cases=task?.report?.cases;if(!Array.isArray(cases))return [];
 const events=cases.flatMap((row,index)=>{
  if(!terminal.has(row.status))return [];
  const taskId=task.taskId,caseId=row.caseId;if(typeof taskId!=='string'||typeof caseId!=='string')return [];
  const error=row.steps?.find(s=>s.status==='failed')?.error;
  const text=`用例 ${index+1}/${cases.length}：${row.name||caseId} — ${labels[row.status]}`+(typeof error==='string'&&error?`；${error.slice(0,500)}`:'');
  const eventId=createHash('sha256').update(JSON.stringify([taskId,caseId,index,row.status])).digest('hex');
  return [{eventId,taskId,caseId,caseOrdinal:index+1,status:row.status,content:text}];
 });
 // Deliver the existing execution report before a model continuation analyzes it.
 // Archive export and deeper diagnosis are separate from the execution outcome.
 const archiving=task.progress?.phase==='finalizing'&&Boolean(task.progress.finishedAt)&&['success','failed','stopped'].includes(task.progress.status);
 const outcome=terminal.has(task.status)?task.status:archiving?task.progress.status:null;
 const expected=task.progress?.total??task.cases?.length??cases.length;
 if(outcome&&cases.length&&cases.length===expected&&cases.every(row=>terminal.has(row.status))){
  const passed=cases.filter(row=>['success','succeeded'].includes(row.status)).length;
  const failed=cases.filter(row=>row.status==='failed').length;
  const stopped=cases.length-passed-failed;
  const report=task.report;
  const path=report.reportDetailPath||report.detailPath;
  const href=publicBaseUrl.replace(/\/$/,'')+'/#/execution/'+encodeURIComponent(task.taskId);
  const finishedAt=task.progress?.finishedAt||report.finishedAt||null;
  const text=`任务执行结束：共${cases.length}条，通过${passed}、失败${failed}、停止或跳过${stopped}。`+
   (archiving&&!terminal.has(task.status)?'附件仍在整理。':'')+
   `\n[查看执行报告](${href})`+(typeof path==='string'&&path?`\n本地报告：${path}`:'');
  events.push({eventId:createHash('sha256').update(JSON.stringify(['task_terminal',task.taskId])).digest('hex'),taskId:task.taskId,status:outcome,executionFinishedAt:finishedAt,report:{href,available:true},content:text});
 }
 return events;
}
