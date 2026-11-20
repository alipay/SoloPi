// Model-facing metadata only. Full records remain in the session/evidence store.
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const pick=(v,keys)=>Object.fromEntries(keys.filter(k=>v?.[k]!==undefined).map(k=>[k,v[k]]));
function facts(value,depth=0){
 if(!value||typeof value!=='object')return {};
 const out={};
 for(const k of ['success','status','phase','code','errorCode','errorType','exitCode','signal','submissionOutcome','caseId','stepId','taskId','kind','revision','evidenceId','message','error','stderr','stopReason','stopCause']){
  const v=value[k];if(v===undefined)continue;
  if(typeof v==='string'){out[k]=v.length>768?v.slice(0,640)+'…'+v.slice(-128):v;if(v.length>768)out[k+'Truncated']=true;}
  else if(v===null||typeof v==='boolean'||typeof v==='number')out[k]=v;
  else if(depth<1&&k==='error')out[k]=facts(v,depth+1);
 }
 if(depth<1){
  if(value.result)out.result=facts(value.result,depth+1);
  for(const k of ['failures','errors'])if(Array.isArray(value[k])){out[k]=value[k].slice(0,2).map(v=>facts(v,depth+1));out[k+'Count']=value[k].length;}
 }
 return out;
}
function pruningNotice(content){
 let value;try{value=JSON.parse(content.filter(b=>b.type==='text').map(b=>b.text).join('\n'));}catch{}
 let summary=JSON.stringify(facts(value));
 if(summary.length>2200){
  const failure=value?.error?value:value?.result?.error?value.result:value?.failures?.find(v=>v?.error||v?.errorCode)||value;
  const compact=v=>Object.fromEntries(Object.entries(v).map(([k,x])=>[k,x&&typeof x==='object'?compact(pick(x,['code','errorCode','message'])):typeof x==='string'&&x.length>128?x.slice(0,96)+'…'+x.slice(-32):x]));
  summary=JSON.stringify({success:value?.success,...compact(pick(facts(value),['code','errorCode','exitCode','signal','submissionOutcome','stderr','stderrTruncated'])),failure:compact(pick(facts(failure),['code','errorCode','error','message']))});
 }
 // Bounded metadata sits ahead of the upstream head/tail preview. No raw result is rewritten.
 return '工具输出已裁剪；这不是完整JSON。原始结果与错误保留，可用 read_operation_receipt(callId=本工具调用ID) 回读，按pointers选字段。\n执行状态/错误摘要：'+summary+'\n';
}
function summarizeSave(result,fullResultPath){
 const {changedFields,...rest}=result;
 if(!changedFields)return {...rest,fullResultPath};
 const entries=Object.entries(changedFields);
 return {...rest,changedFieldsSummary:{caseCount:entries.length,pathCount:entries.reduce((n,[,v])=>n+v.length,0),examples:entries.slice(0,3).map(([caseId,paths])=>({caseId,pathCount:paths.length,paths:paths.slice(0,3)})),detailsComplete:false},fullResultPath};
}
function saveReceipt(result,{directory}={}){
 const root=directory||require('node:os').tmpdir();
 try{
  fs.mkdirSync(root,{recursive:true});const dir=fs.mkdtempSync(path.join(root,'solopi-receipt-'));fs.chmodSync(dir,0o700);
  const fullResultPath=path.join(dir,randomUUID()+'.json');fs.writeFileSync(fullResultPath,JSON.stringify(result,null,2),{mode:0o600,flag:'wx'});
  return summarizeSave(result,fullResultPath);
 }catch(error){return {...result,receiptStorageError:{code:error.code||'RECEIPT_WRITE_FAILED',message:'完整回执落盘失败；返回原始结果，勿重复执行保存。'}};}
}
// Task notifications carry execution facts only; assistant diagnostics stay in session evidence.
function taskExecutionRecord(event){
 return pick(event,['kind','id','status','taskType','reportKey','executionReceipt','caseEvents','recordingSession','error','message','stopReason','stopCause']);
}
function noticeSummary(event){
 const cases=event.caseEvents||[];const counts={};for(const c of cases)counts[c.caseStatus||'unknown']=(counts[c.caseStatus||'unknown']||0)+1;
 const failed=cases.filter(c=>c.caseStatus==='failed');
 return {...pick(event,['kind','id','status','taskType','reportKey']),...facts(event),
  ...(event.executionReceipt?{executionReceipt:{...pick(event.executionReceipt,['schemaVersion','taskId','executionComplete','status','counts','observedAt','reportPackagePath']),...facts(event.executionReceipt)}}:{}),
  caseEventCount:cases.length,caseStatusCounts:counts,
  failureExamples:failed.slice(0,2).map(c=>({...pick(c,['caseId','caseStatus','revision','evidenceReady']),firstFailedStep:facts(c.caseSummary?.firstFailedStep)})),
  detailsComplete:false};
}
module.exports={facts,pruningNotice,saveReceipt,noticeSummary,taskExecutionRecord};
