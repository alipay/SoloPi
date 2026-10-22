// Keep complete diagnostics in evidence; give the model causes instead of repeated rows.
function compactValidation(result,evidenceId){
 const groups=new Map();
 for(const [severity,items] of [['error',result.validationErrors||[]],['warning',result.validationWarnings||[]]])for(const item of items){
  const key=JSON.stringify([severity,item.code||'',item.field?.replace(/^cases\[\d+\]/,'cases[]')||'',item.message?.replace(/^cases\[\d+\]/,'cases[]')||'']);
  let group=groups.get(key);if(!group){group={severity,code:item.code,field:item.field,message:item.message,count:0,caseIds:[],examples:[],recoveryActions:item.recoveryActions};groups.set(key,group);}
  group.count++;if(item.caseId&&!group.caseIds.includes(item.caseId))group.caseIds.push(item.caseId);if(group.examples.length<3)group.examples.push({caseId:item.caseId,caseName:item.caseName,node:item.node});
 }
 const all=[...groups.values()];
 return {success:false,phase:'validation',submitted:false,validationSummary:result.validationSummary,validationGroupCount:all.length,validationGroups:all.slice(0,20).map(g=>({...g,affectedCaseCount:g.caseIds.length,caseIds:g.caseIds.slice(0,8)})),groupsTruncated:all.length>20,evidenceId,message:'任务未提交。按根因处理阻断项；warnings不阻断。完整逐用例诊断用read_evidence按code/caseId查询，不逐页抄清单、不跳过失败用例。'};
}
module.exports={compactValidation};
