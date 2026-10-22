const {setTimeout:delay}=require('node:timers/promises');
function safeToRetryConnect(error) {
 const d=error?.diagnostics || {};
 return d.stage==='connect' && d.transportObserved===true && d.connectionFailureObserved===true &&
  d.transportRequestCount===1 && d.requestHeadersSent===false && d.requestBodySent===false &&
  d.connectionErrorCode==='UND_ERR_CONNECT_TIMEOUT' && d.causes?.some(c=>c.code==='UND_ERR_CONNECT_TIMEOUT') &&
  d.httpStatus===undefined && d.streamBytes===0;
}
async function withConnectRetry(run,{signal,onRetry=()=>{},wait=delay,now=Date.now}={}) {
 try { return await run(); } catch(error) {
  if(signal?.aborted || !safeToRetryConnect(error))throw error;
  try {
   onRetry({reason:'connect-timeout',attempt:1,maxAttempts:1,retryAt:now()+1000});
   await wait(1000,undefined,{signal});signal?.throwIfAborted();
  } finally { onRetry(null); }
  try {return await run();} catch(finalError) {
   if(finalError.diagnostics)finalError.diagnostics.connectionRetryCount=1;
   throw finalError;
  }
 }
}
module.exports={safeToRetryConnect,withConnectRetry};
