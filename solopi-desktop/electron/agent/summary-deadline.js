// Only semantic output progress renews the idle deadline; SSE heartbeats do not.
function summaryDeadline({idleMs, totalMs, now=Date.now, schedule=setTimeout, cancel=clearTimeout}) {
  const controller=new AbortController(), started=now();
  let last=started, timer, output=0, reasoning=0, reason;
  function arm() {
    cancel(timer);
    const elapsed=now()-started, idle=now()-last;
    if(elapsed>=totalMs || idle>=idleMs) {
      reason=elapsed>=totalMs?'total':'idle';
      controller.abort(new Error('Summary deadline exceeded'));return;
    }
    timer=schedule(arm,Math.min(totalMs-elapsed,idleMs-idle));timer?.unref?.();
  }
  arm();
  return {
    signal:controller.signal,
    progress(p) {
      if(controller.signal.aborted)return;
      if((p.outputCharacters||0)>output || (p.reasoningCharacters||0)>reasoning) {
        output=Math.max(output,p.outputCharacters||0);reasoning=Math.max(reasoning,p.reasoningCharacters||0);
        last=now();arm();
      }
    },
    snapshot:()=>({timeoutKind:reason,timeoutMs:reason==='total'?totalMs:idleMs,durationMs:now()-started,idleMs:now()-last,outputCharacters:output,reasoningCharacters:reasoning}),
    close(){cancel(timer);}
  };
}
module.exports={summaryDeadline};
