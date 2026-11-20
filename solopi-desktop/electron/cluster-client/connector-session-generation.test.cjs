const test=require('node:test'),assert=require('node:assert/strict');
const {Connector}=require('./connector.cjs');
function create(request){const old={sessionId:'old-token',epoch:1};const c=Object.create(Connector.prototype);Object.assign(c,{session:old,state:{phase:'approved'},identity:{save(){}},request});return {c,old};}
for(const code of ['ROUTE_INVALID','CONTRACT_MISMATCH','NETWORK_FAILED','NETWORK_TIMEOUT','TLS_FAILED','RESPONSE_INVALID','GROUP_NOT_FOUND','GROUP_OWNER_MISMATCH','GROUP_AUTHORIZATION_REQUIRED','UNAVAILABLE']){
 test('current local/business/network '+code+' preserves session',async()=>{const {c,old}=create(async()=>{throw Object.assign(Error(code),{code})});await assert.rejects(c.call('GET','/v1/events',undefined,old.sessionId),{code});assert.equal(c.session,old);assert.equal(c.state.phase,'approved');});
}
for(const code of ['AUTH_TOKEN_INVALID','SESSION_EPOCH_CONFLICT','AUTH_REVOKED','ENROLL_REJECTED','ENROLL_RECOVERY_KEY_MISMATCH']){
 test('current true invalid/identity terminal '+code+' converges',async()=>{const {c,old}=create(async()=>{throw Object.assign(Error(code),{code})});await assert.rejects(c.call('GET','/v1/events',undefined,old.sessionId),{code});assert.equal(c.session,null);if(code==='ENROLL_REJECTED')assert.equal(c.state.phase,'rejected');else if(['AUTH_REVOKED','ENROLL_RECOVERY_KEY_MISMATCH'].includes(code))assert.equal(c.state.phase,'revoked');});
}
for(const code of ['AUTH_TOKEN_INVALID','SESSION_EPOCH_CONFLICT']){
 test('late old-generation '+code+' must not erase new signed session',async()=>{
  let rejectOld;const deferred=new Promise((_,reject)=>{rejectOld=reject});const {c,old}=create(()=>deferred);
  const pending=c.call('GET','/v1/events',undefined,old.sessionId);const rejected=assert.rejects(pending,{code});
  // The legal connect response has installed epoch2 while epoch1's HTTP result is delayed.
  const fresh={sessionId:'new-token',epoch:2};c.session=fresh;
  rejectOld(Object.assign(Error(code),{code}));await rejected;
  assert.equal(c.session,fresh,'late failure for epoch1 may reject its own caller but must preserve epoch2');
 });
}
