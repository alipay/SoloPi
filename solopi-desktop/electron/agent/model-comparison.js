const {createHash}=require('node:crypto');
function stats(rows){const ok=rows.filter(r=>r.success),values=ok.map(r=>r.durationMs).sort((a,b)=>a-b),middle=Math.floor(values.length/2);return {attempts:rows.length,successes:ok.length,successRate:rows.length?ok.length/rows.length:0,medianMs:values.length?(values.length%2?values[middle]:(values[middle-1]+values[middle])/2):null};}
async function compareModels(snapshot,{pairs=3,signal,model=require('./model').requestModel,onUpdate=()=>{}}={}){
  if(!Number.isSafeInteger(pairs)||pairs<1||pairs>5)throw Error('对照轮数必须为1–5');
  const frozen=structuredClone(snapshot),rows=[];
  const ajv=new (require('ajv'))({strict:false,allErrors:true});
  const validators=new Map((frozen.tools || []).map(t=>[t.function.name,ajv.compile(t.function.parameters)]));
  const inputHash=createHash('sha256').update(JSON.stringify({messages:frozen.messages,tools:frozen.tools,maxTokens:frozen.maxTokens,model:frozen.provider.model,thinking:frozen.provider.thinking,reasoningEffort:frozen.provider.reasoningEffort})).digest('hex');
  const report=()=>({inputHash,model:frozen.provider.model,pairs,rows:[...rows],streaming:stats(rows.filter(r=>r.stream)),nonStreaming:stats(rows.filter(r=>!r.stream)),status:signal?.aborted?'cancelled':'running'});
  for(let pair=0;pair<pairs;pair++)for(const stream of pair%2?[false,true]:[true,false]){
    if(signal?.aborted){onUpdate(report());return report();}
    const start=performance.now();let metrics,toolCallCount,toolArgumentsValid;
    try {
      const response=await model({...structuredClone(frozen),stream,signal,purpose:'comparison',retry:false,onMetrics:m=>{metrics=m;}});
      toolCallCount=response?.tool_calls?.length || 0;toolArgumentsValid=true;
      for(const call of response?.tool_calls || []) {
        const validate=validators.get(call.function?.name);
        let args;try{args=JSON.parse(call.function?.arguments);}catch{}
        if(!validate || !args || !validate(args)) {
          toolArgumentsValid=false;
          throw Object.assign(Error('模型工具参数不符合本次冻结的 schema；未执行任何工具'),{diagnostics:{category:'invalid-tool-arguments',stage:'schema'}});
        }
      }
      rows.push({pair:pair+1,stream,success:true,durationMs:performance.now()-start,...metrics,toolCallCount,toolArgumentsValid});
    }catch(error){rows.push({pair:pair+1,stream,success:false,durationMs:performance.now()-start,error:error.message,diagnostics:error.diagnostics,...metrics,toolCallCount,toolArgumentsValid});}
    onUpdate(report());
  }
  const result={...report(),status:signal?.aborted?'cancelled':'completed'};onUpdate(result);return result;
}
module.exports={compareModels,stats};
