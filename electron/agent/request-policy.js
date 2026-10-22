const DEFAULTS = Object.freeze({stream:true,conversationReasoning:'inherit',summaryReasoning:'inherit',summaryMaxTokens:8192,inputBudgetTokens:65536,firstResponseSeconds:45,idleSeconds:45,totalSeconds:180,minIntervalMs:1000});
function requestPolicy(input={}) {
  const result={...DEFAULTS,...input};
  if(Object.keys(input).some(k=>!(k in DEFAULTS)) || typeof result.stream!=='boolean' || !['inherit','low'].includes(result.conversationReasoning) || !['inherit','disabled','low'].includes(result.summaryReasoning)) throw Error('模型请求设置格式无效');
  for(const [key,min,max] of [['summaryMaxTokens',1024,32768],['inputBudgetTokens',8192,262144],['firstResponseSeconds',5,300],['idleSeconds',5,300],['totalSeconds',10,900],['minIntervalMs',0,30000]])
    if(!Number.isSafeInteger(result[key]) || result[key]<min || result[key]>max) throw Error(`${key} 必须在 ${min}–${max} 之间`);
  if(result.totalSeconds<result.firstResponseSeconds || result.totalSeconds<result.idleSeconds) throw Error('总时限不能小于首响应或输出停滞时限');
  return result;
}
// An application request budget is distinct from the provider's actual capacity.
function boundedProvider(provider) {
  if(!provider.requestPolicy) return provider;
  const p=requestPolicy(provider.requestPolicy),output=provider.maxOutputTokens ?? 16384;
  return {...provider,contextWindowTokens:Math.min(provider.contextWindowTokens ?? Infinity,p.inputBudgetTokens+output)};
}
module.exports={DEFAULTS,requestPolicy,boundedProvider};
function inputEstimate(messages,tools=[]){
  // Base64 is transport bytes, not textual tokens. Visual pricing is provider-specific.
  return require('./context').estimateTokens({messages:messages.map(m=>({...require('./context').wireMessage(m),content:Array.isArray(m.content)?m.content.map(b=>b.type==='image_url'?{type:'image_url'}:b):m.content})),tools});
}
module.exports.inputEstimate=inputEstimate;
