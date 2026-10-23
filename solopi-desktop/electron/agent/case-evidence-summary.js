// Projection only: durable reports retain complete configuration, output and artifacts.
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>value?.[k]!==undefined).map(k=>[k,value[k]]));
const STEP_KEYS=['stepId','stepName','status','startedAt','completedAt','endedAt','error','errorCode'];
function artifactEntries(c){
 const entries=[];
 for(const [kind,value] of Object.entries(c.artifacts || {}))if(Array.isArray(value))value.forEach((item,index)=>entries.push({kind,index,item}));
 return entries;
}
function artifactSummary(c){
 const groups={};
 for(const {kind,index,item} of artifactEntries(c)){
  const group=groups[kind] ||= {total:0,items:[]};group.total++;
  if(group.items.length<5)group.items.push({ref:{kind,index},caseId:c.caseId || c.id,hasPath:!!(item?.path || item?.outputPath || item?.filePath),...pick(item,['stepId','deviceType','success','status','errorCode','sizeBytes','startSequence','endSequence','startedAt','endedAt'])});
 }
 return groups;
}
function caseEvidenceSummary(c,{stepId,offset=0,limit=5}={}) {
 const summary={success:true,successScope:'query',...pick(c,['id','caseId','sourceCaseId','caseName','name','status','startedAt','endedAt','finishedAt','error','errorCode','evidenceReady'])};
 const snapshot=c.caseSnapshot;
 if(snapshot)summary.configuration={...pick(snapshot,['id','name','schemaVersion','version']),stepCount:(snapshot.steps || []).length,componentCount:(snapshot.components || []).length,steps:(snapshot.steps || []).slice(offset,offset+limit).map(s=>pick(s,['id','name','type','device','componentId'])),total:(snapshot.steps || []).length,nextOffset:offset+limit<(snapshot.steps || []).length?offset+limit:null};
 const steps=(c.results || []).filter(r=>!stepId || r.stepId===stepId);
 summary.results=steps.slice(offset,offset+limit).map(r=>({...pick(r,STEP_KEYS),hasCommand:!!r.command,hasOutput:!!(r.stdout || r.stderr),hasDiagnostics:!!r.meta}));
 const failures=(c.results || []).filter(r=>['failed','error'].includes(r.status));
 summary.failures=failures.slice(0,20).map(r=>pick(r,STEP_KEYS));summary.failureCount=failures.length;summary.failuresTruncated=failures.length>20;
 summary.evidenceReady=c.evidenceReady ?? c.artifacts?.evidenceReady;
 summary.artifacts=artifactSummary(c);
 summary.total=steps.length;summary.nextOffset=offset+limit<steps.length?offset+limit:null;
 summary.evidenceScope='Only artifacts owned by this case and logs within its recorded execution boundaries establish this case. Later or earlier task logs are adjacent context, not proof of this case.';
 return summary;
}
function caseConfiguration(c,{stepId,offset=0,limit=5}={}){
 const s=c.caseSnapshot;if(!s)return {success:false,error:'本次执行未保存用例配置快照'};
 const steps=(s.steps || []).filter(x=>!stepId || x.id===stepId);
 if(stepId && !steps.length)throw Error('执行快照中不存在该步骤');
 const selected=steps.slice(offset,offset+limit),ids=new Set(selected.map(x=>x.componentId).filter(Boolean));
 return {success:true,successScope:'query',caseId:c.caseId || c.id,configuration:{...pick(s,['id','name','schemaVersion','version','defaults','variables']),steps:selected,components:(s.components || []).filter(x=>ids.has(x.id)),edges:(s.edges || []).filter(x=>selected.some(s=>s.id===x.source || s.id===x.target))},total:steps.length,nextOffset:offset+limit<steps.length?offset+limit:null};
}
function caseArtifacts(c,{artifactKind,artifactIndex,offset=0,limit=5}={}){
 if(artifactIndex!==undefined && !artifactKind)throw Error('artifactIndex必须同时指定artifactKind');
 const entries=artifactEntries(c).filter(e=>(!artifactKind || e.kind===artifactKind) && (artifactIndex===undefined || e.index===artifactIndex));
 if((artifactKind || artifactIndex!==undefined) && !entries.length)throw Error('本用例不存在该附件引用');
 return {success:true,successScope:'query',caseId:c.caseId || c.id,
  artifactInventory:Object.fromEntries(Object.entries(artifactSummary(c)).map(([kind,group])=>[kind,{total:group.total,refs:group.items.map(item=>item.ref)}])),
  artifactInventoryComplete:true,evidenceReady:c.evidenceReady ?? c.artifacts?.evidenceReady,
  artifacts:entries.slice(offset,offset+limit).map(e=>({ref:{kind:e.kind,index:e.index},detail:e.item})),total:entries.length,nextOffset:offset+limit<entries.length?offset+limit:null};
}
function caseTimeline(c,{offset=0,limit=20}={}) {
 const results=c.results || [], snapshot=c.caseSnapshot || {};
 const start=Date.parse(c.startedAt), all=results.map((r,index)=>({executionIndex:index,...pick(r,STEP_KEYS),
   ...(typeof r.error==='string'&&r.error.length>600?{error:r.error.slice(0,600),errorTruncated:true}: {}),
   ...(Number.isFinite(start)&&Number.isFinite(Date.parse(r.startedAt))?{elapsedStartMs:Date.parse(r.startedAt)-start}:{}),
   declaredStep:(snapshot.steps || []).find(s=>s.id===r.stepId)?pick((snapshot.steps || []).find(s=>s.id===r.stepId),['type','device','componentId']):undefined}));
 return {success:true,successScope:'query',caseId:c.caseId || c.id,caseName:c.caseName || c.name,status:c.status,
  clock:'runner-utc',orderSource:'recorded-results-execution-order',causalityVerified:false,
  steps:all.slice(offset,offset+limit),total:all.length,nextOffset:offset+limit<all.length?offset+limit:null,
  firstFailedStep:all.find(r=>['failed','error'].includes(r.status)) || null,
  logs:(c.artifacts?.logs || []).map((r,index)=>({ref:{kind:'logs',index},...pick(r,['deviceType','startSequence','endSequence'])})),
  interpretation:'Times describe recorded execution only. Match device log clocks before comparison. Earlier reset/exit steps do not prove a later exit was expected; query actual command and trigger source. No automatic business/product/test classification.'};
}
function compactCaseSteps(c){
 const results=c.results || [];
 return {caseId:c.caseId || c.id,name:c.caseName || c.name,status:c.status,orderSource:'recorded-results-execution-order',stepCount:results.length,stepsComplete:true,columns:['stepId','name','status','durationMs','error'],steps:results.map(r=>[r.stepId,r.stepName || r.name,r.status,r.durationMs ?? null,typeof r.error==='string'?r.error.slice(0,600):null]),errorTruncated:results.some(r=>typeof r.error==='string'&&r.error.length>600)};
}
module.exports={caseEvidenceSummary,caseConfiguration,caseArtifacts,caseTimeline,compactCaseSteps};
