// Durable idempotency at the side-effect boundary, independent of model scheduling.
const {createHash}=require('node:crypto');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const unknown=r=>({success:false,submissionOutcome:'unknown',code:'OPERATION_OUTCOME_UNKNOWN',originalCallId:r.callId,lookupTaskId:r.lookupId,message:'原操作结果尚未核实；本次未重复执行，请先查询原操作状态。'});
const fingerprint=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
async function executeOperation({session,save,scope,tool,args,context}){
 const policy=tool.operationReceipt;
 if(!policy){
  const result=await tool.execute(args,context);
  if(tool.operationObservation&&result?.success===true){
   const observation=tool.operationObservation(args,result);
   if(observation?.id)for(const receipt of session.operationReceipts||[])if(receipt.lookupId===observation.id){receipt.status='done';receipt.result={success:true,taskId:observation.id,...observation.receipt};await save();}
  }
  return result;
 }
 const key=fingerprint({kind:policy.kind,args:await policy.key(args)});
 const revision=await policy.revision?.(args);
 const receipts=session.operationReceipts||=[];
 const previous=receipts.findLast(r=>(r.key===key||(r.unresolvedKind&&r.kind===policy.kind))&&(r.status==='unknown'||r.status==='dispatching'||r.status==='done'&&['queued','running'].includes(r.result?.status)||r.scope===scope&&r.revision===revision&&r.status==='done'&&(policy.reuseCompleted!=='call'||r.callId===context.operationId||['queued','running'].includes(r.result?.status))));
 if(previous){
  if(previous.status==='done')return {...structuredClone(previous.result),reused:true,submitted:false,originalCallId:previous.callId};
  return unknown(previous);
 }
 context.signal?.throwIfAborted();
 const receipt={key,revision,scope,callId:context.operationId,status:'dispatching',lookupId:policy.lookupId?.(context.operationId)};
 receipts.push(receipt);await save(); // Failure here must prevent dispatch.
 try{
  if(context.signal?.aborted)throw Object.assign(Error('Operation cancelled before dispatch'),{submissionOutcome:'not-submitted'});
  const result=await tool.execute(args,context);
  receipt.result=structuredClone(result);
  if(policy.resultLookupId)receipt.lookupId=policy.resultLookupId(result)||receipt.lookupId;
  const succeeded=policy.succeeded?policy.succeeded(result):result?.success===true;
  receipt.status=result?.submissionOutcome==='unknown'?'unknown':succeeded?(policy.acknowledged&&!policy.acknowledged(result)?'unknown':'done'):'failed';
  await save();return receipt.status==='unknown'?unknown(receipt):result;
 }catch(error){
  receipt.status=error.submissionOutcome==='not-submitted'?'failed':'unknown';
  // Preserve unknown even if saving the final receipt fails: dispatching was durable.
  try{await save();}catch{}
  if(receipt.status==='unknown')return unknown(receipt);
  throw error;
 }
}
module.exports={executeOperation,fingerprint};
// Import only execution facts from the retired receipt store, never work plans
// or authorization frames. An unresolvable unknown remains queryable by its
// original lookup id and cannot silently become permission to dispatch again.
async function hydrateLegacyReceipts(session,tools,save){
 const entries=session.taskExecutionState?.submissions||[];
 let changed=false;
 for(const old of entries){
  if(!['submitted','unknown','dispatching'].includes(old.status))continue;
  if(session.operationReceipts?.some(r=>r.legacyCallId===old.callId))continue;
  const call=session.calls.find(c=>c.modelCallId===old.callId||c.id===old.callId);
  const tool=tools.find(t=>t.name===call?.name&&t.operationReceipt);
  if(!tool)continue;
  const policy=tool.operationReceipt;let key,unresolvedKind=false;
  try{key=fingerprint({kind:policy.kind,args:await policy.key(call.args)});}catch{unresolvedKind=true;}
  (session.operationReceipts||=[]).push({legacyCallId:old.callId,kind:policy.kind,key,unresolvedKind,revision:old.definitionRevision,scope:'legacy:'+old.sourceUserIndex,callId:old.callId,status:old.status==='submitted'?'done':'unknown',lookupId:old.lookupTaskId||old.taskId,result:structuredClone(call.result)});
  changed=true;
 }
 if(changed)await save();
}
module.exports.hydrateLegacyReceipts=hydrateLegacyReceipts;
