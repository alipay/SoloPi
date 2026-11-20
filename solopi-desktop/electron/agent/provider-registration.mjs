// Same provider construction for every Harness host; credentials remain injected.
import{apply as installPiAi,Config as PiConfig}from'@deepseek-ai/dsh-llm-pi-ai';
import recovery from'./harness-request-recovery.js';
export function registerConfiguredProvider(ctx,provider){
 ctx.provide('credentials',{resolve:async()=>provider.apiKey?{value:provider.apiKey,source:provider.source||'host-config'}:undefined,readRecord:async()=>undefined,listRecords:async()=>[]});
 const api=provider.protocol||'openai-completions';
 const configured={api,baseURL:provider.baseUrl,apiKeyEnv:'SOLOPI_MODEL_KEY',retryPolicy:recovery.retryPolicy,models:[{id:provider.model,input:provider.inputModalities||['text','image'],...(provider.contextWindowTokens?{contextWindow:provider.contextWindowTokens}:{}),...(provider.maxOutputTokens?{maxTokens:provider.maxOutputTokens}:{})}],...(api==='openai-completions'?{compat:{supportsDeveloperRole:false,supportsStore:false,maxTokensField:'max_tokens'}}:{}),...(api==='anthropic-messages'&&provider.authMode==='bearer'?{headers:{Authorization:'Bearer '+provider.apiKey}}:{}),...(provider.apiKey?{}:{apiKeyEnv:undefined})};
 installPiAi(ctx,PiConfig({providers:{configured}}));
}
