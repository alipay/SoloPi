// Read-only Desktop adapter to the same evidence implementations as CLI/Agent.
async function readReportEvidence(task,tool,args){
 if(!task||args.taskId!==task.id)throw Error('报告任务归属不匹配');
 require('./agent/report-case-identity').resolveReportCase(task,args);
 if(tool==='read_case_artifact')return require('./agent/case-artifact-read').readCaseArtifact(task,args);
 if(tool==='search_task_log'){
  const result=await require('./agent/log-search-batch').searchTaskLogs(task,{...args,queries:[{query:args.query||'',fromLine:args.fromLine||1,limit:80}]});
  return result.success?{...result,...result.results[0]}:result;
 }
 throw Error('报告查看器只允许读取日志与附件');
}
module.exports={readReportEvidence};
