// User-requested fallback, NOT a claim about another model's actual capacity.
// https://api-docs.deepseek.com/api/list-models/ (DeepSeek V4, 2026-10-14)
const DEEPSEEK_CONTEXT_WINDOW = 1048576;
const cache = new Map();
const positive = n => Number.isSafeInteger(n) && n > 0;
async function resolveModelCapacity(provider, {fetchImpl=fetch, now=Date.now, timeoutMs=5000}={}) {
  if(positive(provider.contextWindowTokens)) return {...provider,contextWindowSource:'configured'};
  const key=JSON.stringify([provider.baseUrl,provider.model,provider.apiKey]);
  const cached=cache.get(key);
  if(cached && cached.until>now()) return {...provider,...await cached.result};
  const result=(async()=>{
    try {
      const base=String(provider.baseUrl||'').replace(/\/+$/,'').replace(/\/chat\/completions$/,'');
      const url=new URL(`${base}${/\/v1$/.test(base)?'':'/v1'}/models`);
      if(!['https:','http:'].includes(url.protocol)) throw Error('Invalid model service');
      const response=await fetchImpl(url,{headers:provider.apiKey?{Authorization:`Bearer ${provider.apiKey}`} : {},signal:AbortSignal.timeout(timeoutMs),redirect:'error'});
      if(response.ok) {
        const data=await response.json();
        const model=data.data?.find(m=>m.id===provider.model);
        const capacity=model?.context_window ?? model?.contextWindow ?? model?.context?.contextWindow;
        if(positive(capacity)) return {contextWindowTokens:capacity,contextWindowSource:'service-metadata'};
      }
    } catch { /* Capability discovery is optional; no credentials or response bodies logged. */ }
    return {contextWindowTokens:DEEPSEEK_CONTEXT_WINDOW,contextWindowSource:'deepseek-fallback'};
  })();
  // Bounded cache; credentials are used only to isolate discovery across accounts.
  if(cache.size>=32) cache.delete(cache.keys().next().value);
  cache.set(key,{until:now()+300000,result});
  return {...provider,...await result};
}
module.exports={resolveModelCapacity,DEEPSEEK_CONTEXT_WINDOW};
