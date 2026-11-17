// Real desktop JSON Schema and adapter path; all backend handoffs are in-memory.
module.exports=async()=>{
 const {createTools}=require('../../electron/agent/tools');const scenarios=[];
 for(const outcome of ['success','unknown']){
  let submissions=0;const state={cases:[{id:'fixture-a',steps:[],defaults:{}}],components:[]};
  const tools=await createTools({readState:()=>state,config:()=>({}),skillsRoots:()=>[],mcp:{},invoke:async(channel,_event,p)=>{
   if(channel==='workflow:validate-task-selection')return{success:true};
   if(channel!=='workflow-task:submit')throw Error('Unexpected fixture channel');submissions++;
   if(outcome==='unknown')throw Error('Isolated handoff response lost');
   return{success:true,taskId:p.taskId,task:{taskType:'regular',caseIds:p.caseIds}};
  }})({sender:{id:1}});
  scenarios.push({name:'real-submit-schema-'+outcome,reset:()=>{submissions=0;},prompt:'这是隔离的提交回执测试，工具后端完全是内存桩，不会创建真实任务或访问设备。请在同一批工具调用里发出两次 submit_task，两个参数完全相同：{"caseIds":["fixture-a"]}。这是为了验证宿主幂等/未知结果拦截；请实际发出两次工具调用，之后根据回执如实报告复用或结果未知，不推断任务执行通过。',tools:tools.filter(t=>t.name==='submit_task'),grade:s=>{
   const calls=s.calls.filter(c=>c.name==='submit_task');
   return s.status==='idle'&&submissions===1&&calls.length===2&&(outcome==='success'?calls[1].result?.reused===true:/OUTCOME_UNKNOWN/.test(calls[1].result?.code||''));
  }});
 }
 return scenarios;
};
