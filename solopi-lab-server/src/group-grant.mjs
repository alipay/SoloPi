// SoloPi Lab Server — 组执行可信授权模块候选（DG111；主体scope→显式targetClientId的最小授权绑定与失效）。
// 上游依据（Board 6729841 S0复用决策 + 7124078 34#PJ，non-author侧如实分账）：DeepSeek dsh-superagent-prototype
// 6337fc823ce20251c8de8085948165c81aaa701e（MIT）docs/002-authorization=allowlist人裁决模式——按记录仅作模式参考
// 非代码复用；上游无org/project多租户、无设备enrollment/审批、无session/epoch、无命令幂等账、无资源租约，
// 故授权账本为最小自建。本机GitHub不可达（S0已记），签发正式授权前可再核原文。可借鉴原则："权限不由消息授予"
// ——授权只存在于服务端审批账本，客户端不信任任何调用方自报标签。
// 核心安全性质：
//   * 主体scope→显式targetClientId：审批主体必须是既有 admin_subject（复用现服审批身份/吊销/过期），
//     其 admin_scope 必须覆盖目标Client所在org或org/project（Select，复用既有审批能力，无新增主体面）；
//   * 授权绑定=全字段哈希绑定：targetClient+groupId+expectedRevision+memberSha256+payloadSha256+
//     payloadBytes+dispatchPlanSha256 任何一项不匹配即拒绝——"可信步骤语义"在本版=精确payload字节绑定
//     （stepProfile='bound-payload'），不授权任意steps；步骤类型白名单随端侧步骤合同另冻；
//   * 失效规则：TTL上限7天、显式吊销、单次消费（consumed_request_uid单绑定：同一授权重放到另一
//     requestId即拒绝；同一request重连重验幂等）；
//   * 默认拒绝：无授权/绑定不符/过期/吊销/重放→一律拒绝（GROUP_AUTHORIZATION_REQUIRED系）。
// 接线边界：本候选独立可测（ensure仅隔离库）；app.mjs路由与schema绑定待共享入口串行批次；grant视图字段
// 供Desktop authorize提供者校验（合同候选group-grant-draft §P）：客户端先比字段哈希再信结论——无自报信任。
// Code security: 全部SQL参数化；approver（T）由路由层注入，wire一切字段为U并核验后才进sink；grant不落token/明文。
import { ApiError } from "./util.mjs";
import { createHash, randomUUID } from "node:crypto";

const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const UUIDV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
const MAX_TTL_SEC = 7 * 24 * 3600;
const MAX_PAYLOAD_BYTES = 262144; // 与签发端/派发模块同口径（UTF-8 canonical字节上界）——DG118：两个helper亦强制该上界

function gerr(code, message) { return new ApiError(code, message); }
function allowKeys(obj, keys, where) {
  if (!obj || Object.getPrototypeOf(obj) !== Object.prototype) throw gerr("GROUP_INVALID", where + " must be a JSON object");
  for (const k of Object.keys(obj)) if (!keys.includes(k)) throw gerr("GROUP_INVALID", `field not allowed in ${where}: ${k}`);
}
function intRange(v, name, min, max) { if (!Number.isSafeInteger(v) || v < min || v > max) throw gerr("GROUP_INVALID", `${name} (${min}..${max}) required`); return v; }

// §G1 授权账本表结构。迁移候选DDL见 contracts/v0.4.1/group-grant-0013-candidate.sql（未入 server/migrations：
// 正式链由唯一合同负责人在接线/部署串行批次精确提交——避免与在途非作者接线审的版本断言互扰）。
export function ensureGroupGrantSchema(db) {
  db.exec([
    "CREATE TABLE IF NOT EXISTS group_execution_grant (",
    "  grant_uid TEXT PRIMARY KEY, approver_rowid INTEGER NOT NULL CHECK (typeof(approver_rowid)='integer'),",
    "  approver_label TEXT NOT NULL, target_client_ulid TEXT NOT NULL,",
    "  group_uid TEXT NOT NULL, expected_revision INTEGER NOT NULL CHECK (typeof(expected_revision)='integer' AND expected_revision>=1),",
    "  member_sha TEXT NOT NULL, payload_sha TEXT NOT NULL, payload_bytes INTEGER NOT NULL CHECK (typeof(payload_bytes)='integer' AND payload_bytes>=0),",
    "  plan_sha TEXT NOT NULL, step_profile TEXT NOT NULL CHECK (step_profile='bound-payload'),",
    "  grant_wire TEXT NOT NULL,",
    "  issued_at_ms INTEGER NOT NULL CHECK (typeof(issued_at_ms)='integer'),",
    "  expires_at_ms INTEGER NOT NULL CHECK (typeof(expires_at_ms)='integer'),",
    "  revoked_at_ms INTEGER, revoked_by_rowid INTEGER,",
    "  consumed_request_uid TEXT UNIQUE,",
    "  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms)='integer'),",
    "  updated_at_ms INTEGER NOT NULL CHECK (typeof(updated_at_ms)='integer'));",
    // 不可变绑定触发器：审批载体（target/组/revision/成员/资产/payload摘要/stepProfile）签发后不可改写；
    // 吊销/消费是唯一可变列——绑定字段全不可变；expires只可缩短不可延长（失效收紧方向），任何延长=拒绝。
    "CREATE TRIGGER IF NOT EXISTS group_execution_grant_immutable BEFORE UPDATE ON group_execution_grant",
    " WHEN NEW.grant_uid IS NOT OLD.grant_uid OR NEW.approver_rowid IS NOT OLD.approver_rowid",
    "  OR NEW.target_client_ulid IS NOT OLD.target_client_ulid OR NEW.group_uid IS NOT OLD.group_uid",
    "  OR NEW.expected_revision IS NOT OLD.expected_revision OR NEW.member_sha IS NOT OLD.member_sha",
    "  OR NEW.payload_sha IS NOT OLD.payload_sha OR NEW.payload_bytes IS NOT OLD.payload_bytes",
    "  OR NEW.plan_sha IS NOT OLD.plan_sha OR NEW.step_profile IS NOT OLD.step_profile",
    "  OR NEW.grant_wire IS NOT OLD.grant_wire OR NEW.expires_at_ms > OLD.expires_at_ms",
    " BEGIN SELECT RAISE(ABORT,'GROUP_GRANT_IMMUTABLE'); END;",
    "CREATE INDEX IF NOT EXISTS idx_geg_by_target ON group_execution_grant(target_client_ulid, group_uid);",
    "CREATE INDEX IF NOT EXISTS idx_geg_binding ON group_execution_grant(target_client_ulid, payload_sha, expires_at_ms);",
  ].join("\n"));
}

// §G2 审批主体核（复用既有admin_subject/admin_scope审批能力；Code security: T注入=路由层带入已验签的
// adminSubject（admincli既有语义）; 模块二次核行存在+未吊销/未过期，杜绝自报label）。
function approverScope(db, approver) {
  if (!approver || Object.getPrototypeOf(approver) !== Object.prototype || !Number.isSafeInteger(approver.rowid) || typeof approver.label !== "string")
    throw gerr("GROUP_INVALID", "trusted approver context required"); // T注入
  const subj = db.prepare("SELECT id, label, role, expires_at_ms, revoked_at_ms FROM admin_subject WHERE id=? AND label=?").get(approver.rowid, approver.label);
  // DG113红①：审批角色裁决=allowlist只认 role='admin'——operator等一切其他主体不可签发/吊销执行授权。
  if (!subj || subj.revoked_at_ms !== null || subj.expires_at_ms <= Date.now())
    throw gerr("GROUP_INVALID", "approver subject invalid or revoked or expired");
  if (subj.role !== "admin")
    throw gerr("GROUP_INVALID", "approver role not permitted to issue or revoke execution grants (admin only)");
  const scopes = db.prepare("SELECT org_rowid, project_rowid, revoked_at_ms FROM admin_scope WHERE admin_rowid=?").all(approver.rowid);
  return scopes.filter((s) => s.revoked_at_ms === null);
}

// §G3 签发授权（主体scope→显式targetClientId）：approver 必须 admin_scope 覆盖目标Client所在org
//（org级project_rowid NULL继承全部项目，或精确project——与现服管理面同口径，复用不新增主体语义）。
// DG121（7128016红①）：auditHook=第4可选参数——在签发写锁事务内、COMMIT 之前调用；
// 审计写失败=整事务回滚（零签发+零审计，同原子），路由回500，不出现"已提交授权但缺审计"。
export function issueGroupGrant(db, wire, approver, auditHook) {
  allowKeys(wire, ["targetClientId", "groupId", "expectedRevision", "memberSha256", "payloadSha256", "payloadBytes", "dispatchPlanSha256", "ttlSec"], "group grant issue");
  if (!ULID.test(String(wire.targetClientId ?? ""))) throw gerr("GROUP_INVALID", "targetClientId must be explicit Desktop ULID");
  if (!UUIDV4.test(String(wire.groupId ?? ""))) throw gerr("GROUP_INVALID", "groupId must be UUIDv4");
  const expectedRevision = intRange(wire.expectedRevision, "expectedRevision", 1, Number.MAX_SAFE_INTEGER);
  for (const [k, v] of [["memberSha256", wire.memberSha256], ["payloadSha256", wire.payloadSha256], ["dispatchPlanSha256", wire.dispatchPlanSha256]])
    if (!SHA.test(String(v ?? ""))) throw gerr("GROUP_INVALID", k + " must be sha256");
  const payloadBytes = intRange(wire.payloadBytes, "payloadBytes", 0, MAX_PAYLOAD_BYTES);
  const ttlSec = wire.ttlSec === undefined ? 3600 : intRange(wire.ttlSec, "ttlSec", 1, MAX_TTL_SEC);
  const grantUid = randomUUID();
  const exec = db.exec.bind(db);
  // DG113红②③：审批角色/scope/到期/吊销与目标Client归属核全部移入 BEGIN IMMEDIATE 写锁内——
  // 锁内重判消灭"身份裁决已过、写锁未得"的跨进程TOCTOU；签发时间亦锁内取。
  exec("BEGIN IMMEDIATE");
  try {
    const scopes = approverScope(db, approver); // T二次核（锁内）
    const target = db.prepare("SELECT id, org_rowid, project_rowid, status FROM client WHERE client_ulid=?").get(wire.targetClientId); // Select锁内
    if (!target || target.status === "revoked") throw gerr("GROUP_NOT_FOUND", "target client not found or revoked");
    if (!scopes.some((s) => s.org_rowid === target.org_rowid && (s.project_rowid === null || s.project_rowid === target.project_rowid)))
      throw gerr("GROUP_OWNER_MISMATCH", "approver scope does not cover target client org/project"); // 跨scope拒绝
    const at = Date.now(), expiresAt = at + ttlSec * 1000; // 锁内取时
    const grantWire = JSON.stringify({ // 排序键化（本模块局部定义，够可审计）
      dispatchPlanSha256: wire.dispatchPlanSha256, expectedRevision, groupId: wire.groupId,
      memberSha256: wire.memberSha256, payloadBytes, payloadSha256: wire.payloadSha256,
      stepProfile: "bound-payload", targetClientId: wire.targetClientId, ttlSec });
    db.prepare("INSERT INTO group_execution_grant VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(grantUid, approver.rowid, approver.label, wire.targetClientId, wire.groupId, expectedRevision,
        wire.memberSha256, wire.payloadSha256, payloadBytes, wire.dispatchPlanSha256, "bound-payload",
        grantWire, at, expiresAt, null, null, null, at, at);
    if (typeof auditHook === "function") auditHook({ action: "group.grant.issue", grantId: grantUid, targetClientId: wire.targetClientId, groupId: wire.groupId, ttlSec }); // DF121同事务审计钩子（异常=整回滚）
    exec("COMMIT");
    return { grantId: grantUid, targetClientId: wire.targetClientId, groupId: wire.groupId, stepProfile: "bound-payload", issuedAtMs: at, expiresAtMs: expiresAt, ttlSec };
  } catch (e) { try { exec("ROLLBACK"); } catch { /* already rolled back */ } throw e; }
}

// §G4 授权判决（默认拒绝；消费CAS：BEGIN IMMEDIATE内单绑consumed_request_uid——同一授权被另一
// requestId重放=拒绝；同request重连重验=幂等放行）。
export function verifyGroupGrantForDispatch(db, binding, session) {
  if (!session || !ULID.test(String(session.clientUlid ?? ""))) throw gerr("GROUP_INVALID", "trusted dispatch session required");
  allowKeys(binding, ["requestId", "clientId", "groupId", "expectedRevision", "memberSha256", "payloadSha256", "payloadBytes", "dispatchPlanSha256"], "grant binding");
  if (binding.clientId !== session.clientUlid) throw gerr("GROUP_OWNER_MISMATCH", "verify must target the session owner");
  // DG113红④：严格typed binding校验（消费前零写拒绝；不依赖SQLite隐式亲和匹配——"1"字符串绑INTEGER列会被匹配，
  // 必须在SQL前显式类型核）：requestId/groupId=UUIDv4、expectedRevision/payloadBytes=安全整数、三摘要=sha256。
  if (!UUIDV4.test(String(binding.requestId ?? ""))) throw gerr("GROUP_INVALID", "requestId must be UUIDv4");
  if (!UUIDV4.test(String(binding.groupId ?? ""))) throw gerr("GROUP_INVALID", "groupId must be UUIDv4");
  intRange(binding.expectedRevision, "expectedRevision", 1, Number.MAX_SAFE_INTEGER);
  intRange(binding.payloadBytes, "payloadBytes", 0, MAX_PAYLOAD_BYTES);
  for (const [k, v] of [["memberSha256", binding.memberSha256], ["payloadSha256", binding.payloadSha256], ["dispatchPlanSha256", binding.dispatchPlanSha256]])
    if (!SHA.test(String(v ?? ""))) throw gerr("GROUP_INVALID", k + " must be sha256");
  const exec = db.exec.bind(db);
  // DG113红③：时间裁决全部在取得 BEGIN IMMEDIATE 写锁之后取值——跨锁等待（含父进程持锁至授权过期后提交）
  // 后重判保证 expired 不可能被消费。
  exec("BEGIN IMMEDIATE");
  try {
    const now = Date.now(); // 锁内取时
    const deny = (why) => { exec("ROLLBACK"); throw gerr("GROUP_AUTHORIZATION_REQUIRED", why); };
    const bindingWhere = "target_client_ulid=? AND group_uid=? AND expected_revision=? AND member_sha=? AND payload_sha=? AND payload_bytes=? AND plan_sha=?";
    const bindingArgs = [binding.clientId, binding.groupId, binding.expectedRevision, binding.memberSha256, binding.payloadSha256, binding.payloadBytes, binding.dispatchPlanSha256];
    // DG115（7125588类①）：原request已消费的行优先对账——同request重验必须落回原grant（保留UNIQUE
    // consumed_request_uid与同request幂等语义；不以"删唯一约束/换行CAS"绕行）。
    const orig = db.prepare(`SELECT * FROM group_execution_grant WHERE ${bindingWhere} AND consumed_request_uid=?`).get(...bindingArgs, binding.requestId);
    if (orig) {
      if (orig.revoked_at_ms !== null) deny("original consumed grant is revoked; reapproval cannot resurrect it");
      if (orig.expires_at_ms <= now) deny("original consumed grant is expired at lock-time judgment");
      const g = orig; // 锁内终判同下（幂等重放原行）
      if (g.consumed_request_uid === null) db.prepare("UPDATE group_execution_grant SET updated_at_ms=? WHERE grant_uid=? AND consumed_request_uid IS NULL").run(now, g.grant_uid);
      exec("COMMIT");
      return {
        authorized: true, grantId: g.grant_uid, stepProfile: g.step_profile,
        targetClientId: g.target_client_ulid, groupId: g.group_uid, expectedRevision: g.expected_revision,
        memberSha256: g.member_sha, payloadSha256: g.payload_sha, payloadBytes: g.payload_bytes,
        dispatchPlanSha256: g.plan_sha,
        approverLabel: g.approver_label, issuedAtMs: g.issued_at_ms, expiresAtMs: g.expires_at_ms,
        revoked: false, consumedByRequest: binding.requestId,
      };
    }
    // DG113红⑤：无原行时=同绑定下过滤 revoked/过期 + 未消费行、按签发时间取最新（吊销行不遮蔽重批）。
    const g = db.prepare(`SELECT * FROM group_execution_grant WHERE ${bindingWhere} AND revoked_at_ms IS NULL AND expires_at_ms > ? AND consumed_request_uid IS NULL ORDER BY issued_at_ms DESC, grant_uid LIMIT 1`)
      .get(...bindingArgs, now);
    if (!g) {
      // 审批缺失与"曾有授权但已吊销/过期/被他request消费"同答（不泄grant存在性）；吊销重批语义归红⑤新行命中解决。
      const shadowed = db.prepare("SELECT 1 FROM group_execution_grant WHERE target_client_ulid=? AND group_uid=? AND expected_revision=? AND member_sha=? AND payload_sha=? AND payload_bytes=? AND plan_sha=? LIMIT 1")
        .get(...bindingArgs);
      deny(shadowed ? "binding has grants but none effective (revoked/expired) or the latest effective one is consumed by another requestId"
                    : "no grant binds this exact dispatch payload/member/revision (approval missing or payload tampered)");
    }
    if (g.expires_at_ms <= now) deny("grant expired"); // 锁内终判（冗余守卫：SELECT已过滤）
    if (g.consumed_request_uid === null)
      db.prepare("UPDATE group_execution_grant SET consumed_request_uid=?, updated_at_ms=? WHERE grant_uid=? AND consumed_request_uid IS NULL").run(binding.requestId, now, g.grant_uid);
    exec("COMMIT");
    return {
      authorized: true, grantId: g.grant_uid, stepProfile: g.step_profile,
      targetClientId: g.target_client_ulid, groupId: g.group_uid, expectedRevision: g.expected_revision,
      memberSha256: g.member_sha, payloadSha256: g.payload_sha, payloadBytes: g.payload_bytes,
      dispatchPlanSha256: g.plan_sha, // 供客户端逐哈希复核——不信结论标签，先比字段
      approverLabel: g.approver_label, issuedAtMs: g.issued_at_ms, expiresAtMs: g.expires_at_ms,
      revoked: false, consumedByRequest: binding.requestId,
    };
  } catch (e) {
    if (e instanceof ApiError) throw e; // deny已回滚
    try { exec("ROLLBACK"); } catch { /* already rolled back */ }
    throw e;
  }
}

// §G5 显式吊销（审批者scope覆盖目标client才可吊销；幂等；进程内不自动失效取消派发的授权——取消语义
// 由客户端四步序在authorize前拒绝，授权只经此显式吊销或TTL失效）。
// DG121（7128016红②）：吊销同事务审计钩子——新吊销与幂等重放都在各自写锁事务内先审计后COMMIT；
// 审计失败=整回滚（零state变化+零审计），路由回500，不出现"已吊销但缺审计"。
export function revokeGroupGrant(db, { grantId }, approver, auditHook) {
  if (!UUIDV4.test(String(grantId ?? ""))) throw gerr("GROUP_INVALID", "grantId must be UUIDv4");
  const exec = db.exec.bind(db);
  // DG113红①②：吊销/appraiser角色与scope裁决同入 BEGIN IMMEDIATE——与签发同事务边界。
  exec("BEGIN IMMEDIATE");
  try {
    const scopes = approverScope(db, approver); // 锁内重判（含角色admin-only）
    const g = db.prepare("SELECT * FROM group_execution_grant WHERE grant_uid=?").get(grantId);
    if (!g) throw gerr("GROUP_NOT_FOUND", "grant not found");
    const target = db.prepare("SELECT org_rowid, project_rowid FROM client WHERE client_ulid=?").get(g.target_client_ulid);
    if (!target || !scopes.some((s) => s.org_rowid === target.org_rowid && (s.project_rowid === null || s.project_rowid === target.project_rowid)))
      throw gerr("GROUP_OWNER_MISMATCH", "approver scope does not cover this grant target"); // 跨scope不可吊销他人授权
    if (g.revoked_at_ms !== null) {
      if (typeof auditHook === "function") auditHook({ action: "group.grant.revoke", grantId, replay: true, revokedAtMs: g.revoked_at_ms }); // 幂等重放同事务审计
      exec("COMMIT"); return { grantId, revoked: true, revokedAtMs: g.revoked_at_ms, replay: true };
    }
    const now = Date.now(); // 锁内取时
    db.prepare("UPDATE group_execution_grant SET revoked_at_ms=?, revoked_by_rowid=?, updated_at_ms=? WHERE grant_uid=?")
      .run(now, approver.rowid, now, grantId);
    if (typeof auditHook === "function") auditHook({ action: "group.grant.revoke", grantId, replay: false, revokedAtMs: now });
    exec("COMMIT");
    return { grantId, revoked: true, revokedAtMs: now, replay: false };
  } catch (e) { try { exec("ROLLBACK"); } catch { /* already rolled back */ } throw e; }
}

export function getGroupGrant(db, grantId) {
  if (!UUIDV4.test(String(grantId ?? ""))) throw gerr("GROUP_INVALID", "grantId must be UUIDv4");
  const r = db.prepare("SELECT * FROM group_execution_grant WHERE grant_uid=?").get(grantId);
  return r ? {
    grantId: r.grant_uid, approverRowid: r.approver_rowid, approverLabel: r.approver_label,
    targetClientId: r.target_client_ulid, groupId: r.group_uid, expectedRevision: r.expected_revision,
    memberSha256: r.member_sha, payloadSha256: r.payload_sha, payloadBytes: r.payload_bytes,
    dispatchPlanSha256: r.plan_sha, stepProfile: r.step_profile,
    issuedAtMs: r.issued_at_ms, expiresAtMs: r.expires_at_ms,
    revokedAtMs: r.revoked_at_ms, consumedRequestUid: r.consumed_request_uid, createdAtMs: r.created_at_ms,
  } : null;
}

// §G6 消费端外层规范化合并（DG113红⑥）：DG110 inbox行.wire（真实现wire形=clientWire扩展，含clientId/dispatchId
// 可信外层字段）与Server pending项外层（memberSha256等Server权威值）分属两层——本函数显式合并并核一致性：
//   - wire可携带DG110实际外层键（clientId/dispatchId）——均须与outer/会话一致，不允许wire自报memberSha256以外的
//     身份来源（memberSha256必须来自Server外层，wire里若带也只作一致性检查不作为权威）。
//   - 统一产出=严格typed的verify binding域（requestId/clientId/groupId/expectedRevision/三摘要/bytes）。
export function bindingFromConsumerEnvelope(wire, outer, session) {
  // R3（7126302）：恢复wire严格对象与未知键拒绝（DG115重写时误删）——未知键（如untrustedAuthorization）不进规范化
  allowKeys(wire, ["clientId", "dispatchId", "groupId", "expectedRevision", "requestId", "payload", "payloadSha256", "payloadBytes", "dispatchPlanSha256", "memberSha256"], "consumer inbox wire");
  allowKeys(outer, ["clientId", "dispatchId", "requestId", "groupId", "expectedRevision", "memberSha256",
    "payloadSha256", "payloadBytes", "dispatchPlanSha256"], "trusted outer envelope"); // DG115：outer允许承载全binding域——可选载荷字若存在须与wire一致（不产生额外信任）
  // DG115（7125588类③）：会话必填（可信transport上下文）——省略即拒；epoch/seq归属transport注入，不由payload自证。
  if (!session || Object.getPrototypeOf(session) !== Object.prototype || !ULID.test(String(session.clientUlid ?? "")))
    throw gerr("GROUP_INVALID", "trusted session is required for normalization (wire and outer alone are not trustable)");
  if (!ULID.test(String(outer.clientId ?? ""))) throw gerr("GROUP_INVALID", "outer clientId must be ULID");
  if (outer.memberSha256 === undefined || !SHA.test(String(outer.memberSha256))) throw gerr("GROUP_INVALID", "outer memberSha256 must be authoritative sha256");
  if (session.clientUlid !== outer.clientId) throw gerr("GROUP_OWNER_MISMATCH", "envelope target must be the session owner");
  // DG115（7125588类③）+R5（7126302）：规范化即严格typed且严格域——字符串/负值/零revision在此
  // 拒绝（wire与outer同坏按规范阶段拒，不靠下游verify兜底），绝不隐式透过（先于一致性比对）。
  if (!Number.isSafeInteger(wire.expectedRevision) || wire.expectedRevision < 1) throw gerr("GROUP_INVALID", "wire expectedRevision must be integer >= 1 at normalization");
  if (!Number.isSafeInteger(wire.payloadBytes) || wire.payloadBytes < 0 || wire.payloadBytes > MAX_PAYLOAD_BYTES) throw gerr("GROUP_INVALID", "wire payloadBytes must be integer in [0," + MAX_PAYLOAD_BYTES + "] at normalization"); // DG118：补签发端同款上界（262144B），超界即拒——与签发/verify口径一致
  if (!UUIDV4.test(String(wire.requestId ?? "")) || !UUIDV4.test(String(wire.groupId ?? ""))) throw gerr("GROUP_INVALID", "wire ids must be UUIDv4");
  if (outer.expectedRevision < 1) throw gerr("GROUP_INVALID", "outer expectedRevision must be integer >= 1 (shared issue-domain)"); // 同坏revision在outer侧先拒
  // R4（7126302）：dispatchId=可信派发身份，wire与outer两侧必填且UUIDv4——不与grantId互当来源
  if (!UUIDV4.test(String(wire.dispatchId ?? "")) || !UUIDV4.test(String(outer.dispatchId ?? "")))
    throw gerr("GROUP_INVALID", "dispatchId must be present UUIDv4 on both wire and trusted outer (trusted dispatch identity)");
  if (wire.dispatchId !== outer.dispatchId) throw gerr("GROUP_EXECUTION_CONFLICT", "wire dispatchId differs from trusted outer dispatchId");
  // DG115（7125588类③）：trusted outer与wire的requestId/groupId/expectedRevision必须一致（outer三者均必填）
  for (const k of ["requestId", "groupId"]) if (outer[k] === undefined || outer[k] !== wire[k])
    throw gerr("GROUP_EXECUTION_CONFLICT", "outer " + k + " missing or differs from consumer wire");
  if (outer.expectedRevision === undefined || outer.expectedRevision !== wire.expectedRevision)
    throw gerr("GROUP_EXECUTION_CONFLICT", "outer expectedRevision missing or differs from consumer wire");
  const merged = {
    requestId: wire.requestId, clientId: outer.clientId, groupId: wire.groupId,
    expectedRevision: wire.expectedRevision,
    memberSha256: outer.memberSha256, // 权威值来自Server pending/事件外层；wire.memberSha256（若在）只作一致性检查
    payloadSha256: wire.payloadSha256, payloadBytes: wire.payloadBytes, dispatchPlanSha256: wire.dispatchPlanSha256,
  };
  for (const k of ["payloadSha256", "payloadBytes", "dispatchPlanSha256"])
    if (outer[k] !== undefined && outer[k] !== wire[k]) throw gerr("GROUP_EXECUTION_CONFLICT", "outer " + k + " differs from consumer wire");
  if (wire.clientId !== undefined && wire.clientId !== outer.clientId)
    throw gerr("GROUP_EXECUTION_CONFLICT", "consumer wire clientId does not match trusted outer clientId");
  if (wire.memberSha256 !== undefined && wire.memberSha256 !== outer.memberSha256)
    throw gerr("GROUP_EXECUTION_CONFLICT", "consumer memberSha256 differs from trusted outer");
  const body = JSON.stringify(wire.payload, (_k, x) => x && Object.getPrototypeOf(x) === Object.prototype ? Object.fromEntries(Object.keys(x).sort().map((s) => [s, x[s]])) : x);
  if (Buffer.byteLength(body, "utf8") !== wire.payloadBytes || createHash("sha256").update(body).digest("hex") !== wire.payloadSha256)
    throw gerr("GROUP_EXECUTION_CONFLICT", "payload does not match its declared digest");
  // DG115（7125588类③）：plan摘要自校验（与legacy bindingFromClientWire同款分域公式）——全零/畸形摘要在规范化即拒
  const plan = JSON.stringify({ expectedRevision: wire.expectedRevision, groupId: wire.groupId, payload: wire.payload, requestId: wire.requestId },
    (_k, x) => x && Object.getPrototypeOf(x) === Object.prototype ? Object.fromEntries(Object.keys(x).sort().map((s) => [s, x[s]])) : x);
  if (!SHA.test(String(wire.dispatchPlanSha256 ?? "")) || createHash("sha256").update(plan).digest("hex") !== wire.dispatchPlanSha256)
    throw gerr("GROUP_EXECUTION_CONFLICT", "wire does not match its declared dispatchPlanSha256");
  return merged;
}
// 兼容旧名（等同 outer=null 的零信任禁用形态——禁止在无外层时使用）：
export function bindingFromClientWire(wire) {
  // 红⑥处置：本入口保留但收严——DG110 inbox wire实形=clientWire扩展（可含clientId/dispatchId），此处显式放行
  // 两个外层身份键（只用作一致性/归属检查，不产生信任）；memberSha256必须随wire权威携带（Server pending/事件域），
  // 缺席即拒并指向 bindingFromConsumerEnvelope 的显式外层合并路径。不允许再闭眼拒绝真实消费输入（原红⑥反例）。
  allowKeys(wire, ["clientId", "dispatchId", "groupId", "expectedRevision", "requestId", "payload", "payloadSha256", "payloadBytes", "dispatchPlanSha256", "memberSha256"], "consumer inbox wire");
  if (wire.memberSha256 === undefined)
    throw gerr("GROUP_INVALID", "wire lacks authoritative memberSha256 — use bindingFromConsumerEnvelope(wire, outer, session) to merge the Server outer envelope");
  if (!UUIDV4.test(String(wire.dispatchId ?? "")) && wire.dispatchId !== undefined) throw gerr("GROUP_INVALID", "dispatchId must be UUIDv4");
  const body = JSON.stringify(wire.payload, (_k, x) => x && Object.getPrototypeOf(x) === Object.prototype ? Object.fromEntries(Object.keys(x).sort().map((s) => [s, x[s]])) : x);
  if (Buffer.byteLength(body, "utf8") !== wire.payloadBytes || createHash("sha256").update(body).digest("hex") !== wire.payloadSha256)
    throw gerr("GROUP_EXECUTION_CONFLICT", "payload does not match its declared digest");
  const plan = JSON.stringify({ expectedRevision: wire.expectedRevision, groupId: wire.groupId, payload: wire.payload, requestId: wire.requestId },
    (_k, x) => x && Object.getPrototypeOf(x) === Object.prototype ? Object.fromEntries(Object.keys(x).sort().map((s) => [s, x[s]])) : x);
  if (createHash("sha256").update(plan).digest("hex") !== wire.dispatchPlanSha256)
    throw gerr("GROUP_EXECUTION_CONFLICT", "wire does not match its declared dispatchPlanSha256");
  return { requestId: wire.requestId, clientId: wire.clientId, groupId: wire.groupId, expectedRevision: wire.expectedRevision,
    memberSha256: wire.memberSha256, payloadSha256: wire.payloadSha256, payloadBytes: wire.payloadBytes, dispatchPlanSha256: wire.dispatchPlanSha256 };
}

// §G7 消费判决核（同步、零信任结论标签）：客户端在异步verify取回判决后，**必须**经本同步核对全部绑定
// 字段+时效再采纳 authorized——DG110 authorize钩子是同步true/false，异步桥正确用法=先fetch判决
// （异步）→checkGrantVerdict（同步核对）→钩子内同步返回核对结果。不缓存布尔、不凭authorized直接放行。
export function checkGrantVerdict(verdict, binding, session, now = Date.now()) {
  if (!session || !ULID.test(String(session.clientUlid ?? ""))) throw gerr("GROUP_INVALID", "trusted dispatch session required");
  if (!Number.isSafeInteger(now)) throw gerr("GROUP_AUTHORIZATION_REQUIRED", "consumer clock must be a finite safe-integer instant (trusted caller parameter)"); // DG115（7125588类②）：NaN时钟不得绕过期限判断（受信参数加固）
  if (!verdict || Object.getPrototypeOf(verdict) !== Object.prototype) throw gerr("GROUP_AUTHORIZATION_REQUIRED", "verdict missing");
  if (verdict.authorized !== true) throw gerr("GROUP_AUTHORIZATION_REQUIRED", "verdict not authorized");
  if (verdict.stepProfile !== "bound-payload") throw gerr("GROUP_AUTHORIZATION_REQUIRED", "unexpected stepProfile");
  if (typeof verdict.revoked !== "boolean" || verdict.revoked !== false) throw gerr("GROUP_AUTHORIZATION_REQUIRED", "verdict revoked flag must be present boolean false (fail closed)"); // DG115：缺revoked关死
  if (!UUIDV4.test(String(verdict.grantId ?? ""))) throw gerr("GROUP_AUTHORIZATION_REQUIRED", "verdict grantId must be present UUIDv4"); // DG115：缺grantId关死
  if (verdict.targetClientId !== session.clientUlid || verdict.targetClientId !== binding.clientId)
    throw gerr("GROUP_AUTHORIZATION_REQUIRED", "verdict target mismatch");
  // R1（7126302）：必填域核在比较前——判决与binding同缺任一必填键=undefined===undefined不得通过（fail closed）
  // R2：严格域约束与issue同口径——revision 1..MAX_SAFE_INTEGER、bytes 0..262144、三摘要sha256、
  // groupId/requestId UUIDv4、clientId ULID；不支持负/0 revision
  if (!Number.isSafeInteger(binding.expectedRevision) || binding.expectedRevision < 1)
    throw gerr("GROUP_AUTHORIZATION_REQUIRED", "binding expectedRevision must be required integer >= 1 (shared issue-domain)");
  if (!Number.isSafeInteger(binding.payloadBytes) || binding.payloadBytes < 0 || binding.payloadBytes > MAX_PAYLOAD_BYTES)
    throw gerr("GROUP_AUTHORIZATION_REQUIRED", `binding payloadBytes must be required integer in [0,${MAX_PAYLOAD_BYTES}] (shared issue-domain)`); // DG118：补上界
  if (!UUIDV4.test(String(binding.groupId ?? ""))) throw gerr("GROUP_AUTHORIZATION_REQUIRED", "binding groupId must be required UUIDv4");
  if (!UUIDV4.test(String(binding.requestId ?? ""))) throw gerr("GROUP_AUTHORIZATION_REQUIRED", "binding requestId must be required UUIDv4");
  if (!ULID.test(String(binding.clientId ?? ""))) throw gerr("GROUP_AUTHORIZATION_REQUIRED", "binding clientId must be required ULID");
  for (const k of ["memberSha256", "payloadSha256", "dispatchPlanSha256"])
    if (!SHA.test(String(binding[k] ?? ""))) throw gerr("GROUP_AUTHORIZATION_REQUIRED", "binding " + k + " must be required sha256");
  if (!Number.isSafeInteger(verdict.expectedRevision) || verdict.expectedRevision < 1)
    throw gerr("GROUP_AUTHORIZATION_REQUIRED", "verdict expectedRevision must be required integer >= 1");
  if (!Number.isSafeInteger(verdict.payloadBytes) || verdict.payloadBytes < 0 || verdict.payloadBytes > MAX_PAYLOAD_BYTES)
    throw gerr("GROUP_AUTHORIZATION_REQUIRED", `verdict payloadBytes must be required integer in [0,${MAX_PAYLOAD_BYTES}]`); // DG118：补上界
  if (!UUIDV4.test(String(verdict.groupId ?? ""))) throw gerr("GROUP_AUTHORIZATION_REQUIRED", "verdict groupId must be required UUIDv4");
  for (const k of ["memberSha256", "payloadSha256", "dispatchPlanSha256"])
    if (!SHA.test(String(verdict[k] ?? ""))) throw gerr("GROUP_AUTHORIZATION_REQUIRED", "verdict " + k + " must be required sha256");
  for (const [k, actual, expected] of [
    ["groupId", verdict.groupId, binding.groupId], ["expectedRevision", verdict.expectedRevision, binding.expectedRevision],
    ["memberSha256", verdict.memberSha256, binding.memberSha256], ["payloadSha256", verdict.payloadSha256, binding.payloadSha256],
    ["payloadBytes", verdict.payloadBytes, binding.payloadBytes], ["dispatchPlanSha256", verdict.dispatchPlanSha256, binding.dispatchPlanSha256],
    ["consumedByRequest", verdict.consumedByRequest, binding.requestId],
  ]) if (actual !== expected) throw gerr("GROUP_AUTHORIZATION_REQUIRED", "verdict binding mismatch: " + k);
  // DG115：签发时间不得来自未来、时间区间必须正序且当前时刻在内（issuedAt<=now<expiresAt）。
  if (!Number.isSafeInteger(verdict.issuedAtMs) || !Number.isSafeInteger(verdict.expiresAtMs)
      || verdict.issuedAtMs > now || verdict.expiresAtMs <= now || verdict.issuedAtMs >= verdict.expiresAtMs)
    throw gerr("GROUP_AUTHORIZATION_REQUIRED", "verdict issuance/expiry interval invalid or expired at consumer boundary");
  return true;
}
