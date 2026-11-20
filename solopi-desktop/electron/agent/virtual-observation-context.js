const { randomUUID } = require('node:crypto');

// Preserve full history on disk; only project older observations out of model requests.
function virtualObservations(session) {
  const start=session.messages.findLastIndex(m=>m.role==='user' && m.source!=='platform');
  const calls=new Map(), observations=[];
  for(let i=Math.max(0,start+1);i<session.messages.length;i++) {
    const message=session.messages[i];
    for(const call of message.tool_calls || []) {
      if(['virtual_start','virtual_observe','virtual_act'].includes(call.function?.name)) calls.set(call.id,call.function.name);
    }
    if(message.role!=='tool' || !calls.has(message.tool_call_id)) continue;
    let result;try{result=JSON.parse(message.content);}catch{continue;}
    if(result?.success===true && typeof result.observationId==='string')
      observations.push({index:i,message,result,name:calls.get(message.tool_call_id)});
  }
  return observations;
}

// Only references generated for an actually superseded virtual observation may
// survive the general newest-batch reset. The latest observation stays intact.
function supersededVirtualReferences(session) {
  const result=new Set();
  for(const item of virtualObservations(session).slice(0,-1)) {
    try {
      const reference=JSON.parse(session.contextPruned?.[item.index]);
      if(reference?.supersededObservation===true && reference.observationId===item.result.observationId
          && typeof reference.evidenceId==='string' && reference.evidenceId.length) result.add(item.index);
    } catch { /* An invalid or unrelated projection is not protected. */ }
  }
  return result;
}

function pruneVirtualObservations(session, store) {
  const observations=virtualObservations(session);
  let changed=false;
  for(const item of observations.slice(0,-1)) {
    if(session.contextPruned?.[item.index]) continue;
    const evidenceId=store.saveEvidence(session.id,randomUUID(),item.result,
      {toolName:item.name,toolCallId:item.message.tool_call_id});
    (session.contextPruned ||= {})[item.index]=JSON.stringify({success:true,observationId:item.result.observationId,
      supersededObservation:true,evidenceId,...(item.result.receipt ? {receipt:item.result.receipt} : {}),
      message:'旧观察仅供追溯，不能作为当前动作目标；如需查看原文可用 read_evidence。'});
    changed=true;
  }
  return changed;
}
module.exports={pruneVirtualObservations,supersededVirtualReferences};
