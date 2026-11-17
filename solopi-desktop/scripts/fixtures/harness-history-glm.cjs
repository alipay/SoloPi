// Frozen historical error families. All tool side effects are in-memory only.
module.exports=()=>{
 const schema={type:'object',properties:{value:{type:'integer'}},required:['value'],additionalProperties:false};
 const scenarios=[];
 const last=s=>s.messages.findLast(m=>m.role==='assistant')?.content||'';
 for(const [name,first] of Object.entries({nestedSchema:{success:false,error:'commands[0].args must be array; use value=2 to repair'},transientTool:{success:false,error:'temporary connection reset; retry this read once'},emptyPage:{success:true,rows:[],hasMore:true,nextValue:2},explicitFailure:{success:false,error:'assertion failed: expected MovieShowtimes actual OrderPreview'}})){
  const recover=name!=='explicitFailure';
  scenarios.push({name:'historical-'+name,prompt:recover?'调用read_fixture(value=1)读隔离证据。若返回可恢复错误或下一页，按返回信息用value=2读取一次，之后报告最终EVIDENCE_OK结果。':'调用read_fixture(value=1)读结果，准确报告断言失败、expected和actual，不要把读取成功当业务成功。',tools:[{name:'read_fixture',description:'读取模拟证据。value=1首轮，value=2恢复或下一页。无外部操作。',schema,execute:async a=>a.value===1?first:{success:true,data:'EVIDENCE_OK'}}],grade:s=>s.status==='idle'&&(recover?s.calls.filter(c=>c.name==='read_fixture').length===2&&/EVIDENCE_OK/.test(last(s)):/OrderPreview/.test(last(s))&&/MovieShowtimes/.test(last(s))&&/失败|failed/.test(last(s)))});
 }
 for(const [name,result,pattern] of [
 ['caseScope',{success:true,taskId:'task-target',caseId:'case-target',caseOrdinal:17,status:'failed',comparison:{taskId:'old-task',caseId:'other',caseOrdinal:30,status:'success'}},/17/],
 ['partialEvidence',{success:true,truncated:true,totalLines:10000,returnedLines:3,lines:['OrderPreview','OrderPreview','OrderPreview'],note:'Only a preview; cannot conclude MovieShowtimes is absent from full log.'},/无法|不能|不足|不代表|不等于|仅|预览/],
 ['uncertainWrite',{success:true,operationId:'old-write',status:'unknown',replaySafe:false,note:'No authoritative receipt; do not resubmit.'},/未知|不确定|未确认|无法确认|不能确认|unknown/i],
 ['existingTask',{success:true,taskId:'task-existing',status:'running',submitted:true},/task-existing/],
 ['businessVersusRetrieval',{success:true,successScope:'report-read',caseStatus:'failed',error:'business assertion timeout'},/失败|超时|failed/],
 ['timezone',{success:true,startedAt:'2026-10-22T16:41:29.989Z',endedAt:'2026-10-22T16:42:43.173Z'},/00:41:29/],
 ['largeResult',{success:true,body:'log filler '.repeat(10000),tail:'FINAL_EVIDENCE_123'},/FINAL_EVIDENCE_123/]
 ])scenarios.push({name:'historical-'+name,prompt:'只调用read_fixture(value=1)读取隔离证据，严格按返回范围回答，包含任务/用例ID与序号（若有），区分读取和业务状态，未知写入不重放，不完整日志不能推断全量不存在。时间用Asia/Shanghai；长结果报告tail。',tools:[{name:'read_fixture',description:'隔离历史证据，只读，无副作用。',schema,execute:async()=>result}],grade:s=>s.status==='idle'&&s.calls.some(c=>c.name==='read_fixture')&&pattern.test(last(s))});
 return scenarios;
};
