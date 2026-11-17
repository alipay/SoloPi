// DG132（DG131两只旧代次阻塞反例续修的补充检查，作者=Server侧）：
// 身份移植置换单元：旧主体迟到的TERMINAL不得迁移新主体相位；同身份真实吊销必须全量收敛。
// 目标行为（v2 776ddf3a…）：两检查全绿；父65db7ef5与DG129仅码分类f94d1382在“旧主体迟到终态”上应为红（父另在10条保会话项红）。
const test=require('node:test'),assert=require('node:assert/strict');
const {Connector}=require('./connector.cjs');
function createFingerprinted(fp, request){
  let current=fp;
  const old={sessionId:'old-token',epoch:1};
  const c=Object.create(Connector.prototype);
  Object.assign(c,{session:old,state:{phase:'approved'},identity:{save(){},fingerprint:()=>current},request});
  return {c,old,rotate:(next)=>{current=next;}};
}
test('identity-switch：旧主体迟到的AUTH_REVOKED不终止新主体（相位与新旧会话均保留），caller仍收错',async()=>{
  let rejectOld;const deferred=new Promise((_,rej)=>{rejectOld=rej});
  const {c,rotate}=createFingerprinted('fp-A',()=>deferred);
  const pending=c.call('GET','/v1/events');
  const rejected=assert.rejects(pending,{code:'AUTH_REVOKED'});
  // 旧请求悬挂期间：身份换钥（旧要求recover）→新主体、新会话
  rotate('fp-B');
  const fresh={sessionId:'new-token',epoch:2}; c.session=fresh;
  rejectOld(Object.assign(Error('AUTH_REVOKED'),{code:'AUTH_REVOKED'}));
  await rejected;
  assert.equal(c.state.phase,'approved','旧主体的迟到终态不得迁移新主体相位');
  assert.equal(c.session,fresh,'旧主体迟到终态不得抹除新主体会话');
});
test('same-identity真实吊销：主体未换时迟到AUTH_REVOKED仍全量收敛（新会话作废+相位迁移）',async()=>{
  let rejectOld;const deferred=new Promise((_,rej)=>{rejectOld=rej});
  const {c}=createFingerprinted('fp-A',()=>deferred);
  const pending=c.call('GET','/v1/events');
  const rejected=assert.rejects(pending,{code:'AUTH_REVOKED'});
  const fresh={sessionId:'new-token',epoch:2}; c.session=fresh; // 同主体重连换会话不换身份
  rejectOld(Object.assign(Error('AUTH_REVOKED'),{code:'AUTH_REVOKED'}));
  await rejected;
  assert.equal(c.state.phase,'revoked','同身份真实吊销必须迁移相位');
  assert.equal(c.session,null,'同身份吊销作废其所有会话（含迟到时刻的新会话）');
});
for(const code of ['ENROLL_REJECTED','ENROLL_RECOVERY_KEY_MISMATCH']){
  test('身份终态按主体核同同样约束 '+code+'：旧主体迟到不定罪、同身份收敛',async()=>{
    let rejectOld;const deferred=new Promise((_,rej)=>{rejectOld=rej});
    const {c,rotate}=createFingerprinted('fp-A',()=>deferred);
    const pending=c.call('GET','/v1/events');
    const rejected=assert.rejects(pending,{code});
    rotate('fp-B'); const fresh={sessionId:'new-token',epoch:2}; c.session=fresh;
    rejectOld(Object.assign(Error(code),{code}));
    await rejected;
    assert.equal(c.state.phase,'approved','旧主体迟到'+code+'不迁移新主体');
    assert.equal(c.session,fresh,'新主体会话保留');
  });
}
test('会话级失效的对象绑定在有指纹替身下同样成立：迟到AUTH_TOKEN_INVALID只废旧caller不废新会话',async()=>{
  let rejectOld;const deferred=new Promise((_,rej)=>{rejectOld=rej});
  const {c}=createFingerprinted('fp-A',()=>deferred);
  const pending=c.call('GET','/v1/events');
  const rejected=assert.rejects(pending,{code:'AUTH_TOKEN_INVALID'});
  const fresh={sessionId:'new-token',epoch:2}; c.session=fresh;
  rejectOld(Object.assign(Error('AUTH_TOKEN_INVALID'),{code:'AUTH_TOKEN_INVALID'}));
  await rejected;
  assert.equal(c.session,fresh,'迟到会话失效不得抹除新会话（含指纹替身路径）');
  // 同代次（发起后未换会话）失效仍然立即清理：
  // [DG136单字段变更·逐项注明] 本正例原本省略凭据（无token调用）；按DG135裁定删除null通配后，
  // 仅补真实凭据前置=显式传入该会话token；拒绝断言与其他正例未改。
  const c2=createFingerprinted('fp-A',async()=>{throw Object.assign(Error('AUTH_TOKEN_INVALID'),{code:'AUTH_TOKEN_INVALID'})});
  await assert.rejects(c2.c.call('GET','/v1/events',undefined,'old-token'),{code:'AUTH_TOKEN_INVALID'});
  assert.equal(c2.c.session,null,'发起时对象仍是当前对象且凭据归属时失效即清理');
});
