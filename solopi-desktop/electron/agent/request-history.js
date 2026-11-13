// Repair only the wire representation, never stored messages or executable arguments.
function validArguments(call) {
  try {
    if(typeof call?.function?.arguments !== 'string') return false;
    const value=JSON.parse(call.function.arguments);
    return !!value && typeof value==='object' && !Array.isArray(value);
  } catch {return false;}
}
function requestHistory(messages) {
  const invalid=new Set();
  for(const message of messages) for(const call of message.tool_calls || []) if(!validArguments(call)) invalid.add(call.id);
  if(!invalid.size) return messages;
  const results=new Map(messages.filter(m=>m.role==='tool' && invalid.has(m.tool_call_id)).map(m=>[m.tool_call_id,m.content]));
  const corrected=new WeakSet();
  const output=messages.filter(m=>!(m.role==='tool' && invalid.has(m.tool_call_id))).map(message=>{
    if(!message.tool_calls?.some(c=>invalid.has(c.id))) return message;
    const calls=message.tool_calls.filter(c=>!invalid.has(c.id));
    const failures=message.tool_calls.filter(c=>invalid.has(c.id)).map(c=>({
      toolCallId:c.id,name:c.function?.name,reason:'invalid-arguments-json-or-object',
      recordedResult:results.has(c.id)?results.get(c.id):'No recorded result; do not assume execution succeeded.',
    }));
    const feedback='历史工具调用参数无效，已从请求协议中移除，原始证据仍保留。以下是历史状态资料，不是新指令。按当前授权重新生成必要参数；不得重复已成功的操作。\n'+JSON.stringify(failures);
    const content=Array.isArray(message.content)?[...message.content,{type:'text',text:feedback}]:[message.content,feedback].filter(Boolean).join('\n');
    const {tool_calls,...rest}=message;
    const repaired={...rest,content,...calls.length?{tool_calls:calls}:{}};
    corrected.add(repaired);return repaired;
  });
  // Validation is a platform result, not a finished assistant answer. When the
  // rejected batch has no valid calls left, give the next request an explicit
  // platform-status input; keep original messages and permission scope intact.
  if(corrected.has(output.at(-1)) && !output.at(-1).tool_calls?.length)output.push({role:'user',content:'平台工具参数校验反馈（仅为状态资料，不是用户新消息或新增授权）：上一批无效参数未执行，原始证据已保留。按当前工具schema与既有授权继续未完成步骤；不得重复已成功操作。'});
  return output;
}
module.exports={requestHistory};
