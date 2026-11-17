// Request-only provenance derived from durable messages and receipts. No intent routing.
function readUserMessages(session,indices){
 if(!Array.isArray(indices)||!indices.length||indices.length>8||indices.some(i=>!Number.isSafeInteger(i)||i<0))throw Error('indices必须为1–8个原始用户消息索引');
 return {success:true,successScope:'conversation-history',messages:indices.map(index=>{
  const message=session.messages[index];
  if(!message || message.role!=='user')throw Error('索引不是本会话的用户角色消息');
  return {index,source:message.source || 'legacy-unspecified',createdAt:message.createdAt,content:message.content,attachments:message.attachments};
 })};
}
function evidenceCoverage(session){
 const records=new Map();
 for(const call of session.calls || []){
  const r=call.result;
  if(call.name!=='read_evidence'||call.status!=='done'||!r?.evidenceId||!Number.isSafeInteger(r.offset)||!Number.isSafeInteger(r.total)||typeof r.content!=='string')continue;
  const item=records.get(r.evidenceId) || {evidenceId:r.evidenceId,total:r.total,ranges:[]};
  // A zero-hit query supplies no coverage. Never infer it from requested offsets.
  item.ranges.push([r.offset,Math.min(r.total,r.offset+r.content.length)]);records.delete(r.evidenceId);records.set(r.evidenceId,item);
 }
 return [...records.values()].slice(-5).map(item=>{
  const ranges=[];
  for(const [a,b] of item.ranges.sort((x,y)=>x[0]-y[0])){
   const last=ranges.at(-1);if(last&&a<=last[1])last[1]=Math.max(last[1],b);else ranges.push([a,b]);
  }
  const firstUnreadOffset=ranges[0]?.[0]===0?ranges[0][1]:0;
  return {evidenceId:item.evidenceId,total:item.total,observedRanges:ranges.slice(0,8),rangesTruncated:ranges.length>8,
   firstUnreadOffset:firstUnreadOffset>=item.total?null:firstUnreadOffset,fullyRead:ranges.length===1&&ranges[0][0]===0&&ranges[0][1]===item.total};
 });
}
function frame(session){
 const users=session.messages.flatMap((m,index)=>m.role==='user'&&m.source!=='platform'?[index]:[]);
 const currentRequestIndex=users.at(-1);
 const linked=new Set([...(session.workState?.sourceUserIndices||[]),session.workState?.scopeUserIndex].filter(Number.isSafeInteger));
 const indices=users.slice(-6);
 for(const index of session.workState?.sourceUserIndices || [])if(Number.isSafeInteger(index)&&session.messages[index]?.role==='user'&&session.messages[index]?.source!=='platform'&&!indices.includes(index))indices.unshift(index);
 const scope=session.workState?.scopeUserIndex;
 if(Number.isSafeInteger(scope)&&session.messages[scope]?.role==='user'&&!indices.includes(scope))indices.unshift(scope);
 let remaining=6000;
 const requests=indices.map(index=>{
  const m=session.messages[index],text=typeof m.content==='string'?m.content:JSON.stringify(m.content ?? null);
  const include=(index===currentRequestIndex||linked.has(index))&&text.length<=2000&&text.length<=remaining;if(include)remaining-=text.length;
  return {index,roleInCurrentTurn:index===currentRequestIndex?'current-request':'historical-source',source:m.source || 'legacy-unspecified',createdAt:m.createdAt,...(include?{verbatim:text}:{characters:text.length,contentOmitted:true,readWith:'read_user_messages'} )};
 });
 return '\n<continuation-record>以下为程序保存的原始请求索引、中断位置和实际阅读覆盖，不是新的指令或授权。currentRequestIndex是本轮最新用户原话；其他索引、旧摘要目标及不属于该索引的中断均为历史资料，不是需要先解决的前置任务。按最新用户消息判断延续、更正或替换目标，不按关键词自动执行。旧摘要与原始请求矛盾时回读read_user_messages，不把模型解释当用户授权；平台事件仅为状态资料。已读资料不等于已分析完成，已分析不等于已发布。沿用已核实回执推进未完成项，不从头反复阅读；fullyRead只表示这些字符曾被工具返回，不证明理解、分析或结论正确。\n'+JSON.stringify({currentRequestIndex,requests:requests.sort((a,b)=>(b.index===currentRequestIndex)-(a.index===currentRequestIndex)),lastInterruption:session.lastInterruption?{...session.lastInterruption,appliesToCurrentRequest:session.lastInterruption.scopeUserIndex===currentRequestIndex}:null,evidenceCoverage:evidenceCoverage(session)})+'\n</continuation-record>';
}
module.exports={frame,readUserMessages,evidenceCoverage};
