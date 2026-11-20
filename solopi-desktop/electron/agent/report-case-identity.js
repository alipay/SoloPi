// Resolve display ordinals against the immutable execution ledger, before filters.
function resolveReportCase(task,{caseId,caseOrdinal}={}) {
 const cases=task.cases || [];
 if(caseOrdinal!==undefined && (!Number.isSafeInteger(caseOrdinal)||caseOrdinal<1))throw Error('caseOrdinal须为原报告1起序号');
 if(!caseId && caseOrdinal===undefined)throw Error('必须指定caseId或caseOrdinal');
 const byId=caseId?cases.find(c=>c.id===caseId || c.caseId===caseId):undefined;
 const byOrdinal=caseOrdinal!==undefined?cases[caseOrdinal-1]:undefined;
 if(caseId && !byId || caseOrdinal!==undefined && !byOrdinal)throw Error('指定任务中不存在该用例，请核对taskId及原始序号，不替换为重跑任务');
 if(byId && byOrdinal && byId!==byOrdinal)throw Error('caseId与caseOrdinal指向不同用例，禁止继续混用证据');
 const c=byId || byOrdinal;
 return {caseRecord:c,identity:{taskId:task.id,taskName:task.name,caseOrdinal:cases.indexOf(c)+1,caseId:c.caseId || c.id,sourceCaseId:c.sourceCaseId,caseName:c.caseName || c.name,startedAt:c.startedAt,endedAt:c.endedAt || c.finishedAt,
  logs:(c.artifacts?.logs || []).map((a,index)=>({artifactIndex:index,path:a.path || a.outputPath || a.filePath,deviceType:a.deviceType,sharedTaskLog:!!a.sharedTaskLog,startSequence:a.startSequence,endSequence:a.endSequence,boundary:a.sharedTaskLog?'(startSequence,endSequence]':'case-owned-file'})),
  fileAccess:'Use these artifact paths with existing file/command tools (rg, jq, Python). Shared task logs require the recorded nonempty-entry sequence range; for a case-owned file use export_case_evidence. Do not search parent directories or infer absence from previews.',
  interpretation:'Identity is from this exact task report. CLI origin does not imply missing reports. Log sequence is nonempty-entry order, not necessarily physical line number. Other cases and reruns are separate evidence.'}};
}
module.exports={resolveReportCase};
