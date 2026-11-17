// Examples complement the native schema; they never replace validation or execution.
export const examples={
 save_client_case:{clientId:'actual-client-id',args:{action:'create-case',caseId:'new-case-id',libraryId:'actual-library-id',folderId:'actual-folder-id',documentPath:'/workspace/drafts/new-case.json'}},
 client_read:{clientId:'actual-client-id',tool:'search_task_logs',args:{taskId:'actual-task-id',caseId:'actual-case-id',deviceType:'glasses',queries:[{id:'first',query:'literal first',countOnly:true},{id:'second',query:'literal second',limit:20}]}}
};
export function toolDescription(name,description){
 if(name==='save_client_case')return description+' 最短路径：根据当前组件契约写一个完整平铺document到工作区文件（含id/schemaVersion及本轮步骤），args传libraryId/folderId，id与caseId一致；例：'+JSON.stringify(examples[name])+'。clientId只在顶层；documentPath与document二选一；queued/running查询原commandId，status=failed或result.success=false不是保存成功。成功后read_case回读本轮revision再提交，不重写已保存文件。';
 if(name==='client_read')return description+' 批量日志完整例：'+JSON.stringify(examples[name])+'。taskId和queries都在args内，queries[].query为字面包含，可一次查询多个词。先read_task_result/read_case_results取得本例identity.logs及设备端；Client文件用Client能力读取，Server回执fullResultPath/stdoutFile才用Server read_attachment。evidenceId只用真实证据ID；找工具回执用read_operation_receipt(callId)。';
 return description;
}
