// DG136组合系统矩阵（按DG135裁定要求）：对会话级两类失效码×七种组合逐项断
// (a)清理/不清理符合三重守卫语义；(b)**原错误对象恒等**——caller收到的异常对象===发起方抛出的原对象
// （TypeError等任何新错误都不允许替代）；空token('')按"实际发出非空Bearer"守卫同无token。
// 隔离单测层；DG135包已含真实transport请求头(credential-null#3)与真实用户HTTPS空会话诊断(#4)。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Connector}=require('./connector.cjs');
function mk(t){const dir=fs.mkdtempSync(path.resolve('DG136-profile-'));const c=new Connector({stateDir:dir,config:{serverUrl:'https://example.test',orgKey:'review',projectKey:'isolated',clientVersion:'review'},request:async()=>{}});c.state.phase='approved';t.after(()=>{c.close();fs.rmSync(dir,{recursive:true,force:true});});return c;}
for(const code of ['AUTH_TOKEN_INVALID','SESSION_EPOCH_CONFLICT']){
  test(code+' 组合①基线正控：同对象+正确凭据+未变更→清理且原错误恒等',async t=>{
    const c=mk(t);const s={sessionId:'live-token',epoch:2};c.session=s;
    const original=Object.assign(Error(code),{code});let reject;const p=new Promise((_,r)=>{reject=r});c.request=()=>p;
    const pending=c.call('GET','/v1/events',undefined,'live-token');
    reject(original);let received;try{await pending}catch(e){received=e}
    assert.equal(received,original,'原错误恒等');assert.equal(c.session,null,'守卫全过=清理');
  });
  test(code+' 组合②无session：no-op不崩、原错误恒等、phase不动',async t=>{
    const c=mk(t);const original=Object.assign(Error(code),{code});let reject;const p=new Promise((_,r)=>{reject=r});c.request=()=>p;
    const pending=c.call('GET','/v1/events',undefined,'explicit-stale');reject(original);
    let received;try{await pending}catch(e){received=e}
    assert.equal(received,original,'原错误恒等（不得以TypeError替换）');
    assert.equal(c.session,null);assert.equal(c.state.phase,'approved');
  });
  test(code+' 组合③无token（在位会话但未发凭据）：不清且原错误恒等',async t=>{
    const c=mk(t);const s={sessionId:'live-token',epoch:2};c.session=s;
    const original=Object.assign(Error(code),{code});let reject;const p=new Promise((_,r)=>{reject=r});c.request=()=>p;
    const pending=c.call('GET','/v1/events');reject(original);
    let received;try{await pending}catch(e){received=e}
    assert.equal(received,original);assert.equal(c.session,s,'无Authorization不构成失效证据');
  });
  test(code+' 组合③b空串token：与非空Bearer守卫一致不清',async t=>{
    const c=mk(t);const s={sessionId:'live-token',epoch:2};c.session=s;
    const original=Object.assign(Error(code),{code});let reject;const p=new Promise((_,r)=>{reject=r});c.request=()=>p;
    const pending=c.call('GET','/v1/events',undefined,'');reject(original);
    let received;try{await pending}catch(e){received=e}
    assert.equal(received,original);assert.equal(c.session,s);
  });
  test(code+' 组合④显式旧token：不清且原错误恒等',async t=>{
    const c=mk(t);const s={sessionId:'new-token',epoch:2};c.session=s;
    const original=Object.assign(Error(code),{code});let reject;const p=new Promise((_,r)=>{reject=r});c.request=()=>p;
    const pending=c.call('GET','/v1/events',undefined,'old-token');reject(original);
    let received;try{await pending}catch(e){received=e}
    assert.equal(received,original);assert.equal(c.session,s);
  });
  test(code+' 组合⑤原地改sessionId：不清且原错误恒等',async t=>{
    const c=mk(t);const s={sessionId:'old-token',epoch:1};c.session=s;
    const original=Object.assign(Error(code),{code});let reject;const p=new Promise((_,r)=>{reject=r});c.request=()=>p;
    const pending=c.call('GET','/v1/events',undefined,'old-token');
    s.sessionId='new-token';reject(original);
    let received;try{await pending}catch(e){received=e}
    assert.equal(received,original);assert.equal(c.session,s);assert.equal(s.sessionId,'new-token');
  });
  test(code+' 组合⑥原地改epoch：不清且原错误恒等',async t=>{
    const c=mk(t);const s={sessionId:'old-token',epoch:1};c.session=s;
    const original=Object.assign(Error(code),{code});let reject;const p=new Promise((_,r)=>{reject=r});c.request=()=>p;
    const pending=c.call('GET','/v1/events',undefined,'old-token');
    s.epoch=2;reject(original);
    let received;try{await pending}catch(e){received=e}
    assert.equal(received,original);assert.equal(c.session,s);assert.equal(s.epoch,2);
  });
  test(code+' 组合⑦对象替换：不清且原错误恒等',async t=>{
    const c=mk(t);const s={sessionId:'old-token',epoch:1};c.session=s;
    const original=Object.assign(Error(code),{code});let reject;const p=new Promise((_,r)=>{reject=r});c.request=()=>p;
    const pending=c.call('GET','/v1/events',undefined,'old-token');
    const fresh={sessionId:'new-token',epoch:2};c.session=fresh;reject(original);
    let received;try{await pending}catch(e){received=e}
    assert.equal(received,original);assert.equal(c.session,fresh);
  });
}
for(const code of ['AUTH_REVOKED','ENROLL_REJECTED','ENROLL_RECOVERY_KEY_MISMATCH']){
  test('身份终态组合：换主体迟到不迁移且原错误恒等 '+code,async t=>{
    const c=mk(t);const s={sessionId:'old-token',epoch:1};c.session=s;
    const before=c.subject();
    const kp=require('node:crypto').generateKeyPairSync('ed25519');
    const original=Object.assign(Error(code),{code});let reject;const p=new Promise((_,r)=>{reject=r});c.request=()=>p;
    const pending=c.call('GET','/v1/events',undefined,'old-token');
    c.state.publicKeyPem=kp.publicKey.export({type:'spki',format:'pem'});
    const fresh={sessionId:'new-token',epoch:2};c.session=fresh;
    assert.notEqual(c.subject(),before);reject(original);
    let received;try{await pending}catch(e){received=e}
    assert.equal(received,original);assert.equal(c.state.phase,'approved');assert.equal(c.session,fresh);
  });
  test('身份终态组合：同主体真吊销收敛且原错误恒等 '+code,async t=>{
    const c=mk(t);const s={sessionId:'old-token',epoch:1};c.session=s;
    const original=Object.assign(Error(code),{code});let reject;const p=new Promise((_,r)=>{reject=r});c.request=()=>p;
    const pending=c.call('GET','/v1/events',undefined,'old-token');
    const fresh={sessionId:'new-token',epoch:2};c.session=fresh;reject(original);
    let received;try{await pending}catch(e){received=e}
    assert.equal(received,original);assert.equal(c.session,null);
    assert.equal(c.state.phase, code==='ENROLL_REJECTED'?'rejected':'revoked');
  });
}
