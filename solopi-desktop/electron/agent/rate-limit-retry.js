const {setTimeout:delay}=require('node:timers/promises');
function isRateLimit(error) {
 const d=error?.diagnostics || {};
 if(/insufficient_quota|billing|credit|spend_limit|usage_limit|quota_exceeded/i.test([d.upstreamCode,d.upstreamType].join(' '))) return false;
 return d.httpStatus===429 || String(d.upstreamCode)==='429' || /^(rate_limit_error|RateLimitError|rate_limit_exceeded)$/.test(d.upstreamType || d.upstreamCode || '');
}
// Only retry a positively observed uploaded request before any HTTP response.
// No model result (and hence no new tool operation) can have been delivered.
function responseRetryReason(error) {
 const d=error?.diagnostics || {},codes=(d.causes || []).map(c=>c.code);
 if(d.stage!=='connect' || d.transportObserved!==true || d.transportRequestCount!==1 ||
  d.requestHeadersSent!==true || d.requestBodySent!==true || d.httpStatus!==undefined ||
  d.headersMs!==undefined || d.streamBytes!==0 || (d.outputCharacters || 0)>0 || (d.reasoningCharacters || 0)>0)return null;
 if(d.category==='timeout' && d.timeoutKind==='first-response' && codes.includes('MODEL_REQUEST_TIMEOUT'))return 'first-response-timeout';
 return null;
}
async function withRateLimitRetry(run,{signal,onRetry=()=>{},wait=delay,now=Date.now}={}) {
 const waits=[5000,15000,30000];
 let pending=false;
 try {
  for(let attempt=0;;attempt++) {
   signal?.throwIfAborted();
   try {return await run();} catch(error) {
    const reason=isRateLimit(error)?'rate-limit':responseRetryReason(error);
    if(!reason || attempt>=waits.length || signal?.aborted){
     if(attempt>0){if(error.diagnostics)error.diagnostics.automaticRetryCount=attempt;error.message+=` 已自动重试 ${attempt} 次，未获得完整结果；本轮不再重试。`;}
     throw error;
    }
    const delayMs=waits[attempt];
    pending=true;
    onRetry({reason,attempt:attempt+1,maxAttempts:3,retryAt:now()+delayMs});
    await wait(delayMs,undefined,{signal});
    pending=false;onRetry(null);
   }
  }
 } finally {if(pending)onRetry(null);}
}
module.exports={isRateLimit,responseRetryReason,withRateLimitRetry};
