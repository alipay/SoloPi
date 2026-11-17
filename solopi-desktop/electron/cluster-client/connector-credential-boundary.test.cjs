const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {Connector}=require('./connector.cjs');
function local(t,request){const dir=fs.mkdtempSync(path.resolve('DG135-profile-'));const c=new Connector({stateDir:dir,config:{serverUrl:'https://example.test',orgKey:'review',projectKey:'isolated',clientVersion:'review'},request});t.after(()=>{c.close();fs.rmSync(dir,{recursive:true,force:true});});return c;}
for(const code of ['AUTH_TOKEN_INVALID','SESSION_EPOCH_CONFLICT'])test('no session: original '+code+' must survive catch without null dereference',async t=>{
 const c=local(t,async()=>{throw Object.assign(Error(code),{code})});assert.equal(c.session,null);
 await assert.rejects(c.call('GET','/v1/events',undefined,'explicit-stale-token'),{code});assert.equal(c.session,null);
});
test('no Authorization sent: error is not invalidity proof for current session',async t=>{
 let seenAuth;const server=http.createServer((req,res)=>{seenAuth=req.headers.authorization;res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'AUTH_TOKEN_INVALID'}}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const {createTransport}=require('./transport.cjs');const request=createTransport({serverUrl:'http://127.0.0.1:'+server.address().port,allowInsecureHttp:true,apiMode:'v1'});const c=local(t,request);const current={sessionId:'current-live-token',epoch:2};c.session=current;
 await assert.rejects(c.call('GET','/v1/events'),{code:'AUTH_TOKEN_INVALID'});assert.equal(seenAuth,undefined);assert.equal(c.session,current,'an unauthenticated request did not send current session token');
});
test('opt-in HTTPS no-session invalid Bearer: preserve actual core AUTH_TOKEN_INVALID',{skip:!process.env.SOLOPI_LAB_REVIEW_ORIGIN||!process.env.SOLOPI_LAB_REVIEW_CLIENT_ID},async t=>{
 const dir=fs.mkdtempSync(path.resolve('DG135-network-profile-'));const c=new Connector({stateDir:dir,config:{serverUrl:process.env.SOLOPI_LAB_REVIEW_ORIGIN,orgKey:'solopi-lab',projectKey:'glasses',clientVersion:'dg135-review',apiMode:'cp'}});t.after(()=>{c.close();fs.rmSync(dir,{recursive:true,force:true});});
 const route='/v1/events?'+new URLSearchParams({stream:'client:'+process.env.SOLOPI_LAB_REVIEW_CLIENT_ID,sinceSeq:'0',limit:'1'});
 // Control: actual transport preserves the deployed core's original code.
 await assert.rejects(c.request('GET',route,undefined,'dg135-not-an-issued-credential'),{code:'AUTH_TOKEN_INVALID'});
 await assert.rejects(c.call('GET',route,undefined,'dg135-not-an-issued-credential'),{code:'AUTH_TOKEN_INVALID'});
});
for(const changed of ['epoch','sessionId'])test('separate in-place change '+changed+' preserves newer session values',async t=>{
 let reject;const p=new Promise((_,r)=>{reject=r});const c=local(t,()=>p);const s={sessionId:'initial-token',epoch:1};c.session=s;
 const pending=c.call('GET','/v1/events',undefined,s.sessionId),rejected=assert.rejects(pending,{code:'AUTH_TOKEN_INVALID'});
 if(changed==='epoch')s.epoch=2;else s.sessionId='replacement-token';
 reject(Object.assign(Error('AUTH_TOKEN_INVALID'),{code:'AUTH_TOKEN_INVALID'}));await rejected;assert.equal(c.session,s);
});
