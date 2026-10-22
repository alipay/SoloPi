const {createHash,randomUUID}=require('node:crypto');
// Deduplicate only already-observed identical history. Never cache a new tool execution.
function deduplicateResults(session,store){
  const latest=new Map(),start=session.contextCheckpoint?.through || 0;let count=0;
  for(let i=session.messages.length-1;i>=start;i--){
    const message=session.messages[i];
    if(message.role!=='tool'||typeof message.content!=='string'||message.content.length<4096)continue;
    const hash=createHash('sha256').update(message.content).digest('hex'),duplicate=latest.get(hash);
    if(duplicate===undefined){latest.set(hash,i);continue;}
    if(session.contextPruned?.[i])continue;
    const evidenceId=store.saveEvidence(session.id,randomUUID(),{toolCallId:message.tool_call_id,content:message.content});
    (session.contextPruned ||= {})[i]=JSON.stringify({duplicateResult:true,evidenceId,identicalToToolCallId:session.messages[duplicate].tool_call_id,message:'这是已观察到的相同历史结果。完整结果保留在后面的对应工具回执及证据中，不代表本次重新查询或执行。'});
    count++;
  }
  return count;
}
module.exports={deduplicateResults};
