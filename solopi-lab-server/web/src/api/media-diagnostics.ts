// Numeric lifecycle events only; never store stream URLs, tickets, or video data.
export function recordMediaDiagnostic(sessionId:string,clientId:string,stage:string,code:string,durationMs:number,ready=false,toolName='media.'+stage){
 const body={event:ready?'web.media.ready':'web.media.failed',requestId:sessionId,clientId,stage,toolName,code,durationMs,status:ready?'succeeded':'failed'};
 try{void fetch('/lab/diagnostics/events',{method:'POST',headers:{'Content-Type':'application/json','X-Request-ID':sessionId},body:JSON.stringify(body),keepalive:true,signal:AbortSignal.timeout(3000)}).catch(()=>{});}catch{}
}
