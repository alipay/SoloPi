'use strict';
const os = require('node:os');
const { openIdentity, ULID } = require('./identity.cjs');
const { ConnectorError, endpoint, createTransport } = require('./transport.cjs');
const CAPABILITIES = Object.freeze({ commands: false, media: false });
const TERMINAL = new Set(['AUTH_REVOKED', 'ENROLL_REJECTED', 'ENROLL_RECOVERY_KEY_MISMATCH']);
// DG132（DG131旧代次反例续修，替代DG129的仅按码分类f94d1382）：
//  ①请求发起时绑定会话对象与发起主体。会话级失效（AUTH_TOKEN_INVALID/SESSION_EPOCH_CONFLICT）
//    仅在错误返回时当前会话对象仍是发起时对象才清理——迟到的旧代次失效只让旧caller收错，
//    不抹除其间已新装的新会话（DG131两条旧代次反例）。
//  ②身份终态按主体核同：TERMINAL仅在发起主体==当前主体时迁移相位/清会话。旧主体（如recover换钥后）
//    迟到的吊销/拒绝不给新主体定罪；同身份真实吊销仍完整收敛（不清）。
//  ③本地ROUTE_INVALID/CONTRACT、网络类（NETWORK_FAILED/TIMEOUT/TLS_FAILED/RESPONSE_*）、
//    业务4xx（GROUP_*等）与503 UNAVAILABLE既不清会话也不动相位（DG129同理）。
const SESSION_TERMINAL = new Set(['AUTH_TOKEN_INVALID', 'SESSION_EPOCH_CONFLICT']);
function ensure(ok) { if (!ok) throw new ConnectorError('CONTRACT_MISMATCH'); }
function challenge(value) { ensure(typeof value?.challenge === 'string' && value.challenge.length >= 16 && value.challenge.length <= 256 && Number.isInteger(value.expiresInSec) && value.expiresInSec > 0); return value.challenge; }
class Connector {
  constructor({ stateDir, config, ca, request, mediaEnabled = false, agentEnabled = false }) {
    const origin = endpoint(config.serverUrl, { allowInsecureHttp: config.allowInsecureHttp });
    if (![config.orgKey, config.projectKey, config.clientVersion].every(v => typeof v === 'string' && v.length > 0)) throw new ConnectorError('CONFIG_INVALID');
    this.config = config;
    this.capabilities = Object.freeze({ ...CAPABILITIES, media: mediaEnabled === true, ...(agentEnabled === true ? {agent:true} : {}) });
    this.identity = openIdentity(stateDir);
    this.state = this.identity.state;
    this.session = null;
    const binding = { origin, orgKey: config.orgKey, projectKey: config.projectKey };
    if (this.state.binding && JSON.stringify(this.state.binding) !== JSON.stringify(binding)) { this.identity.close(); throw new ConnectorError('IDENTITY_SCOPE_BOUND'); }
    this.state.binding = binding; this.identity.save();
    this.request = request || createTransport({ serverUrl: origin, ca, apiMode: config.apiMode, allowInsecureHttp: config.allowInsecureHttp });
  }
  // 发起主体指纹：真实身份=公开钥派生指纹；测试替身无指纹时退化为状态公开钥；均无则为null
  // （同null视为同主体——恢复树替身/未初始化身份维持原语义，不因主体核同而漏收敛）。
  subject() { return this.identity && typeof this.identity.fingerprint === 'function' ? this.identity.fingerprint() : (this.state && (this.state.publicKeyPem || this.state.clientId)) || null; }
  status() { return { hostname: os.hostname(), installationId: this.state.installationId, keyFingerprint: this.identity.fingerprint(), phase: this.state.phase, enrollmentId: this.state.enrollmentId || null, clientId: this.state.clientId || null, epoch: this.session?.epoch || null, capabilities: this.capabilities }; }
  async call(method, route, body, token, signal) {
    if (this.state.phase === 'revoked' || this.state.phase === 'rejected') throw new ConnectorError('IDENTITY_TERMINAL');
    // DG134（DG133三条真实身份反例最小续修，替换DG132 776ddf3a；DG129 f94d1382与DG131两反例语义保持）：
    // 发起时捕获**不可变代次快照**——会话对象的sessionId/epoch值快照（独立于对象原地变更）、
    // **实际发出的凭据**（token参数；仅内存比较，凡日志/错误消息/异常附件一律不携带凭据）、**发起主体**。
    const bound = {
      session: this.session,                                   // 对象引用（第一道）
      sessionId: this.session ? this.session.sessionId : null, // 同对象原地换token防护（DG133反例①②）
      epoch: this.session ? this.session.epoch : null,         // 同对象原地换epoch防护
      token: token === undefined ? null : token,               // 实际发出凭据（归属判定）
      subject: this.subject(),                                 // 身份主体（DG132语义保持）
    };
    try { return await this.request(method, route, body, token, signal); }
    catch (e) {
      // 会话级失效：清理前置**三重守卫**（DG136闭合DG135两类阻塞，替换DG134 5c2b2634）——
      // ①实际发出**非空Bearer**（transport不自动补发当前token；无Authorization的响应码不构成
      //   当前会话失效证据。DG134的 bound.token===null 通配已删除：替身省略token的场景一律不清理）；
      // ②发起时存在会话对象且当前仍==发起对象（**空会话无对象可清——本分支必须no-op并原样抛原错误**，
      //   不得以TypeError等任何新错误替换原错误）；
      // ③发起值快照未原地变更（sessionId/epoch逐字段核）且凭据归属==发起时sessionId。
      // 迟到旧代次/显式旧token/原地变更/对象替换各路均不满足守卫=不清理；满足全守卫才清。
      if (SESSION_TERMINAL.has(e.code)) {
        if (typeof bound.token === 'string' && bound.token !== ''
          && bound.session !== null
          && this.session === bound.session
          && this.session.sessionId === bound.sessionId
          && this.session.epoch === bound.epoch
          && bound.token === this.session.sessionId) this.session = null;
      }
      // 身份终态：主体核同才迁移；旧主体迟到终态不给新主体定罪，同身份真实吊销不放过。
      else if (TERMINAL.has(e.code) && this.subject() === bound.subject) {
        this.session = null; // 终态属主体而非单个会话：同主体迟到终态（含与新会话并存）仍全量收敛；主体已换则不动新主体。
        this.state.phase = e.code === 'ENROLL_REJECTED' ? 'rejected' : 'revoked';
        this.identity.save();
      }
      throw e; // 原caller一律原样收错（不吞不改）
    }
  }
  async enroll(signal) {
    const s = this.state;
    const r = await this.call('POST', '/v1/enrollments', { installationId: s.installationId, publicKeyPem: s.publicKeyPem, keyFingerprint: this.identity.fingerprint(), clientVersion: this.config.clientVersion, capabilities: this.capabilities, deviceScope: { deviceId: s.installationId, os: os.platform(), hostname: os.hostname() }, scopeRequested: { orgKey: this.config.orgKey, projectKey: this.config.projectKey } }, undefined, signal);
    ensure(ULID.test(r?.enrollmentId) && ['pending', 'approved'].includes(r.status));
    if(r.clientId!==undefined){ensure(r.status==='approved'&&ULID.test(r.clientId));if(r.clientId!==s.clientId)delete s.lastEpoch;}
    s.enrollmentId = r.enrollmentId; s.clientId = r.clientId||null; s.phase = r.status; this.identity.save(); return this.status();
  }
  async recover(signal, { terminalReceipt = false } = {}) {
    const s = this.state;
    // Explicit cancellation may reconcile a terminal identity with key proof, never enroll it.
    const send=terminalReceipt?this.request.bind(this):this.call.bind(this);
    const c = challenge(await send('POST', '/v1/enrollments/recover/challenge', { installationId: s.installationId }, undefined, signal));
    const r = await send('POST', '/v1/enrollments/recover', { installationId: s.installationId, challenge: c, signature: this.identity.sign('enrollment.recover', c), publicKeyPem: s.publicKeyPem }, undefined, signal);
    if(r?.status==='revoked'){
      ensure(ULID.test(r.enrollmentId)&&ULID.test(r.clientId)&&typeof r.revokedAt==='string'&&Number.isFinite(Date.parse(r.revokedAt))&&(!s.clientId||s.clientId===r.clientId));
      if(!terminalReceipt){s.phase='revoked';this.identity.save();throw new ConnectorError('AUTH_REVOKED');}
      return {phase:'revoked',clientId:r.clientId,revokedAt:r.revokedAt};
    }
    ensure(ULID.test(r?.enrollmentId) && ['pending', 'approved'].includes(r.status) && (r.status === 'approved' ? ULID.test(r.clientId) : r.clientId === null));
    if(terminalReceipt&&s.clientId&&r.clientId!==s.clientId)throw new ConnectorError('CANCEL_TARGET_CHANGED');
    s.enrollmentId = r.enrollmentId; s.clientId = r.clientId; s.phase = r.status; this.identity.save(); return this.status();
  }
  async connect(signal) {
    this.session = null;
    await this.recover(signal);
    if (this.state.phase !== 'approved') return this.status();
    const c = challenge(await this.call('GET', '/v1/sessions/challenge?clientId=' + this.state.clientId, undefined, undefined, signal));
    const r = await this.call('POST', '/v1/sessions', { clientId: this.state.clientId, installationId: this.state.installationId, clientVersion: this.config.clientVersion, capabilities: this.capabilities, challenge: c, signature: this.identity.sign('session.create', c) }, undefined, signal);
    ensure(typeof r?.sessionId === 'string' && r.sessionId.length >= 32 && Number.isSafeInteger(r.epoch) && r.epoch > (this.state.lastEpoch || 0) && r.contractVersion === '0.1.6' && Number.isInteger(r.heartbeatIntervalSec) && r.heartbeatIntervalSec >= 1 && r.heartbeatIntervalSec <= 300);
    this.state.lastEpoch = r.epoch; this.identity.save(); this.session = r;
    return this.status();
  }
  async heartbeat(signal) {
    const s = this.session; if (!s) throw new ConnectorError('SESSION_REQUIRED');
    const r = await this.call('POST', '/v1/heartbeat', { epoch: s.epoch, sessionId: s.sessionId, lastEventSeqAck: this.eventCursor(), occupancy: { localUiTasks: 0, cliTasks: 0, broker: 'not_installed', note: 'Connector-only stage A; task counters unavailable; no execution capacity advertised' }, status: 'degraded' }, s.sessionId, signal);
    ensure(r?.epoch === s.epoch && typeof r.leaseExpiresAt === 'string');
    s.leaseExpiresAt = r.leaseExpiresAt;
    return { ...this.status(), heartbeat: 'accepted', leaseExpiresAt: r.leaseExpiresAt, status: 'degraded', occupancyMeasured: false, deviceSnapshot:r.deviceSnapshot };
  }
  eventCursor() { const c=this.state.mediaCursor; return c?.clientId===this.state.clientId&&Number.isSafeInteger(c.seq)&&c.seq>=0?c.seq:0; }
  checkpointEvents(seq) { ensure(Number.isSafeInteger(seq)&&seq>=this.eventCursor());this.state.mediaCursor={clientId:this.state.clientId,seq};this.identity.save(); }
  async events(signal) {
    const s=this.session;if(!s)throw new ConnectorError('SESSION_REQUIRED');
    const stream='client:'+this.state.clientId;
    const r=await this.call('GET','/v1/events?'+new URLSearchParams({stream,sinceSeq:String(this.eventCursor()),limit:'100'}),undefined,s.sessionId,signal);
    ensure(Array.isArray(r?.events)&&r.events.length<=100&&Number.isSafeInteger(r.snapshotSeq)&&r.snapshotSeq>=1&&typeof r.hasMore==='boolean');
    let seq=this.eventCursor();for(const e of r.events){ensure(e.stream===stream&&Number.isSafeInteger(e.seq)&&e.seq>seq&&Number.isSafeInteger(e.epoch)&&typeof e.type==='string');seq=e.seq;}
    return r;
  }
  // Private group subscriber uses its own durable cursor; never mediaCursor/eventCursor().
  async groupEvents(sinceSeq,signal) {
    ensure(Number.isSafeInteger(sinceSeq)&&sinceSeq>=0);
    const s=this.session,clientId=this.state.clientId;if(!s)throw new ConnectorError('SESSION_REQUIRED');
    const stream='client:'+clientId;
    const page=await this.call('GET','/v1/events?'+new URLSearchParams({stream,sinceSeq:String(sinceSeq),limit:'100'}),undefined,s.sessionId,signal);
    ensure(this.session===s&&this.state.clientId===clientId);
    ensure(Array.isArray(page?.events)&&page.events.length<=100&&Number.isSafeInteger(page.snapshotSeq)&&page.snapshotSeq>=1&&typeof page.hasMore==='boolean');
    let seq=sinceSeq;for(const e of page.events){ensure(e.stream===stream&&Number.isSafeInteger(e.seq)&&e.seq>seq&&Number.isSafeInteger(e.epoch)&&e.epoch>=1&&typeof e.type==='string');seq=e.seq;}
    ensure(!page.hasMore||page.events.length>0);return page;
  }
  async unregister(signal) {
    if(!this.session){
      const reconciled=await this.recover(signal,{terminalReceipt:true});
      if(reconciled.phase==='revoked'){this.state.phase='new';this.identity.save();return this.status();}
      if(reconciled.phase!=='approved')throw new ConnectorError('CANCEL_PENDING');
      await this.connect(signal);
    }
    const s=this.session;if(!s)throw new ConnectorError('SESSION_REQUIRED');
    const clientId=this.state.clientId;
    const r=await this.call('POST','/v1/enrollments/revoke',{sessionId:s.sessionId,epoch:s.epoch},s.sessionId,signal);
    ensure(r?.clientId===clientId&&r.status==='revoked'&&typeof r.revokedAt==='string'&&Number.isFinite(Date.parse(r.revokedAt)));
    this.session=null;this.state.phase='new';this.identity.save();return this.status();
  }
  close() { this.session = null; this.identity.close(); }
}
module.exports = { Connector, CAPABILITIES };
