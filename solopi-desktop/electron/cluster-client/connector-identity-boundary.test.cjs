const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Connector}=require('./connector.cjs');
function real(t){const dir=fs.mkdtempSync(path.resolve('DG133-profile-'));let reject;const promise=new Promise((_,r)=>{reject=r});const c=new Connector({stateDir:dir,config:{serverUrl:'https://example.test',orgKey:'review',projectKey:'isolated',clientVersion:'review'},request:()=>promise});c.state.phase='approved';c.state.clientId='01M6JT00C77PRVBE0000C00010';const old={sessionId:'old-token',epoch:1};c.session=old;t.after(()=>{c.close();fs.rmSync(dir,{recursive:true,force:true});});return {c,old,reject};}
for(const code of ['AUTH_TOKEN_INVALID','SESSION_EPOCH_CONFLICT'])test('real identity: in-place epoch/token replacement is not old request session '+code,async t=>{
 const {c,old,reject}=real(t);const p=c.call('GET','/v1/events',undefined,old.sessionId);const rejected=assert.rejects(p,{code});
 // Mutating the handle does not change its object identity; request still used old-token.
 old.epoch=2;old.sessionId='new-token';reject(Object.assign(Error(code),{code}));await rejected;
 assert.equal(c.session,old,'old response must not clear the updated session');assert.equal(c.session.epoch,2);
});
test('real identity: explicitly stale token must not clear current unrelated token',async t=>{
 const {c,old,reject}=real(t);old.epoch=2;old.sessionId='new-token';
 const p=c.call('GET','/v1/events',undefined,'old-token');const rejected=assert.rejects(p,{code:'AUTH_TOKEN_INVALID'});
 reject(Object.assign(Error('AUTH_TOKEN_INVALID'),{code:'AUTH_TOKEN_INVALID'}));await rejected;
 assert.equal(c.session,old,'a request with another token is not invalidity evidence for current token');
});
test('real identity fingerprint changes with actual Ed25519 public key and protects replacement',async t=>{
 const {c,reject}=real(t);const before=c.subject();assert.match(before,/^sha256:/);
 const p=c.call('GET','/v1/events',undefined,c.session.sessionId);const rejected=assert.rejects(p,{code:'AUTH_REVOKED'});
 const kp=crypto.generateKeyPairSync('ed25519');c.state.publicKeyPem=kp.publicKey.export({type:'spki',format:'pem'});c.state.privateKeyPem=kp.privateKey.export({type:'pkcs8',format:'pem'});
 assert.notEqual(c.subject(),before);const fresh={sessionId:'new-key-token',epoch:2};c.session=fresh;
 reject(Object.assign(Error('AUTH_REVOKED'),{code:'AUTH_REVOKED'}));await rejected;assert.equal(c.state.phase,'approved');assert.equal(c.session,fresh);
});
test('real identity same-key true revocation still converges after object replacement',async t=>{
 const {c,reject}=real(t);const p=c.call('GET','/v1/events',undefined,c.session.sessionId);const rejected=assert.rejects(p,{code:'AUTH_REVOKED'});c.session={sessionId:'new-same-key-token',epoch:2};reject(Object.assign(Error('AUTH_REVOKED'),{code:'AUTH_REVOKED'}));await rejected;assert.equal(c.session,null);assert.equal(c.state.phase,'revoked');
});
