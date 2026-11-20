// Ages are observations, not proof that a static device screen is broken.
function previewHealth(e,at,{sourceIdleMs=8000,ackTimeoutMs=3000}={}){
 const age=t=>Math.max(0,at-(t??at));
 const sample={sourceAgeMs:age(e.lastSourceAt),ackAgeMs:age(e.lastAckAt),presentAgeMs:age(e.lastPresentedAt??e.healthStartedAt),pendingFrameAgeMs:e.pendingFrame?age(e.pendingAt):0,queueMessages:e.queue.length,gopBytes:e.gopBytes||0,pendingAcks:e.pendingFrame?1:0};
 const stage=sample.sourceAgeMs>=sourceIdleMs?'source-idle':e.pendingFrame&&sample.pendingFrameAgeMs>=ackTimeoutMs?'ack-timeout':sample.presentAgeMs>=sourceIdleMs?'presentation-idle':'flowing';
 return{stage,...sample};
}
module.exports={previewHealth};
