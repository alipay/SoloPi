// Headers and semantic output have separate deadlines. SSE heartbeats are not output.
function requestDeadline(policy,{now=Date.now,schedule=setTimeout,cancel=clearTimeout}={}) {
  const controller=new AbortController(),start=now();let last=start,lastStreamData,received=false,timer,kind;
  function arm(){
    cancel(timer);const elapsed=now()-start,wait=now()-last;
    const limit=(received?policy.idleSeconds:policy.firstResponseSeconds)*1000;
    if(elapsed>=policy.totalSeconds*1000 || wait>=limit){kind=elapsed>=policy.totalSeconds*1000?'total':received?'idle':'first-response';controller.abort(Object.assign(Error('Model deadline exceeded'),{code:'MODEL_REQUEST_TIMEOUT'}));return;}
    timer=schedule(arm,Math.min(policy.totalSeconds*1000-elapsed,limit-wait));timer?.unref?.();
  }
  arm();
  return {signal:controller.signal,headers(){if(!received){received=true;last=now();arm();}},progress(){received=true;last=now();arm();},transportProgress(){lastStreamData=now();},close(){cancel(timer);},snapshot:()=>({semanticIdleMs:Math.max(0,now()-last),...(lastStreamData===undefined?{}:{streamIdleMs:Math.max(0,now()-lastStreamData)}),timeoutKind:kind,timeoutMs:(kind==='total'?policy.totalSeconds:kind==='first-response'?policy.firstResponseSeconds:policy.idleSeconds)*1000})};
}
module.exports={requestDeadline};
