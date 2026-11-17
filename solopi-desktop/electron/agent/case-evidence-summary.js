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
  if(group.items.length<5)group.items.push({ref:{kind,index},caseId:c.caseId || c.id,hasPath:!!(item?.path || item?.outputPath || item?.filePath),...pick(item,['stepId','deviceType','success','status','errorCode','sizeBytes','startSequence','endSequence','startedAt','endedAt','path','outputPath','filePath','sharedTaskLog'])});
 }
 return groups;
}
function caseEvidenceSummary(c,{stepId,offset=0,limit=5}={}) {
 const summary={success:true,successScope:'query',...pick(c,['id','caseId','sourceCaseId','caseName','name','status','startedAt','endedAt','finishedAt','error','errorCode','evidenceReady'])};
 const snapshot=c.caseSnapshot;
 if(snapshot){const selected=(snapshot.steps || []).filter(s=>!stepId || s.id===stepId);summary.configuration={...pick(snapshot,['id','name','schemaVersion','version']),stepCount:(snapshot.steps || []).length,componentCount:(snapshot.components || []).length,steps:selected.slice(offset,offset+limit).map(s=>pick(s,['id','name','type','device','componentId','phase'])),total:selected.length,nextOffset:offset+limit<selected.length?offset+limit:null};}
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
const LOG_EXAMPLE_FIELDS=['sampleLog','sampleExtractText','samplePayload'];
function omitLogExamples(value){
 if(!value || typeof value!=='object' || Array.isArray(value))return value;
 return Object.fromEntries(Object.entries(value).filter(([key])=>!LOG_EXAMPLE_FIELDS.includes(key)));
}
// Only project configuration containers. Actual candidate JSON/logs may legitimately
// contain identically named business fields and must remain complete evidence.
function diagnosticConfiguration(snapshot){
 if(!snapshot)return snapshot;
 const project=item=>({...omitLogExamples(item),
  ...(item.inputs?{inputs:omitLogExamples(item.inputs)}:{}),
  ...(item.config?{config:omitLogExamples(item.config)}:{})});
 return {...snapshot,
  ...(snapshot.steps?{steps:snapshot.steps.map(project)}:{}),
  ...(snapshot.components?{components:snapshot.components.map(c=>({...project(c),
   ...(c.params?{params:c.params.filter(p=>!LOG_EXAMPLE_FIELDS.includes(p.key))}:{})}))}:{})};
}
function caseConfiguration(c,{stepId,offset=0,limit=5,detailMode='compact'}={}){
 const s=detailMode==='full'?c.caseSnapshot:diagnosticConfiguration(c.caseSnapshot);if(!s)return {success:false,error:'本次执行未保存用例配置快照'};
 const steps=(s.steps || []).filter(x=>!stepId || x.id===stepId);
 if(stepId && !steps.length)throw Error('执行快照中不存在该步骤');
 const selected=steps.slice(offset,offset+limit),ids=new Set(selected.map(x=>x.componentId).filter(Boolean));
 return {success:true,successScope:'query',caseId:c.caseId || c.id,
  configurationSemantics:{source:'execution-snapshot',exampleOnlyFields:LOG_EXAMPLE_FIELDS,examplesIncluded:detailMode==='full',
   interpretation:'默认省略编辑用sampleLog/sampleExtractText/samplePayload；它们不是本次真实日志。需要核对编辑配置可显式detailMode=full或export_cases完整导出，不能把诊断投影当完整文档保存。日志提取以本次执行的正则和实际候选为准；候选为0不能据旧样例推断业务无返回。节点inputs/config与组件定义按运行时规则解析；variables可能包含运行后写入值，不代表初始输入。最近一次未通过原因是候选处理失败记录，不能推断后来的日志覆盖了成功结果或存在未记录的兜底。'},
  configuration:{...pick(s,['id','name','schemaVersion','version','defaults','variables']),steps:selected,components:(s.components || []).filter(x=>ids.has(x.id)),edges:(s.edges || []).filter(x=>selected.some(s=>s.id===x.source || s.id===x.target))},total:steps.length,nextOffset:offset+limit<steps.length?offset+limit:null};
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
function stepDetails(result, {taskId, caseId, detailMode} = {}) {
 if(detailMode==='full' || !result.meta?.llmRequestPayload)return result;
 const meta={...result.meta};
 const omitted=['meta.llmRequestPayload'];
 delete meta.llmRequestPayload;
 if(meta.llmAssertion?.raw){meta.llmAssertion={...meta.llmAssertion};delete meta.llmAssertion.raw;omitted.push('meta.llmAssertion.raw');}
 // One representation of the actual candidate, never a clipped business JSON.
 if(meta.currentNodeLogExtraction){
  const e=meta.currentNodeLogExtraction;
  meta.currentNodeLogExtraction=e.json!=null?{json:e.json}:e.extractedContent!=null?{extractedContent:e.extractedContent}:{log:e.log};
  omitted.push('meta.currentNodeLogExtraction duplicate representations');
 }
 const projected={...result,meta};
 if(result.stdout){delete projected.stdout;omitted.push('stdout');}
 return {...projected,detailProjection:{mode:'compact',omittedFields:omitted,
  stdoutBytes:Buffer.byteLength(result.stdout || ''),
  fullDetails:{tool:'read_case_results',arguments:{taskId,caseId,stepId:result.stepId,view:'details',detailMode:'full',limit:1}},
  interpretation:'重复调试文本已省略，未截断当前候选JSON或断言结果。完整原始输出/模型输入可用fullDetails原样回读；原报告未修改。'}};
}
module.exports={diagnosticConfiguration,caseEvidenceSummary,caseConfiguration,caseArtifacts,caseTimeline,compactCaseSteps,stepDetails};
