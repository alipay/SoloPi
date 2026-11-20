'use strict';
// Knowledge tools use the existing authenticated Client connection, never a second model/key store.
function contextTools(connection,context={}){
 const object=properties=>({type:'object',properties,additionalProperties:false});
 const string={type:'string'},query={...string,maxLength:12000},id={...string,maxLength:128};
 const call=async(operation,input,signal)=>{const s=connection.connector.session;if(!s)throw Error('SESSION_REQUIRED');return connection.connector.call('POST','/v1/lab/context',{sessionId:s.sessionId,epoch:s.epoch,operation,input:{...input,commandId:context.chatCommandId}},s.sessionId,signal);};
 const tool=(name,description,operation,schema)=>({name,description,schema,readOnly:operation!=='save',execute:(args,{signal,operationId})=>call(operation,operation==='save'?{...args,requestId:operationId}:args,signal)});
 return [
  tool('browse_context','读取本项目及当前会话已验证资料目录和摘要；按分类缩小范围，再读取相关原文。','browse',object({category:{enum:['business-rule','component','case','troubleshooting','decision']}})),
  tool('search_context','查找编写用例或排查问题的已验证依据。返回资料ID、版本、来源及片段，不能把历史结论当成当前任务执行结果。','retrieve',{...object({query}),required:['query']}),
  tool('read_context','按检索结果的资料ID读取原文；过期或撤销的版本拒绝读取。','read',{...object({id}),required:['id']}),
  tool('propose_context','沉淀本轮经验为待验证资料，不会自动成为已验证规则。必须记录真实来源和证据，不能保存密钥。','save',{...object({title:{...string,maxLength:250},category:{enum:['business-rule','component','case','troubleshooting','decision']},content:{...string,maxLength:50000},source:string,evidence:{type:'array',items:string,maxItems:30}}),required:['title','category','content','source','evidence']})
 ];
}
module.exports={contextTools};
