'use strict';
// Private async boundary. Host injects reviewed normalizer/verdict checker and trusted native policy.
// No connector, credential store, timer, retry loop, or execution permission is created here.
const fail=code=>Object.assign(new Error(code),{code});
const plain=v=>v&&Object.getPrototypeOf(v)===Object.prototype;
class GroupGrantProvider {
 constructor({getSession,call,normalize,checkVerdict,trustedExecution=()=>false}){
  if([getSession,call,normalize,checkVerdict,trustedExecution].some(f=>typeof f!=='function'))throw fail('GROUP_INVALID');
  Object.assign(this,{getSession,call,normalize,checkVerdict,trustedExecution});this.permits=new WeakMap();
 }
 session(context){
  const s=this.getSession();
  if(!plain(s)||s.clientId!==context.clientId||s.epoch!==context.epoch||!Number.isSafeInteger(s.epoch)||s.epoch<1||typeof s.sessionId!=='string'||!s.sessionId)throw fail('GROUP_OWNER_MISMATCH');
  return s;
 }
 binding(wire,context){
  const outer=Object.fromEntries(['clientId','dispatchId','requestId','groupId','expectedRevision','memberSha256','payloadSha256','payloadBytes','dispatchPlanSha256'].map(k=>[k,wire[k]]));
  const b=this.normalize(wire,outer,{clientUlid:context.clientId});
  if(!plain(b))throw fail('GROUP_AUTHORIZATION_REQUIRED');return b;
 }
 policy(wire,context,phase){if(this.trustedExecution(wire,context,phase)!==true)throw fail('GROUP_AUTHORIZATION_REQUIRED');}
 same(record,context){
  const s=this.session(context);
  if(s!==record.session||s.sessionId!==record.sessionId||s.epoch!==record.epoch||context.epoch!==record.epoch)throw fail('GROUP_RECONCILIATION_REQUIRED');
 }
 async verify(wire,context,phase){
  const session=this.session(context),sessionId=session.sessionId,epoch=session.epoch;
  this.policy(wire,context,phase);const binding=this.binding(wire,context);
  const response=await this.call('POST','/v1/group-grants/verify',{clientId:context.clientId,requestId:wire.requestId},sessionId,context.signal);
  const record={session,sessionId,epoch,phase,binding,verdict:response};this.same(record,context);
  if(!plain(response)||!Number.isSafeInteger(response.sessionEpoch)||response.sessionEpoch!==epoch||!Object.hasOwn(response,'cancelRequestedAt'))throw fail('GROUP_AUTHORIZATION_REQUIRED');
  if(response.cancelRequestedAt!==null&&(typeof response.cancelRequestedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(response.cancelRequestedAt)||!Number.isFinite(Date.parse(response.cancelRequestedAt))))throw fail('GROUP_INVALID');
  if(response.cancelRequestedAt!==null){
   // Authenticated request-scoped stop fact is independent of grant validity. Preserve it
   // even if the grant expires in transit; it can only produce a denied stop permit.
   for(const [key,value] of Object.entries(binding)){
    const field=key==='clientId'?'targetClientId':key==='requestId'?'consumedByRequest':key;
    if(response[field]!==value)throw fail('GROUP_EXECUTION_CONFLICT');
   }
  }else if(this.checkVerdict(response,binding,{clientUlid:context.clientId})!==true)throw fail('GROUP_AUTHORIZATION_REQUIRED');
  // Copy response so neither transport nor caller can alter a pending synchronous decision.
  record.verdict=JSON.parse(JSON.stringify(response));record.wire=JSON.stringify(wire);
  const permit=Object.freeze({});this.permits.set(permit,record);return permit;
 }
 cancelRequestedAt(permit){const r=this.permits.get(permit);if(!r)throw fail('GROUP_AUTHORIZATION_REQUIRED');return r.verdict.cancelRequestedAt;}
 check(permit,wire,context,phase){
  const r=this.permits.get(permit);if(!r||phase!==r.phase||r.wire!==JSON.stringify(wire))throw fail('GROUP_AUTHORIZATION_REQUIRED');
  this.same(r,context);this.policy(wire,context,phase);
  if(r.verdict.cancelRequestedAt!==null)throw fail('GROUP_STOP_REQUESTED');
  // Re-run time/binding checks at the synchronous effect fence. Never persist/cache boolean grants.
  if(this.checkVerdict(r.verdict,this.binding(wire,context),{clientUlid:context.clientId})!==true)throw fail('GROUP_AUTHORIZATION_REQUIRED');return true;
 }
}
module.exports={GroupGrantProvider};
