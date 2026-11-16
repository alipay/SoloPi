const transientCodes=new Set(['LLM_RESPONSE_EMPTY','LLM_REQUEST_TIMEOUT','ECONNRESET','ECONNREFUSED','ETIMEDOUT','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT']);
function retryable(error){
 if(['WORKFLOW_STOPPED','LLM_ACCESS_DENIED','LLM_ACCOUNT_LIMITED','LLM_RESPONSE_TRUNCATED'].includes(error?.code))return false;
 return transientCodes.has(error?.code)||transientCodes.has(error?.cause?.code)||error?.code==='LLM_RATE_LIMITED'||[408,429,500,502,503,504].includes(error?.httpStatus);
}
function sleep(ms,signal){
 return new Promise((resolve,reject)=>{
  signal?.throwIfAborted();
  const done=()=>{signal?.removeEventListener('abort',abort);resolve();};
  const timer=setTimeout(done,ms);
  const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason);};
  signal?.addEventListener('abort',abort,{once:true});
 });
}
async function run(request,{timeoutMs=45000,signal,now=Date.now,wait=sleep,recover,perAttempt=false}={}){
 const start=now(),attempts=[];
 try{
  for(let attempt=1;attempt<=3;attempt++){
   signal?.throwIfAborted();
   const remaining=perAttempt ? timeoutMs : timeoutMs-(now()-start);
   if(remaining<=0)throw Object.assign(Error(`LLM 请求总超时：${timeoutMs}ms`),{code:'LLM_REQUEST_TIMEOUT'});
   const started=now();
   try{
    const value=await request({attempt,timeoutMs:perAttempt ? remaining : Math.min(30000,remaining)});
    signal?.throwIfAborted();
    attempts.push({attempt,status:'success',timeoutMs:perAttempt ? timeoutMs : Math.min(30000,remaining),durationMs:now()-started});
    return {value,retry:{mode:perAttempt?'per-attempt':'total',maxAttempts:3,attemptTimeoutMs:perAttempt?timeoutMs:undefined,attemptCount:attempts.length,attempts,totalDurationMs:now()-start}};
   }catch(error){
    signal?.throwIfAborted();
    attempts.push({attempt,status:'failed',timeoutMs:perAttempt ? timeoutMs : Math.min(30000,remaining),code:error.code||error.cause?.code||'REQUEST_FAILED',httpStatus:error.httpStatus,response:error.meta?.llmResponse,durationMs:now()-started});
    const delay=Math.max(500*attempt,Number(error.retryAfterMs)||0);
    if(attempt===3||(perAttempt ? delay>1000 : timeoutMs-(now()-start)<=delay+250))throw error;
    if(!retryable(error) && !recover?.(error))throw error;
    await wait(delay,signal);
   }
  }
 }catch(error){
  error.meta={...(error.meta||{}),llmRetry:{mode:perAttempt?'per-attempt':'total',maxAttempts:3,attemptTimeoutMs:perAttempt?timeoutMs:undefined,attemptCount:attempts.length,attempts,totalDurationMs:now()-start}};
  throw error;
 }
}
module.exports={run,retryable};
