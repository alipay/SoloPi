'use strict';
// Main-only precondition adapter. No renderer/API entry, task execution, state writer or credential copy.
const {createHash}=require('node:crypto');
const {digest,libraryOf}=require('../case-edit-guard');
const {assertImportReviewed}=require('../solopi-case-converter');
const {bindingFromConsumerEnvelope}=require('./group-grant-contract.cjs');
const fail=code=>Object.assign(new Error(code),{code});
const plain=v=>v&&Object.getPrototypeOf(v)===Object.prototype;
function canonical(v){
 const seen=new Set();function visit(x){
  if(x===null||typeof x==='string'||typeof x==='boolean')return x;
  if(typeof x==='number'&&Number.isFinite(x))return x;
  if(!x||(!Array.isArray(x)&&!plain(x))||seen.has(x))throw fail('GROUP_INVALID');
  seen.add(x);const out=Array.isArray(x)?x.map(visit):Object.fromEntries(Object.keys(x).filter(k=>x[k]!==undefined).sort().map(k=>[k,visit(x[k])]));seen.delete(x);return out;
 }return JSON.stringify(visit(v));
}
const sha=v=>createHash('sha256').update(canonical(v)).digest('hex');
const copy=v=>JSON.parse(canonical(v));
function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
class TrustedGroupPlan {
 constructor({readState,resolveContext=()=>null,approve=()=>null,captureAssets=()=>null,now=Date.now}){
  if([readState,resolveContext,approve,captureAssets,now].some(f=>typeof f!=='function'))throw fail('GROUP_INVALID');
  Object.assign(this,{readState,resolveContext,approve,captureAssets,now});this.plans=new WeakMap();this.approvals=new WeakMap();
 }
 capture(wire){
  const state=this.readState();if(!plain(state)||!Array.isArray(state.cases)||!plain(wire?.payload)||Object.keys(wire.payload).some(k=>k!=='cases')||!Array.isArray(wire.payload.cases)||!wire.payload.cases.length)throw fail('GROUP_INVALID');
  const selected=[],refs=[],ids=new Set();
  for(const requested of wire.payload.cases){
   if(!plain(requested)||Object.keys(requested).some(k=>!['id','steps'].includes(k))||typeof requested.id!=='string'||ids.has(requested.id))throw fail('GROUP_INVALID');ids.add(requested.id);
   const matches=state.cases.filter(c=>c.id===requested.id);if(matches.length!==1)throw fail('GROUP_AUTHORIZATION_REQUIRED');const c=matches[0];
   const libraryId=libraryOf(state,c),libraries=(state.caseLibraries||[]).filter(l=>l.id===libraryId);if(!libraryId||libraries.length!==1||typeof libraries[0].localRevision!=='string'||!/^[0-9a-f]{64}$/.test(libraries[0].localRevision))throw fail('GROUP_AUTHORIZATION_REQUIRED');
   assertImportReviewed(c);if(canonical(c.steps)!==canonical(requested.steps))throw fail('GROUP_EXECUTION_CONFLICT');
   selected.push(copy(c));refs.push({caseId:c.id,libraryId,libraryRevision:libraries[0].localRevision,contentSha256:digest(state,c),documentSha256:sha(c),importReviewState:'no-pending-nodes'});
  }
  // Configuration stays private in memory. Metadata/hash may be persisted; secrets/raw config may not.
  // Conservatively bind all components and relevant runner configuration rather than guess dependencies.
  const configuration=copy({components:state.components||[],caseEdges:state.caseEdges||{},llmProviders:state.llmProviders||[],selectedLlmProviderId:state.selectedLlmProviderId||'',ttsProvider:state.ttsProvider||null});
  const assets=this.captureAssets(state,selected);
  const snapshot=freeze({cases:selected,caseRefs:refs,configuration,configurationSha256:sha(configuration),assets:assets===null?null:copy(assets)});
  const outer=Object.fromEntries(['clientId','dispatchId','requestId','groupId','expectedRevision','memberSha256','payloadSha256','payloadBytes','dispatchPlanSha256'].map(k=>[k,wire[k]]));
  // Self-derived outer is only structural/hash validation here, never an authorization source.
  const binding=freeze({...bindingFromConsumerEnvelope(wire,outer,{clientUlid:wire.clientId}),dispatchId:wire.dispatchId});
  const snapshotSha256=sha(snapshot),handle=Object.freeze({});this.plans.set(handle,{snapshot,binding,snapshotSha256,wire:copy(wire)});return handle;
 }
 inspect(handle){const p=this.plans.get(handle);if(!p)throw fail('GROUP_AUTHORIZATION_REQUIRED');return p.snapshot;}
 metadata(handle){const p=this.plans.get(handle);if(!p)throw fail('GROUP_AUTHORIZATION_REQUIRED');return freeze(copy({binding:p.binding,snapshotSha256:p.snapshotSha256,caseRefs:p.snapshot.caseRefs,configurationSha256:p.snapshot.configurationSha256,assets:p.snapshot.assets}));}
 context(context){const c=this.resolveContext(context);if(!plain(c)||!plain(context)||c.clientId!==context.clientId||c.epoch!==context.epoch||!Number.isSafeInteger(c.epoch)||c.epoch<1||typeof c.principalId!=='string'||!c.principalId||!plain(c.scope)||!((typeof c.scope.orgId==='string'&&c.scope.orgId&&typeof c.scope.projectId==='string'&&c.scope.projectId)||(c.scope.kind==='configured-local'&&typeof c.scope.origin==='string'&&c.scope.origin&&typeof c.scope.orgKey==='string'&&c.scope.orgKey&&typeof c.scope.projectKey==='string'&&c.scope.projectKey))||!plain(c.platformContext)||!Number.isSafeInteger(c.generation)||c.generation<1)throw fail('GROUP_AUTHORIZATION_REQUIRED');return c;}
 time(){const value=this.now();if(!Number.isSafeInteger(value)||value<0)throw fail('GROUP_AUTHORIZATION_REQUIRED');return value;}
 stamp(c){return sha({clientId:c.clientId,epoch:c.epoch,principalId:c.principalId,scope:c.scope,generation:c.generation});}
 async requestApproval(handle,context){
  const p=this.plans.get(handle);if(!p||p.snapshot.assets===null||p.binding.clientId!==context?.clientId)throw fail('GROUP_AUTHORIZATION_REQUIRED');const nativeContext=this.context(context),stamp=this.stamp(nativeContext),platformContext=nativeContext.platformContext;
  const decision=await this.approve(this.metadata(handle),nativeContext);const now=this.time();
  if(this.context(context)!==nativeContext||this.stamp(nativeContext)!==stamp||nativeContext.platformContext!==platformContext||!plain(decision)||decision.allowed!==true||decision.nativeContext!==nativeContext||decision.snapshotSha256!==p.snapshotSha256||canonical(decision.binding)!==canonical(p.binding)||!Number.isSafeInteger(decision.issuedAtMs)||!Number.isSafeInteger(decision.expiresAtMs)||decision.issuedAtMs>now||now>=decision.expiresAtMs||decision.issuedAtMs>=decision.expiresAtMs)throw fail('GROUP_AUTHORIZATION_REQUIRED');
  const receipt=Object.freeze({});this.approvals.set(receipt,{handle,nativeContext,stamp,platformContext,issuedAtMs:decision.issuedAtMs,expiresAtMs:decision.expiresAtMs});return receipt;
 }
 check(handle,receipt,wire,context){
  const p=this.plans.get(handle),a=this.approvals.get(receipt),now=this.time();if(!p||!a||a.handle!==handle||a.nativeContext!==this.context(context)||this.stamp(a.nativeContext)!==a.stamp||a.nativeContext.platformContext!==a.platformContext||now<a.issuedAtMs||now>=a.expiresAtMs||canonical(wire)!==canonical(p.wire))throw fail('GROUP_AUTHORIZATION_REQUIRED');
  // Re-read current official state before any effect. Drift rejects; old snapshot remains immutable.
  const fresh=this.capture(wire);if(this.metadata(fresh).snapshotSha256!==p.snapshotSha256)throw fail('GROUP_EXECUTION_CONFLICT');return true;
 }
 nativeInput(handle,receipt,wire,context){this.check(handle,receipt,wire,context);const p=this.plans.get(handle);return p.snapshot;}
}
module.exports={TrustedGroupPlan};
