'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {DesktopConnection}=require('./desktop-service.cjs');
const config={serverUrl:'https://example.test',orgKey:'org',projectKey:'project',computerName:'local',caFile:''};
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-connection-'));let enrolled=0,approved=false,beats=0,closed=0,connects=0;const makeConnector=()=>({session:null,status(){return {phase:approved?'approved':'pending',installationId:'public-id'};},async enroll(){enrolled++;},async connect(){connects++;if(approved)this.session={heartbeatIntervalSec:300};return this.status();},async heartbeat(){beats++;return {};},close(){closed++;this.session=null;}});const s=new DesktopConnection({directory:dir,version:'test',makeConnector,transport:()=>async()=>({status:'ok',contractVersion:'0.1.6'})});t.after(async()=>{await s.close();fs.rmSync(dir,{recursive:true,force:true});});return {s,dir,approve:()=>approved=true,count:()=>({enrolled,beats,closed,connects}),makeConnector};}
test('save/test have no enrollment/identity side effect; only explicit register enrolls',async t=>{const f=fixture(t);assert.equal((await f.s.invoke('save',config)).success,true);assert.equal(fs.existsSync(path.join(f.dir,'identity')),false);assert.equal((await f.s.invoke('test',config)).tested,true);assert.equal(f.count().enrolled,0);assert.equal((await f.s.invoke('register')).phase,'pending');assert.equal(f.count().enrolled,1);assert.equal(f.count().beats,0);});
test('pending approval automatically transitions; same session heartbeat does not mint epoch each interval',async t=>{const f=fixture(t);await f.s.invoke('save',config);await f.s.invoke('register');f.approve();clearTimeout(f.s.timer);await f.s.tick();assert.equal(f.s.snapshot().phase,'connected');const n=f.count().connects;clearTimeout(f.s.timer);await f.s.tick();assert.equal(f.count().connects,n);assert.equal(f.count().beats,2);assert.ok(f.s.snapshot().lastUpdatedAt);});
test('persist enabled intent; restart recovery does not enroll; disable persists and closes',async t=>{const f=fixture(t);await f.s.invoke('save',config);await f.s.invoke('register');await f.s.close();const other=new DesktopConnection({directory:f.dir,version:'test',makeConnector:f.makeConnector});await other.start();assert.equal(f.count().enrolled,1);assert.equal(other.snapshot().phase,'pending');await other.invoke('disable');assert.equal(other.snapshot().phase,'disabled');assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'connection.json'))).enabled,false);await other.close();});
test('scope changes blocked after enrollment intent, including lost response; no secrets in IPC snapshot',async t=>{const f=fixture(t);await f.s.invoke('save',config);await f.s.invoke('register');assert.equal((await f.s.invoke('save',{...config,orgKey:'other'})).errorCode,'IDENTITY_SCOPE_BOUND');assert.equal((await f.s.invoke('save',{...config,serverUrl:'http://example.test'})).errorCode,'IDENTITY_SCOPE_BOUND');assert.doesNotMatch(JSON.stringify(f.s.snapshot()),/privateKey|sessionId|Bearer/);assert.equal(fs.statSync(path.join(f.dir,'connection.json')).mode&0o777,0o600);});
test('revocation disables recovery permanently; error categories never relay raw remote messages',async t=>{const f=fixture(t);await f.s.invoke('save',config);await f.s.invoke('register');clearTimeout(f.s.timer);f.s.connector.connect=async()=>{throw Object.assign(Error('secret'),{code:'AUTH_REVOKED'});};await f.s.tick();assert.equal(f.s.snapshot().phase,'revoked');assert.equal(f.s.snapshot().enabled,false);assert.doesNotMatch(JSON.stringify(f.s.snapshot()),/secret/);});
test('restricted settings reject symlink/mode and arbitrary credential config fields',async t=>{const f=fixture(t);assert.equal((await f.s.invoke('save',{...config,token:'do-not-accept'})).errorCode,'CONFIG_INVALID');await f.s.invoke('save',config);fs.chmodSync(path.join(f.dir,'connection.json'),0o644);assert.throws(()=>new DesktopConnection({directory:f.dir,version:'test'}),/STORAGE_PERMISSIONS/);});
test('disable aborts in-flight recover; late completion cannot heartbeat or re-enable',async t=>{const f=fixture(t);await f.s.invoke('save',config);await f.s.invoke('register');clearTimeout(f.s.timer);let finish,entered;const enteredP=new Promise(r=>entered=r);f.s.connector.connect=()=>{entered();return new Promise(r=>finish=r);};const tick=f.s.enqueue(()=>f.s.tick());await enteredP;const disabled=f.s.invoke('disable');finish({phase:'approved'});await tick;await disabled;assert.equal(f.count().beats,0);assert.equal(f.s.snapshot().enabled,false);assert.equal(f.s.snapshot().phase,'disabled');});

test('terminal reason survives restart without a network call',async t=>{const f=fixture(t);await f.s.invoke('save',config);f.s.fail({code:'AUTH_REVOKED'});await f.s.close();const s=new DesktopConnection({directory:f.dir,version:'test',makeConnector:()=>{throw Error('must not open');}});assert.equal((await s.start()).phase,'revoked');assert.equal((await s.invoke('register')).success,false);await s.close();});

test('expired session is not shown connected; stale interrupted save does not block next save',async t=>{const f=fixture(t);fs.writeFileSync(path.join(f.dir,'connection.json.tmp'),'interrupted',{mode:0o600});assert.equal((await f.s.invoke('save',config)).success,true);await f.s.invoke('register');clearTimeout(f.s.timer);f.s.connector.connect=async()=>{throw Object.assign(Error('private detail'),{code:'SESSION_EXPIRED'});};await f.s.tick();assert.equal(f.s.snapshot().phase,'expired');assert.equal(f.s.snapshot().errorCode,'SESSION_EXPIRED');assert.doesNotMatch(JSON.stringify(f.s.snapshot()),/private detail/);});

test('explicit HTTP settings clear stale CA, survive reload and test without enrolling',async t=>{
 const f=fixture(t),http={...config,serverUrl:'http://localhost:8780',caFile:'/missing/old-ca.crt'};
 assert.equal((await f.s.invoke('save',http)).success,true);
 assert.equal(f.s.snapshot().config.allowInsecureHttp,true);assert.equal(f.s.snapshot().config.caFile,'');
 assert.equal((await f.s.invoke('test',f.s.snapshot().config)).tested,true);assert.equal(f.count().enrolled,0);
 await f.s.close();const s=new DesktopConnection({directory:f.dir,version:'test'});assert.equal(s.snapshot().config.serverUrl,http.serverUrl);assert.equal(s.snapshot().enabled,false);await s.close();
});
test('HTTP origin remains part of enrolled identity binding; scheme changes cannot reuse it',async t=>{
 const f=fixture(t);await f.s.invoke('save',{...config,serverUrl:'http://localhost:8780'});await f.s.invoke('register');
 assert.equal((await f.s.invoke('save',{...config,serverUrl:'https://localhost:8780'})).errorCode,'IDENTITY_SCOPE_BOUND');
});

test('new HTTPS config defaults cp; old saved HTTPS remains v1; explicit modes are validated and immutable after enrollment',async t=>{
 const f=fixture(t);await f.s.invoke('save',config);assert.equal(f.s.snapshot().config.apiMode,'cp');
 await f.s.invoke('register');assert.equal((await f.s.invoke('save',{...config,apiMode:'v1'})).errorCode,'IDENTITY_SCOPE_BOUND');
 assert.equal((await f.s.invoke('test',{...config,apiMode:'auto'})).errorCode,'CONFIG_INVALID');
 await f.s.close();fs.writeFileSync(path.join(f.dir,'connection.json'),JSON.stringify({config,enabled:false,enrolled:false}),{mode:0o600});
 const old=new DesktopConnection({directory:f.dir,version:'test'});assert.equal(old.snapshot().config.apiMode,'v1');await old.close();
});

test('two-action flow: test is read-only; register validates/saves automatically; cancellation permits same-bound re-registration',async t=>{
 const f=fixture(t);let cancellations=0;f.s.makeConnector=()=>({...f.makeConnector(),async unregister(){cancellations++;}});f.approve();
 assert.equal((await f.s.invoke('test',config)).tested,true);assert.equal(fs.existsSync(path.join(f.dir,'connection.json')),false);assert.equal(f.count().enrolled,0);
 assert.equal((await f.s.invoke('register',config)).phase,'connected');assert.equal(f.s.snapshot().registered,true);assert.equal(f.count().enrolled,1);
 assert.equal(fs.statSync(path.join(f.dir,'connection.json')).mode&0o777,0o600);
 assert.equal((await f.s.invoke('unregister')).phase,'unregistered');assert.equal(cancellations,1);assert.equal(f.s.snapshot().registered,false);assert.equal(f.s.snapshot().enrolled,false);assert.equal(f.s.timer,null);assert.equal(f.s.snapshot().lastUpdatedAt,null);
 assert.equal((await f.s.invoke('register',{...config,projectKey:'other'})).errorCode,'IDENTITY_SCOPE_BOUND');
 assert.equal((await f.s.invoke('register',config)).phase,'connected');assert.equal(f.count().enrolled,2);
});
test('failed or lost cancellation is durable, stops heartbeat and never claims remote success or restarts recovery',async t=>{
 const f=fixture(t);f.approve();f.s.makeConnector=()=>({...f.makeConnector(),async unregister(){throw Object.assign(Error('private response'),{code:'NETWORK_TIMEOUT'});}});
 await f.s.invoke('register',config);const before=f.count().beats;
 assert.equal((await f.s.invoke('unregister')).errorCode,'NETWORK_TIMEOUT');assert.equal(f.s.snapshot().cancelPending,true);assert.equal(f.s.snapshot().registered,true);assert.equal(f.s.snapshot().enabled,false);assert.equal(f.s.timer,null);assert.doesNotMatch(JSON.stringify(f.s.snapshot()),/private response/);
 await f.s.close();const other=new DesktopConnection({directory:f.dir,version:'test',makeConnector:()=>{throw Error('must not auto retry after cancellation');}});assert.equal((await other.start()).phase,'cancel_failed');assert.equal((await other.invoke('register',config)).errorCode,'CANCEL_PENDING');assert.equal(f.count().beats,before);await other.close();
 const retry=new DesktopConnection({directory:f.dir,version:'test',makeConnector:()=>({...f.makeConnector(),async unregister(){}})});assert.equal((await retry.invoke('unregister')).phase,'unregistered');assert.equal(retry.snapshot().cancelPending,false);await retry.close();
});
test('cancel aborts in-flight recovery and late success cannot heartbeat before remote cancellation',async t=>{
 const f=fixture(t);f.approve();f.s.makeConnector=()=>({...f.makeConnector(),async unregister(){}});await f.s.invoke('register',config);clearTimeout(f.s.timer);f.s.connector.session=null;
 let finish,entered;const ready=new Promise(r=>entered=r);f.s.connector.connect=()=>{entered();return new Promise(r=>finish=r);};const before=f.count().beats;const running=f.s.enqueue(()=>f.s.tick());await ready;
 const cancelling=f.s.invoke('unregister');assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'connection.json'))).cancelPending,true);finish({phase:'approved'});await running;await cancelling;assert.equal(f.count().beats,before);assert.equal(f.s.snapshot().phase,'unregistered');assert.equal(f.s.timer,null);
});

test('test connection does not overwrite existing settings or create an identity',async t=>{
 const f=fixture(t);await f.s.invoke('save',config);const before=fs.readFileSync(path.join(f.dir,'connection.json'));
 assert.equal((await f.s.invoke('test',{...config,serverUrl:'https://another.example.test'})).tested,true);
 assert.deepEqual(fs.readFileSync(path.join(f.dir,'connection.json')),before);assert.equal(fs.existsSync(path.join(f.dir,'identity')),false);assert.equal(f.count().enrolled,0);
});

test('registration single flight spans delayed result, failure retry and pending recovery; cancellation also coalesces',async t=>{
 const f=fixture(t);let finish,attempts=0,cancels=0,endCancel;
 f.s.makeConnector=()=>({...f.makeConnector(),async enroll(){attempts++;return new Promise(r=>finish=r);},async unregister(){cancels++;await new Promise(r=>endCancel=r);}});
 const first=f.s.invoke('register',config),duplicate=f.s.invoke('register',config);assert.equal(first,duplicate);
 await new Promise(r=>setImmediate(r));assert.equal(attempts,1);assert.equal(f.s.snapshot().phase,'connecting');finish({phase:'pending'});assert.equal((await first).phase,'pending');
 assert.equal((await f.s.invoke('register',config)).phase,'pending');assert.equal(attempts,1);
 clearTimeout(f.s.timer);f.s.fail({code:'NETWORK_TIMEOUT'});const retry=f.s.invoke('register',config);await new Promise(r=>setImmediate(r));assert.equal(attempts,2);f.approve();finish({phase:'approved'});assert.equal((await retry).phase,'connected');
 const cancel=f.s.invoke('unregister'),again=f.s.invoke('unregister');assert.equal(cancel,again);await new Promise(r=>setImmediate(r));assert.equal(cancels,1);assert.equal(f.s.snapshot().phase,'unregistering');endCancel();assert.equal((await cancel).phase,'unregistered');
});

test('agent polling owns independent lifecycle and disable awaits executor release before replacement',async t=>{
 const f=fixture(t);let created=0,closed=0,finish,entered;const ready=new Promise(r=>entered=r);f.approve();f.s.agentExecutorFactory=()=>{created++;return {async execute(){throw Error('no task')},async recover(){},async stop(){},async close(){entered();await new Promise(r=>finish=r);closed++;}}};
 f.s.makeConnector=options=>{assert.equal(options.agentEnabled,true);return {...f.makeConnector(),state:{clientId:'01ARZ3NDEKTSV4RRFFQ69G5FAW'},async call(m,route){return route.includes('/events?')?{events:[],snapshotSeq:1,hasMore:false}:{items:[],nextSinceId:0,hasMore:false}}};};
 await f.s.invoke('register',config);assert.equal(created,1);await f.s.agentTasks.queue;const bridge=f.s.agentTasks;const closing=f.s.close();await ready;assert.equal(f.s.agentTasks,null);assert.equal(f.s.agentTimer,null);assert.equal(bridge.closed,true);let complete=false;closing.then(()=>complete=true);await new Promise(r=>setImmediate(r));assert.equal(complete,false);finish();await closing;assert.equal(closed,1);assert.equal(complete,true);
});
