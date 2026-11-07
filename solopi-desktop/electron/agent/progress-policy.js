// Deterministic, local progress checks. Never infer authorization or business intent.
const scope = s => s.messages.findLastIndex(m=>m.role==='user' && m.source!=='platform');
const activeWork = s => s.workState && s.workState.scopeUserIndex===scope(s) && !s.workState.resolution;
function completeWork(s,args,tools) {
 if(!activeWork(s))throw Error('没有本轮待收尾的工作状态；普通问答直接回复即可');
 const calls=args.sourceCallIds.map(id=>s.calls.find(c=>c.modelCallId===id));
 if(calls.some(c=>!c || c.scopeUserIndex!==scope(s) || c.status!=='done' || c.result?.success===false || c.result?.found===false))throw Error('收尾必须引用本轮有效回执，不能引用失败、未命中或历史操作');
 const substantive=calls.filter(c=>!['update_work_state','finish_work','discover_tools','list_skills','read_skill','read_skill_reference','read_command_help','search_experiences'].includes(c.name));
 if(args.outcome==='completed' && !substantive.length)throw Error('只有准备资料回执，不能标记任务完成');
 const operationReceipt=c=>{
  // scopeUserIndex already binds every cited receipt to the current human request.
  // Recording progress (updatedAt) must not invalidate an operation completed
  // before that progress note or require replaying a successful write.
  if(tools.some(t=>t.name===c.name && t.confirm===true))return true;
  // Observing an already successful write must not require replaying that write.
  if(c.name==='read_operation_receipt'){
   const original=s.calls.find(x=>x.modelCallId===c.args?.callId || x.id===c.args?.callId);
   return original?.status==='done' && original.result?.success===true && c.result?.status==='done' && tools.some(t=>t.name===original.name && t.confirm===true);
  }
  return false;
 };
 if(args.outcome==='completed' && s.workState.completionMode!=='analysis' && !substantive.some(operationReceipt))throw Error('执行任务缺少本轮成功操作回执；引用本轮操作，或用read_operation_receipt核实已有成功操作，不要重做写入；分析任务用completionMode=analysis');
 s.workState.resolution={outcome:args.outcome,summary:args.summary,sourceCallIds:args.sourceCallIds,at:new Date().toISOString()};
 return {success:true,...s.workState.resolution,receiptVerified:true,businessOutcomeVerified:false};
}
function resultKey(call,result){
 if(result?.errorCode==='SKILL_RELOAD_REQUIRED')return JSON.stringify(['skill-reload',(result.skillReload?.documents||[]).map(d=>[d.name,d.file]).sort()]);
 if(result?.referenceReuse || result?.alreadyRead || result?.found===false || result?.success===false)return JSON.stringify([call.name,call.args,result?.errorCode,result?.error,result?.found,result?.total]);
 return null;
}
function observe(state,call,result,maxNoProgress=3){
 const key=resultKey(call,result);
 state.observations=(state.observations||0)+1;
 if(!key)return;
 const prior=state.stalls.get(key);const n=prior && state.observations-prior.last<=20 ? prior.count+1 : 1;state.stalls.set(key,{count:n,last:state.observations});
 if(state.stalls.size>40)state.stalls.delete(state.stalls.keys().next().value);
 if(n>=maxNoProgress)throw Object.assign(Error('本轮连续重复同一无进展结果，已停止自动循环。任务未完成；已有回执保留，请按具体错误恢复。'),{code:'AGENT_NO_PROGRESS'});
}
module.exports={scope,activeWork,completeWork,observe};
