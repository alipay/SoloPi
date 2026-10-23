// Explicit development diagnostics only. Workflow provider configuration is immutable.
function developmentProvider(provider,{development=false,model,thinking}={}) {
  if(!development || !model)return {...provider};
  if(typeof model!=='string'||!model.trim()||model.length>200||/[\0\r\n]/.test(model))throw Error('开发 Agent 模型名称无效');
  if(thinking!==undefined && !['default','enabled','disabled'].includes(thinking))throw Error('开发 Agent 思考设置无效');
  return {...provider,model,...(thinking!==undefined?{thinking}:{})};
}
module.exports={developmentProvider};
