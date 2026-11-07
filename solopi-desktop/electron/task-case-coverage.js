// Deterministic report membership only. This never classifies business or proves a cause.
const {selectTaskCases}=require('./task-case-query');
const identity=c=>c.caseId || c.id;
const name=c=>String(c.caseName || c.name || c.caseSnapshot?.name || '');
function validateCaseCoverage(task,{statuses=['failed'],rows}={}){
 if(!Array.isArray(rows))throw Error('rows必须是已分析用例数组');
 const {all,matchedCaseCount}=selectTaskCases(task,{statuses,limit:50});
 const expected=all.filter(c=>statuses.includes(c.status));
 const byId=new Map(expected.map(c=>[identity(c),c])),seen=new Set(),duplicates=[],unexpected=[],mismatches=[],unclassified=[];
 for(const row of rows){
  if(!row || typeof row.caseId!=='string' || !row.caseId || typeof row.name!=='string' || typeof row.status!=='string')throw Error('每行必须含caseId、原始name与status');
  const id=row.caseId;
  if(seen.has(id))duplicates.push(id);seen.add(id);
  const source=byId.get(id);
  if(!source){unexpected.push(id);continue;}
  for(const [field,expected] of [['name',name(source)],['status',source.status]])if(row[field]!==expected)mismatches.push({caseId:id,field,expected,actual:row[field]});
  if(typeof row.category!=='string' || !row.category.trim() || row.category==='待分类')unclassified.push(id);
 }
 const missing=expected.filter(c=>!seen.has(identity(c))).map(identity);
 const complete=!missing.length&&!duplicates.length&&!unexpected.length&&!mismatches.length;
 return {success:complete,successScope:'validation',...(!complete?{errorCode:'CASE_COVERAGE_MISMATCH',invalidAnalysisMustBeDiscarded:true,canonicalCases:expected.slice(0,50).map(c=>({caseId:identity(c),name:name(c),status:c.status})),canonicalNextOffset:expected.length>50?50:null}: {}),taskId:task.id,filters:{statuses},expectedCount:matchedCaseCount,submittedCount:rows.length,uniqueCount:seen.size,
  coverageComplete:complete,classificationComplete:complete&&!unclassified.length,missingCaseIds:missing,duplicateCaseIds:[...new Set(duplicates)],unexpectedCaseIds:[...new Set(unexpected)],mismatches,unclassifiedCaseIds:unclassified,
  validationScope:'case-membership-name-status-and-category-presence',businessClassificationVerified:false,causalityVerified:false};
}
module.exports={validateCaseCoverage};
