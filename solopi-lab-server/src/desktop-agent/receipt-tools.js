// Host storage implements lookup/project; schema and returned semantics are shared.
const facts=require('./context-receipts').facts;
function operationReceiptTool({lookup,project}){
 return{name:'read_operation_receipt',description:'回读本会话已有工具回执，不重新执行。pointers可选，使用JSON Pointer按需读取；大结果给出摘要及完整证据定位。',readOnly:true,schema:{type:'object',properties:{callId:{type:'string'},pointers:{type:'array',minItems:1,maxItems:20,items:{type:'string'}}},required:['callId'],additionalProperties:false},execute:async({callId,pointers})=>{
  const rows=await lookup(callId);if(rows.length!==1)return{success:false,code:rows.length?'AMBIGUOUS_OPERATION_RECEIPT':'RECEIPT_NOT_FOUND',operationIds:rows.map(c=>c.id)};
  const c=rows[0],receipt={success:true,successScope:'receipt-query',callId:c.modelCallId||c.id,operationId:c.id,name:c.name,status:c.status,finishedAt:c.finishedAt};
  if(!pointers&&JSON.stringify(c.result??null).length<=6000)return{...receipt,result:c.result};
  return{...receipt,result:facts(c.result),...await project(c,pointers||[''])};
 }};
}
function userMessagesTool({messages}){return{name:'read_user_messages',description:'回读本对话原始用户消息，平台状态通知不是新增授权。',readOnly:true,schema:{type:'object',properties:{indices:{type:'array',minItems:1,maxItems:8,items:{type:'integer',minimum:0}}},required:['indices'],additionalProperties:false},execute:async({indices})=>require('./continuation-memory').readUserMessages({messages:await messages()},indices)};}
module.exports={operationReceiptTool,userMessagesTool};
