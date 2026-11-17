'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { Connector } = require('./connector.cjs');
const { endpoint } = require('./transport.cjs');
const { openIdentity } = require('./identity.cjs');
const cfg = { serverUrl: 'https://lab.example', orgKey: 'o', projectKey: 'p', clientVersion: '0.1.143' };
const eid = '01ARZ3NDEKTSV4RRFFQ69G5FAV', cid = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
test('old cancellation cannot adopt or revoke a later active client',async t=>{
 const d=dir(t),p=peer();let replaced=false;const c=new Connector({stateDir:d,config:cfg,request:async(...a)=>{
  if(replaced&&a[1]==='/v1/enrollments/recover')return {enrollmentId:eid,clientId:eid,status:'approved'};
  if(replaced&&a[1]==='/v1/enrollments/revoke')assert.fail('must not revoke new client');
  return p.request(...a);
 }});await c.enroll();await c.connect();const before=c.status();c.session=null;replaced=true;await assert.rejects(c.unregister(),{code:'CANCEL_TARGET_CHANGED'});assert.equal(c.status().clientId,before.clientId);assert.equal(c.status().installationId,before.installationId);c.close();
});
test('key-held cancel receipt after restart preserves key/id, rejects mismatched client and never enrolls pending',async t=>{
 const d=dir(t),p=peer();let terminal=false,mismatch=false;const request=async(...a)=>{if(terminal&&a[1]==='/v1/enrollments/recover')return {enrollmentId:eid,clientId:mismatch?eid:cid,status:'revoked',revokedAt:new Date().toISOString()};return p.request(...a);};
 let c=new Connector({stateDir:d,config:cfg,request});await c.enroll();await c.connect();const before=c.status();c.close();terminal=true;
 c=new Connector({stateDir:d,config:cfg,request});mismatch=true;await assert.rejects(c.unregister(),{code:'CONTRACT_MISMATCH'});assert.equal(c.status().phase,'approved');mismatch=false;await assert.rejects(c.connect(),{code:'AUTH_REVOKED'});await c.unregister();assert.equal(c.status().phase,'new');assert.equal(c.status().installationId,before.installationId);assert.equal(c.status().keyFingerprint,before.keyFingerprint);assert.equal(p.wire.filter(w=>w.route==='/v1/enrollments').length,1);c.close();
 const pending=new Connector({stateDir:dir(t),config:cfg,request:async(method,route)=>route.includes('challenge')?{challenge:'a-long-valid-test-challenge',expiresInSec:60}:{enrollmentId:eid,clientId:null,status:'pending'}});await assert.rejects(pending.unregister(),{code:'CANCEL_PENDING'});assert.equal(pending.session,null);pending.close();
});
test('self cancellation sends only current session echoes; confirms response before changing identity; lost response retains identity',async t=>{
 const d=dir(t),p=peer();let lost=true;
 const c=new Connector({stateDir:d,config:cfg,request:async(method,route,b,token,signal)=>{
  if(route!=='/v1/enrollments/revoke')return p.request(method,route,b,token,signal);
  assert.deepEqual(Object.keys(b).sort(),['epoch','sessionId']);assert.equal(token,b.sessionId);
  if(lost)throw Object.assign(Error(),{code:'NETWORK_TIMEOUT'});
  return {clientId:cid,status:'revoked',revokedAt:new Date().toISOString()};
 }});await c.enroll();await c.connect();const before=c.status(),sessionBefore=c.session;
 await assert.rejects(c.unregister(),{code:'NETWORK_TIMEOUT'});assert.equal(c.status().installationId,before.installationId);assert.equal(c.status().phase,'approved');assert.equal(c.session,sessionBefore);
 lost=false;await c.unregister();assert.equal(c.status().phase,'new');assert.equal(c.status().installationId,before.installationId);assert.equal(c.status().keyFingerprint,before.keyFingerprint);assert.equal(c.session,null);c.close();
});
function dir(t) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'solopi-connector-test-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; }
function peer() {
  let enrollment, epoch = 0, revoked = false, token, challengeNo = 0; const challenges = new Set(), wire = [];
  const next = () => { const c = 'test-challenge-only-' + ++challengeNo; challenges.add(c); return { challenge: c, expiresInSec: 60 }; };
  async function request(method, route, b, auth) {
    wire.push({ method, route, b, auth });
    if (revoked) throw Object.assign(Error(), { code: 'AUTH_REVOKED' });
    if (route === '/v1/enrollments') { enrollment ??= b; assert.equal(b.installationId, enrollment.installationId); return { enrollmentId: eid, status: epoch ? 'approved' : 'pending' }; }
    if (route.includes('challenge')) return next();
    if (route === '/v1/enrollments/recover' || route === '/v1/sessions') {
      assert(challenges.delete(b.challenge));
      const purpose = route.includes('recover') ? 'enrollment.recover' : 'session.create';
      assert(crypto.verify(null, Buffer.from(purpose + '|' + b.challenge), enrollment.publicKeyPem, Buffer.from(b.signature, 'base64')));
      if (purpose === 'enrollment.recover') return { enrollmentId: eid, clientId: cid, status: 'approved' };
      token = crypto.randomBytes(32).toString('base64url'); return { sessionId: token, epoch: ++epoch, heartbeatIntervalSec: 1, leaseExpiresAt: new Date(Date.now() + 60000).toISOString(), contractVersion: '0.1.6' };
    }
    if (route === '/v1/heartbeat') { assert.equal(auth, token); assert.equal(b.sessionId, token); assert.equal(b.epoch, epoch); assert.equal(b.occupancy.broker, 'not_installed'); assert.equal(b.status, 'degraded'); return { epoch, leaseExpiresAt: new Date(Date.now() + 60000).toISOString() }; }
    throw Error('unexpected');
  }
  return { request, wire, revoke: () => { revoked = true; } };
}
test('TLS origin only; reject HTTP, credentials, query, fragments and base paths', () => {
  for (const url of ['http://localhost', 'https://u:p@lab.example', 'https://lab.example/?token=x', 'https://lab.example/#x', 'https://lab.example/path']) assert.throws(() => endpoint(url));
  assert.equal(endpoint('https://lab.example/'), 'https://lab.example');
});
test('identity stable across restart; private modes; lock excludes another owner', t => {
  const d = dir(t), a = openIdentity(d), id = a.state.installationId, fp = a.fingerprint();
  assert.throws(() => openIdentity(d), { code: 'CONFIGURATION_IN_USE' }); a.close();
  const b = openIdentity(d); assert.equal(b.state.installationId, id); assert.equal(b.fingerprint(), fp); b.close();
  if (process.platform !== 'win32') { assert.equal(fs.statSync(d).mode & 0o777, 0o700); assert.equal(fs.statSync(path.join(d, 'identity.json')).mode & 0o777, 0o600); }
});
test('reject corrupt or replaced/symlink identity rather than rotate installation', t => {
  const d = dir(t); fs.writeFileSync(path.join(d, 'identity.json'), '{}', { mode: 0o600 }); assert.throws(() => openIdentity(d), { code: 'STATE_INVALID' });
  fs.unlinkSync(path.join(d, 'identity.json')); fs.writeFileSync(path.join(d, 'target.json'), '{}', { mode: 0o600 }); fs.symlinkSync(path.join(d, 'target.json'), path.join(d, 'identity.json')); assert.throws(() => openIdentity(d), { code: 'STATE_PERMISSIONS' });
});
test('lost enrollment response preserves key/id for explicit idempotent replay', async t => {
  const d = dir(t), p = peer(); let first = true;
  const c = new Connector({ stateDir: d, config: cfg, request: async (...a) => { const r = await p.request(...a); if (first) { first = false; throw Object.assign(Error(), { code: 'NETWORK_TIMEOUT' }); } return r; } });
  await assert.rejects(c.enroll(), { code: 'NETWORK_TIMEOUT' }); const before = c.status(); c.close();
  const b = new Connector({ stateDir: d, config: cfg, request: p.request }); await b.enroll(); assert.equal(b.status().installationId, before.installationId); assert.equal(p.wire[0].b.publicKeyPem, p.wire[1].b.publicKeyPem); b.close();
});
test('approved proof, heartbeat, restart new epoch; token never persists or appears in public status', async t => {
  const d = dir(t), p = peer(); let c = new Connector({ stateDir: d, config: cfg, request: p.request }); await c.enroll(); await c.connect(); await c.heartbeat();
  const token = c.session.sessionId, original = c.status(); assert.equal(original.hostname,os.hostname()); assert.equal(original.keyFingerprint,c.identity.fingerprint()); assert(!JSON.stringify(c.status()).includes(token)); assert(!fs.readFileSync(path.join(d, 'identity.json'), 'utf8').includes(token)); c.close();
  c = new Connector({ stateDir: d, config: cfg, request: p.request }); assert.equal(c.session, null); await c.connect(); assert.equal(c.session.epoch, 2); assert.equal(c.status().installationId, original.installationId); await c.heartbeat();
  assert(!JSON.stringify(p.wire).includes(c.state.privateKeyPem)); c.close();
});
test('revocation stops heartbeat and survives restart; no implicit enrollment or session retry', async t => {
  const d = dir(t), p = peer(); let c = new Connector({ stateDir: d, config: cfg, request: p.request }); await c.enroll(); await c.connect(); p.revoke(); await assert.rejects(c.heartbeat(), { code: 'AUTH_REVOKED' }); const calls = p.wire.length; c.close();
  c = new Connector({ stateDir: d, config: cfg, request: p.request }); await assert.rejects(c.connect(), { code: 'IDENTITY_TERMINAL' }); await assert.rejects(c.enroll(), { code: 'IDENTITY_TERMINAL' }); assert.equal(p.wire.length, calls); c.close();
});
test('state cannot be silently reused for another server or scope', t => {
  const d = dir(t), c = new Connector({ stateDir: d, config: cfg, request: peer().request }); c.close();
  assert.throws(() => new Connector({ stateDir: d, config: { ...cfg, projectKey: 'other' } }), { code: 'IDENTITY_SCOPE_BOUND' });
});

test('network failure preserves uncertain session, does not retry or change task/occupancy state', async t => {
  const d=dir(t), p=peer(); const c=new Connector({stateDir:d,config:cfg,request:p.request}); await c.enroll(); await c.connect(); const old=c.request,sessionBefore=c.session; let calls=0; c.request=async()=>{calls++;throw Object.assign(Error(),{code:'NETWORK_TIMEOUT'})}; await assert.rejects(c.heartbeat(),{code:'NETWORK_TIMEOUT'}); assert.equal(calls,1); assert.equal(c.session,sessionBefore); c.request=old; await c.heartbeat(); assert.equal(c.session,sessionBefore); await c.connect(); assert.equal(c.session.epoch,2); c.close();
});
test('replayed/superseded epoch cannot replace persistent high water', async t => {
  const d=dir(t),p=peer(); const c=new Connector({stateDir:d,config:cfg,request:p.request}); await c.enroll(); await c.connect(); const old=c.request;c.request=async(...a)=>{const r=await old(...a);if(a[1]==='/v1/sessions')r.epoch=1;return r}; await assert.rejects(c.connect(),{code:'CONTRACT_MISMATCH'}); assert.equal(c.state.lastEpoch,1); c.close();
});
test('media cursor survives restart, uses actual stream and heartbeat ack; new client cannot inherit it',async t=>{
 const d=dir(t),p=peer();let c=new Connector({stateDir:d,config:cfg,request:p.request,mediaEnabled:true});await c.enroll();await c.connect();c.checkpointEvents(4);await c.heartbeat();assert.equal(p.wire.at(-1).b.lastEventSeqAck,4);c.close();c=new Connector({stateDir:d,config:cfg,request:p.request});assert.equal(c.eventCursor(),4);c.state.clientId=eid;assert.equal(c.eventCursor(),0);c.state.clientId=cid;await c.connect();c.request=async(method,route)=>{assert.match(route,/stream=client%3A/);assert.match(route,new RegExp('sinceSeq='+c.eventCursor()));return {events:[{stream:'client:'+cid,seq:5,epoch:2,type:'media.authorized',data:{}}],snapshotSeq:1,hasMore:false};};const page=await c.events();assert.equal(page.events[0].seq,5);assert.equal(c.eventCursor(),4);c.checkpointEvents(5);await assert.rejects(c.events(),{code:'CONTRACT_MISMATCH'});c.close();
});

test('agent capability follows installed executor on new signed session, preserves identity and commands false',async t=>{
 const d=dir(t),p=peer();let c=new Connector({stateDir:d,config:cfg,request:p.request});await c.enroll();await c.connect();const identity=c.status();assert.equal(p.wire.filter(x=>x.route==='/v1/sessions').at(-1).b.capabilities.agent,undefined);c.close();
 c=new Connector({stateDir:d,config:cfg,request:p.request,agentEnabled:true});await c.connect();const caps=p.wire.filter(x=>x.route==='/v1/sessions').at(-1).b.capabilities;assert.equal(caps.agent,true);assert.equal(caps.commands,false);assert.equal(c.status().installationId,identity.installationId);assert.equal(c.status().keyFingerprint,identity.keyFingerprint);assert.equal(p.wire.filter(x=>x.route==='/v1/enrollments').length,1);c.close();
});
