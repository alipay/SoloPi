import {createAdminAdmission} from './admin-admission.mjs';
import { registerLabRoutes } from './lab-platform.mjs';
// SoloPi Lab Server — stage A application (contracts v0.1.6)
// 17 endpoints (schemas/endpoint-bindings.json). Auth order per contract §2.1/§0.6.
import { openDatabase, migrate, one, many, run, getOrCreateStream, appendEvent, currentMigrationVersion } from "./db.mjs";
import { validateRef } from "./schemacheck.mjs";
import { upsertGroupRegistration, upsertGroupExecution, validateRegistration, validateExecution } from "./group-registry.mjs"; // C98+ C100（DG1接线；校验复用避免接层连500）
import { listGroupLevels } from "./group-levels-ro.mjs"; // DG142只读组投影（网站层级数据面；零写、scope内admin面）
import { createGroupDispatch, requestDispatchCancel, listPendingGroupDispatches, reconcileGroupDispatch } from "./group-dispatch.mjs"; // DG110：派发账本接线候选（dd7a116已过模块；登记路由+镜像钩子）
import { issueGroupGrant, revokeGroupGrant, verifyGroupGrantForDispatch } from "./group-grant.mjs"; // DG120：授权HTTP接线（f47430e已审模块）
import { ulid, toRfc3339, fromRfc3339, sha256b64, verifyChallenge, publicKeyFingerprint, newToken,
         ApiError, vErr, SAFE_MAX } from "./util.mjs";

export const CONTRACT_VERSION = "0.1.6";
// C29用户裁定：注册直达成功（不再人工审批）。默认auto；受控部署合同面=auto on。
// 环境开关 SOLOPI_AUTO_APPROVE=0 时回退旧审批合同（隔离回归用它核对两条路径）。
const AUTO_APPROVE = process.env.SOLOPI_AUTO_APPROVE !== "0";
const DEFAULT_LEASE_SEC = 3600;
const HEARTBEAT_INTERVAL_SEC = 15;
const MAX_RENEW_WINDOW_MS = 720 * 3600 * 1000;
const CHALLENGE_TTL_SEC = 60;
const STREAM_RE = /^(client|org|project):([0-7][0-9A-HJKMNP-TV-Z]{25})$/;
const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

// ---------- admission ----------
// Code security: 管理身份只从 Bearer hash 校验得出（可信T）；body/query的orgId/projectId仅作过滤参数(U)
const adminSubject=createAdminAdmission();

// W25(root裁定01a1b448-3)gate最小移植（目标3权限修复，独立于DG146来源分类）：个人固定scope
// operator凭据最小权限白名单——仅任务create/list/detail/cancel；其余admin路由（clients/enrollments
// 决策/revoke/renew/media等）一律403 AUTH_SCOPE_DENIED（收窄不放宽；admin角色不受限）。
const OPERATOR_ROUTES = new Set([
  "POST /v1/agent-tasks", "GET /v1/agent-tasks", "GET /v1/agent-tasks/{agentTaskId}", "POST /v1/agent-tasks/{agentTaskId}/cancel",
  // 目标4受限读面(队长01a1bb35授权专用只读): 组详情/派发详情/组登记读 — 全部都会再过Select+checkAdminScope, 不开放clients/enrollments其他管理面
  "GET /v1/group-dispatch-detail/{requestId}",
  "GET /v1/group-dispatches-by-admin/{requestId}",
  "GET /v1/group-registrations"
]);
function assertAdminRole(method, pattern, subj) {
  if ((subj.role ?? "admin") === "operator" && !OPERATOR_ROUTES.has(method + " " + pattern)) {
    throw new ApiError("AUTH_SCOPE_DENIED", "operator token limited to agent-task create/read/cancel");
  }
}

// Code security: Select模式——目标scope必须被主体授权行覆盖（org行=继承全部项目），失败终止403
function checkAdminScope(subj, db, orgRowid, projectRowid = null) {
  const ok = subj.scopes.some((s) =>
    s.org_rowid === orgRowid && (s.project_rowid === null || projectRowid === null || s.project_rowid === projectRowid));
  if (!ok) throw new ApiError("AUTH_SCOPE_DENIED", "target scope not granted");
}
// C8 R4修复：org级聚合流仅org级grant可读——项目级grant（project非空）不因目标无项目限定而升级
function checkAdminOrgScope(subj, db, orgRowid) {
  const ok = subj.scopes.some((s) => s.org_rowid === orgRowid && s.project_rowid === null);
  if (!ok) throw new ApiError("AUTH_SCOPE_DENIED", "org stream requires org-wide grant");
}

// session admission (contract §2.1 ①—③; used with body params when a body exists)
function currentSession(db, bearer) {
  if (!bearer) throw new ApiError("AUTH_REQUIRED", "session token required");
  const s = one(db, `
    SELECT se.id, se.epoch, se.token_hash, se.client_rowid, se.lease_expires_at_ms, se.revoked_at_ms,
           c.client_ulid, c.status AS client_status, c.last_epoch, c.org_rowid, c.project_rowid, c.valid_until_ms
    FROM session se JOIN client c ON c.id = se.client_rowid
    WHERE se.token_hash = ?`, sha256b64(bearer));
  if (!s) throw new ApiError("AUTH_TOKEN_INVALID", "invalid session token");
  if (s.client_status === "revoked") throw new ApiError("AUTH_REVOKED", "client revoked");
  if (s.valid_until_ms <= Date.now()) throw new ApiError("AUTH_REVOKED", "client expired"); // C8 R3：身份有效期独立于租约
  if (s.revoked_at_ms !== null || s.epoch !== s.last_epoch) throw new ApiError("AUTH_TOKEN_INVALID", "session superseded");
  if (s.lease_expires_at_ms <= Date.now()) throw new ApiError("AUTH_TOKEN_INVALID", "session lease expired");
  return s;
}
// C29补遗：注销路由专用准入（§2.1①→②→③完整序）：严格currentSession；AUTH_REVOKED时仅在
// "Bearer命中的会话正是本注销自身吊销的会话"（session.revoked==client.revoked）时放行为幂等收据；
// 随后②③回显校验保持与其他会话路由同序。只在注销路由使用——heartbeat等准入不放宽。
function revokeReceiptSession(db, bearer, body) {
  let sess;
  try { sess = currentSession(db, bearer); }
  catch (e) {
    if (!(e instanceof ApiError) || e.code !== "AUTH_REVOKED") throw e;
    // B1修复：凭据收据接收方必须是发起吊销的那一个会话——client.revoked_by_session精确记录该会话行id。
    // 不再使用吊销时间相等作依据（旧epoch会话在签发/自注销事务中同批置位，时间相等无法证明"本次注销会话"）。
    const echo = one(db, `
      SELECT se.id, se.epoch, se.token_hash, se.lease_expires_at_ms, se.revoked_at_ms,
             se.client_rowid, c.client_ulid, c.status AS client_status, c.revoked_by_session
      FROM session se JOIN client c ON c.id = se.client_rowid
      WHERE se.token_hash = ?`, sha256b64(bearer));
    if (!echo || echo.revoked_by_session === null || echo.id !== echo.revoked_by_session) throw e;
    sess = echo;
  }
  assertBodySession(sess, body);
  return sess;
}
// C101（7116276）：组投影路由的真实Client会话+归属Check前置（dispatch schema层之前执行）——
// 准入顺序恒定：先验"谁在提交、是否本Client的组"，再谈封套形态；畸形wire的未授权提交不会被schema 422吸收。
function groupRouteAdmission(db, ctx) {
  const sess = currentSession(db, ctx.bearer);
  const claimed = ctx.body?.clientId;
  if (claimed !== undefined && claimed !== sess.client_ulid)
    throw new ApiError("GROUP_OWNER_MISMATCH", "registry caller session does not own this clientId", { clientId: claimed });
  return sess;
}
function assertBodySession(sess, body) {
  if (!body.sessionId || sha256b64(body.sessionId) !== sess.token_hash) throw new ApiError("AUTH_TOKEN_INVALID", "session mismatch");
  if (!Number.isInteger(body.epoch) || body.epoch !== sess.epoch) throw new ApiError("SESSION_EPOCH_CONFLICT", "stale epoch");
}

// ---------- helpers ----------
function eq(x) { return x; }
function requireFields(body, fields) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw vErr("body must be a JSON object");
  for (const f of fields) if (body[f] === undefined || body[f] === null || body[f] === "") throw vErr("missing field: " + f);
}
function safeInt(v, name, { min = 0, max = SAFE_MAX } = {}) {
  if (!Number.isInteger(v) || v < min || v > max) throw vErr("invalid integer: " + name, { [name]: { min, max } });
  return v;
}
function nowMs() { return Date.now(); }
function getDb(request) { return request.db; }
function parseBearer(headers) {
  const h = headers?.authorization;
  const m = /^Bearer ([A-Za-z0-9._-]+)$/.exec(h ?? "");
  return m ? m[1] : null;
}
function emit(db, streamKey, epoch, type, data, at) { try { appendEvent(db, streamKey, epoch, type, data, at); } catch (e) { /* append never breaks主流程; seq连续由触发器保证 */ throw e; } }

function challengeCreate(db, subjectKey, subjectType, purpose) {
  const at = nowMs();
  const challenge = newToken();
  run(db, "INSERT INTO challenge(subject_key, subject_type, purpose, challenge_hash, created_at_ms, expires_at_ms) VALUES (?,?,?,?,?,?)",
      subjectKey, subjectType, purpose, sha256b64(challenge), at, at + CHALLENGE_TTL_SEC * 1000);
  return { challenge, expiresInSec: CHALLENGE_TTL_SEC };
}
// any final verification attempt consumes the challenge (anti-enumeration, §1.6)
function challengeConsume(db, challenge, subjectKey, purpose) {
  const at = nowMs();
  const row = one(db, "SELECT id, subject_key, purpose, expires_at_ms, consumed_at_ms FROM challenge WHERE challenge_hash = ? AND subject_key = ? AND purpose = ?",
                  sha256b64(challenge), subjectKey, purpose);
  if (!row || row.consumed_at_ms !== null || row.expires_at_ms <= at) throw new ApiError("AUTH_CHALLENGE_EXPIRED", "challenge unusable");
  run(db, "UPDATE challenge SET consumed_at_ms = ? WHERE consumed_at_ms IS NULL AND id = ?", at, row.id);
  return row;
}
function orgProjectByKey(db, orgKey, projectKey) {
  const o = one(db, "SELECT id, org_ulid FROM org WHERE org_key = ?", orgKey);
  if (!o) throw vErr("unknown orgKey");
  const p = one(db, "SELECT id, project_ulid FROM project WHERE org_rowid = ? AND project_key = ?", o.id, projectKey);
  if (!p) throw vErr("unknown projectKey");
  return { org: o, proj: p };
}
function sqlToUtc(row) { return row === null ? null : eq(toRfc3339(row)); }
// C29共用批准事务（事务内替代批准旧身份→终结旧会话→签发client→广播事件→审计）
function approveEnrollment(db, row, adminRowId, reason) {
  const at = nowMs();
  const eid = row.enrollment_ulid;
  db.exec("BEGIN");
  try {
    const old = one(db, "SELECT * FROM client WHERE installation_ulid = ? AND status = 'approved'", row.installation_ulid);
    if (old) { // 替代批准：同事务吊销旧client、旧台账终结（DDL触发器保证不可逆）
      run(db, "UPDATE client SET status='revoked', revoked_at_ms=? WHERE id=?", at, old.id);
      run(db, "UPDATE session SET revoked_at_ms=? WHERE client_rowid=?", at, old.id);
      run(db, "UPDATE challenge SET consumed_at_ms=? WHERE subject_key=? AND subject_type='client' AND consumed_at_ms IS NULL", at, old.client_ulid);
      emit(db, "client:" + old.client_ulid, 1, "client.revoked", { reason: "superseded" }, at);
    }
    const changed = run(db, "UPDATE enrollment SET status='approved', decided_at_ms=?, decided_by_admin=?, reason=? WHERE id=? AND status='pending'", at, adminRowId, reason ?? null, row.id).changes;
    if (changed !== 1) throw new ApiError("ENROLL_ALREADY_DECIDED", "decision already made");
    const cuid = ulid(at);
    const validUntil = at + MAX_RENEW_WINDOW_MS;
    run(db, "INSERT INTO client(client_ulid, enrollment_rowid, org_rowid, project_rowid, installation_ulid, public_key_pem, fingerprint_server, status, last_epoch, granted_at_ms, valid_until_ms, device_scope_json, capabilities_json, client_version) VALUES (?,?,?,?,?,?,?, 'approved', 0, ?, ?, ?, ?, ?)",
        cuid, row.id, row.org_rowid, row.project_rowid, row.installation_ulid, row.public_key_pem, row.fingerprint_server, at, validUntil,
        row.device_scope_json ?? "{}",
        (row.capabilities_json && row.capabilities_json !== "{}") ? row.capabilities_json : JSON.stringify({ commands: true, media: false }),
        row.requested_version ?? "unknown");
    run(db, "UPDATE enrollment SET client_rowid = (SELECT id FROM client WHERE client_ulid = ?) WHERE id = ?", cuid, row.id);
    emit(db, "client:" + cuid, 1, "enrollment.approved", { enrollmentId: eid, auto: adminRowId === null }, at);
    db.exec("COMMIT");
    return { status: 200, body: { enrollmentId: eid, clientId: cuid, status: "approved", grantedAt: toRfc3339(at), validUntil: toRfc3339(validUntil), leaseDefaultSec: DEFAULT_LEASE_SEC } };
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}
function enrollmentRowOut(db, r) {
  const c = r.client_rowid ? one(db, "SELECT client_ulid FROM client WHERE id = ?", r.client_rowid) : null;
  return {
    enrollmentId: r.enrollment_ulid, installationId: r.installation_ulid, status: r.status,
    keyFingerprint: r.fingerprint_server, clientVersion: r.requested_version ?? "unknown",
    scope: { orgId: one(db, "SELECT org_ulid FROM org WHERE id = ?", r.org_rowid).org_ulid,
             projectId: one(db, "SELECT project_ulid FROM project WHERE id = ?", r.project_rowid).project_ulid },
    deviceScope: JSON.parse(r.device_scope_json), requestedAt: toRfc3339(r.requested_at_ms),
    clientId: c ? c.client_ulid : null, decidedAt: sqlToUtc(r.decided_at_ms),
  };
}
function clientSummaryOut(db, c) {
  const latest = one(db, "SELECT id, epoch, lease_expires_at_ms, revoked_at_ms from session WHERE client_rowid = ? ORDER BY epoch DESC LIMIT 1", c.id);
  const lastHb = latest ? one(db, "SELECT at_ms, local_ui_tasks, cli_tasks FROM heartbeat_log WHERE session_rowid = ? ORDER BY at_ms DESC LIMIT 1", latest.id) : null;
  let online = "unknown";
  if (latest) {
    const active = latest.revoked_at_ms === null && latest.lease_expires_at_ms > nowMs();
    if (active) online = "online";
    else if (lastHb && (lastHb.local_ui_tasks > 0 || lastHb.cli_tasks > 0)) online = "unknown";
    else online = "offline";
  }
  return {
    orgId: one(db, "SELECT org_ulid FROM org WHERE id = ?", c.org_rowid).org_ulid,
    projectId: one(db, "SELECT project_ulid FROM project WHERE id = ?", c.project_rowid).project_ulid,
    clientId: c.client_ulid, installationId: c.installation_ulid, keyFingerprint: c.fingerprint_server,
    status: c.status, online, lastHeartbeatAt: lastHb ? toRfc3339(lastHb.at_ms) : null,
    leaseExpiresAt: latest ? toRfc3339(latest.lease_expires_at_ms) : null,
    clientVersion: c.client_version ?? "unknown",
    capabilities: JSON.parse(c.capabilities_json), occupancy: { localUiTasks: lastHb ? lastHb.local_ui_tasks : 0, cliTasks: lastHb ? lastHb.cli_tasks : 0 },
    deviceScope: JSON.parse(c.device_scope_json), grantedAt: toRfc3339(c.granted_at_ms), validUntil: toRfc3339(c.valid_until_ms),
  };
}
function resolveClient(db, clientUlid, subj) {
  const c = one(db, "SELECT * FROM client WHERE client_ulid = ?", clientUlid);
  // Code security: 未命中与跨scope统一403（§4：越权不区分目标是否存在，杜绝存在性侧信道）
  if (!c) throw new ApiError("AUTH_SCOPE_DENIED", "target scope not granted");
  checkAdminScope(subj, db, c.org_rowid, c.project_rowid);
  return c;
}
function validPublicKey(pem) { try { return publicKeyFingerprint(pem); } catch { throw vErr("publicKeyPem unparsable"); } }

// ---------- routing ----------
// C8 R2：请求/响应绑定Schema按冻结版本登记（auth为准入前置，req在挑战消费/写入前422拒绝）
const ROUTE_OPTS = {
  "POST /v1/enrollments": { auth: "none",
    req: "enrollment.schema.json#/$defs/enrollmentCreateRequest",
    // C29：200=oneOf( auto批准响应|回退模式幂等重申响应 )；201=回退模式pending新生成
    resp: { 200: "enrollment.schema.json#/$defs/enrollAcceptedResponse", 201: "enrollment.schema.json#/$defs/createEnrollmentResponse" } },
  "GET /v1/enrollments": { auth: "admin", resp: { 200: "enrollment.schema.json#/$defs/enrollmentsPage" } },
  "GET /v1/enrollments/{enrollmentId}": { auth: "admin", resp: { 200: "enrollment.schema.json#/$defs/enrollmentDetail" } },
  "POST /v1/enrollments/{enrollmentId}/decision": { auth: "admin",
    req: "enrollment.schema.json#/$defs/decisionRequest", resp: { 200: "enrollment.schema.json#/$defs/decisionResponse" } },
  "POST /v1/clients/{clientId}/revoke": { auth: "admin",
    req: "enrollment.schema.json#/$defs/revokeRequest", resp: { 200: "client-summary.schema.json#/$defs/clientAdminResponse" } },
  "POST /v1/clients/{clientId}/renew": { auth: "admin",
    req: "enrollment.schema.json#/$defs/renewRequest", resp: { 200: "client-summary.schema.json#/$defs/clientAdminResponse" } },
  "POST /v1/enrollments/recover/challenge": { auth: "none",
    req: "enrollment.schema.json#/$defs/recoverChallengeRequest", resp: { 200: "session.schema.json#/$defs/challengeResponse" } },
  "POST /v1/enrollments/recover": { auth: "none",
    req: "enrollment.schema.json#/$defs/recoverRequest", resp: { 200: "enrollment.schema.json#/$defs/recoverResponse" } },
  "GET /v1/sessions/challenge": { auth: "none", resp: { 200: "session.schema.json#/$defs/challengeResponse" } },
  "POST /v1/sessions": { auth: "none",
    req: "session.schema.json#/$defs/sessionCreateRequest", resp: { 201: "session.schema.json#/$defs/sessionCreateResponse" } },
  "POST /v1/heartbeat": { auth: "session",
    req: "heartbeat.schema.json#/$defs/heartbeatRequest", resp: { 200: "heartbeat.schema.json#/$defs/heartbeatResponse" } },
  "GET /v1/clients": { auth: "admin", resp: { 200: "client-summary.schema.json#/$defs/clientsPage" } },
  "GET /v1/clients/{clientId}": { auth: "admin", resp: { 200: "client-summary.schema.json#/$defs/clientSummary" } },
  // DG142：组层级只读面（真实Desktop→组→成员/执行投影状态）——admin面（httpview经固定scope VIEWER代理），
  // 复用/v1/clients同型租户准入与分页；响应冻结于v0.4.2增量版本目录（v0.4.0/0.4.1冻结字节不动）。
  "GET /v1/group-levels": { auth: "admin", resp: { 200: "v0.4.2/group-levels.schema.json#/$defs/groupLevelsPage" } },
  "GET /v1/events": { auth: "none" /* 会话或管理流属主在streamAuthz内强制 */, resp: { 200: "v0.4.1/event.schema.json#/$defs/eventsPage" } /* DG110：派发事件类型入流——冻结枚举不改字节，
      按C101版本前缀解析v0.4.1候选副本（+group.dispatch.*两型，其余逐键同值；Old types不变） */, },
  "GET /v1/events/snapshot": { auth: "none", resp: { 200: "v0.4.1/event.schema.json#/$defs/snapshotResponse" } /* 同上：v0.4.1候选副本解析 */, },
  "POST /v1/events/ack": { auth: "session" /* 四步准入：§2.1①②③一致性先于语义422 */,
    req: "event.schema.json#/$defs/ackRequest", resp: { 200: "event.schema.json#/$defs/ackResponse" } },
  "POST /v1/enrollments/revoke": { auth: "revoke" /* C29：注销专用准入序①②③→④，见revokeReceiptSession */,
    req: "enrollment.schema.json#/$defs/selfRevokeRequest", resp: { 200: "enrollment.schema.json#/$defs/revokeReceipt" } },
  "POST /v1/devices/snapshot": { auth: "session" /* §2.1四步；设备归属由会话解析，无org/project参数 */,
    req: "device.schema.json#/$defs/deviceSnapshotRequest",
    resp: { 200: "device.schema.json#/$defs/deviceSnapshotResponse" } },
  "GET /v1/devices": { auth: "admin", resp: { 200: "device.schema.json#/$defs/devicesPage" } },
  "POST /v1/media-sessions": { auth: "admin", /* 媒体r3：授权/票据发放；码流在独立数据面进程，控制API零承载 */
    req: "media.schema.json#/$defs/mediaSessionCreateRequest",
    resp: { 200: "media.schema.json#/$defs/mediaSessionResponse" } },
  "GET /v1/media-sessions/{mediaSessionId}": { auth: "admin", resp: { 200: "media.schema.json#/$defs/mediaSessionStatusResponse" } },
  "POST /v1/media-sessions/{mediaSessionId}/stop": { auth: "admin", resp: { 200: "media.schema.json#/$defs/mediaSessionStatusResponse" } },
  // C98（DG1接线，合同v0.4.0§2/§3已冻结）：组注册/执行投影上传——鉴权=Desktop当前会话（handler内
  // currentSession+owner声明匹配）而非admin Bearer：Desktop是唯一正式组写者，Server只登记投影
  // C100：组端点schema绑定落到接线（7115753"schema绑定仍未接"缺口收编）——req绑定冻结v0.4.0载荷，
  // 畸形wire在Dispatch层即schema 422（模块校验为第二层，非仅靠异常捕获）；resp绑ack封套自证。
  "POST /v1/group-registrations": { auth: "none", groupSession: true /* C101：会话+归属Check前置schema */,
    req: "v0.4.0/group-registration.schema.json#/$defs/registrationRequest",
    resp: { 200: "v0.4.0/group-registration.schema.json#/$defs/registrationAck" } },
  "GET /v1/group-registrations": { auth: "none" /* 同上：本Desktop名下投影读取（只读，非管理面枚举） */ },
  // DG110（Server接线候选）：组派发账本面——主体矩阵未冻结，当前仅"Desktop会话自派"（target==会话属主，
  // Check）；admin/平台主体路径不设置不通=保持拒绝。schema绑定只验封套结构，typed/UTF8字节等完整校验
  // 一律由已过模块 createGroupDispatch/…（dd7a116）执法——属实DG109"真实路由必须调用模块完整校验"。
  "POST /v1/group-dispatches": { auth: "none", groupSession: true /* 准入(会话+归属Check)先于schema */,
    req: "v0.4.1/group-dispatch-request.schema.json#/$defs/dispatchRequest",
    resp: { 200: "v0.4.1/group-dispatch-events.schema.json#/$defs/createAck" } },
  "POST /v1/group-dispatches/cancel": { auth: "none", groupSession: true /* 同上 */,
    req: "v0.4.1/group-dispatch-request.schema.json#/$defs/cancelRequest",
    resp: { 200: "v0.4.1/group-dispatch-events.schema.json#/$defs/cancelAck" } },
  // DG120（授权HTTP接线）：f47430e已审模块的HTTP面——签发/吊销=admin面（真实adminSubject token，
  // role-sum gate在adminSubject内），verify=Desktop会话面（groupSession同名Check；client/requestId之外的
  // 一切绑定字段由服务端从group_dispatch账本权威取值，客户端自报绑定一律拒）。
  "POST /v1/group-grants": { auth: "admin",
    req: "v0.4.1/group-grant.schema.json#/$defs/issueRequest",
    resp: { 200: "v0.4.1/group-grant.schema.json#/$defs/issueAck" } },
  "POST /v1/group-grants/revoke": { auth: "admin",
    req: "v0.4.1/group-grant.schema.json#/$defs/revokeRequest",
    resp: { 200: "v0.4.1/group-grant.schema.json#/$defs/revokeAck" } },
  "POST /v1/group-grants/verify": { auth: "none", groupSession: true /* 会话+归属Check前置schema（C101序） */,
    req: "v0.4.1/group-grant.schema.json#/$defs/verifyRequest",
    resp: { 200: "v0.4.1/group-grant.schema.json#/$defs/verifyVerdict" } },
  "GET /v1/group-dispatches": { auth: "none", /* GET无body：会话准入在handler内currentSession（同queue模式） */
    resp: { 200: "v0.4.1/group-dispatch-events.schema.json#/$defs/pendingResponse" } },
  "POST /v1/group-executions": { auth: "none", groupSession: true /* C101：会话+归属Check前置schema */,
    req: "v0.4.5/group-execution.schema.json#/$defs/executionProjection",
    resp: { 200: "v0.4.0/group-execution.schema.json#/$defs/executionAck" } }, // 目标4：REQ升v0.4.4(+可选steps最小新增)，RESP仍v0.4.0冻结字节零变
  "GET /v1/agent-tasks/queue": { auth: "none" /* GET无body epoch校验；会话准入在handler内currentSession（同/v1/events模式） */,
    resp: { 200: "agent.schema.json#/$defs/agentTaskQueueResponse" } },
  "POST /v1/agent-tasks": { auth: "admin", /* v0.3.0：Super-agent发起——直接工具调用与prompt委托同一合同合同面 */
    req: "agent.schema.json#/$defs/agentTaskCreateRequest",
    resp: { 200: "agent.schema.json#/$defs/agentTaskCreateResponse" } },
  "GET /v1/agent-tasks": { auth: "admin", resp: { 200: "agent.schema.json#/$defs/agentTasksPage" } },
  "GET /v1/agent-tasks/{agentTaskId}": { auth: "admin", resp: { 200: "agent.schema.json#/$defs/agentTaskStatus" } },
  "POST /v1/agent-tasks/{agentTaskId}/cancel": { auth: "admin", resp: { 200: "agent.schema.json#/$defs/agentTaskStatus" } },
  "POST /v1/agent-tasks/{agentTaskId}/progress": { auth: "session", /* Client侧执行进度（结构化状态+事件seq走client流） */
    req: "agent.schema.json#/$defs/agentTaskProgressRequest",
    resp: { 200: "agent.schema.json#/$defs/agentTaskStatus" } },
  "POST /v1/agent-tasks/{agentTaskId}/result": { auth: "session", /* Client执行器最终报告：幂等；迟到结果如实存档不改写终态 */
    req: "agent.schema.json#/$defs/agentTaskResultRequest",
    resp: { 200: "agent.schema.json#/$defs/agentTaskStatus" } },
  "GET /v1/healthz": { auth: "none" },
};

// 媒体r3公共常量（服务端独立数据面有界透传；控制API不含任何码流路径）
const MEDIA_TICKET_TTL_SEC = 120;           // 票据短时单用途：连接窗口
const MEDIA_SESSION_DEFAULT_SEC = 600;      // 缺省会话时长上限
const MEDIA_MAX_BUFFERED_BYTES = 2 * 1024 * 1024; // 背压上限（≈2MiB）
const MEDIA_MAX_QUEUE_MESSAGES = 256;
const MEDIA_SWEEP_MS = 2000;                // 停止/过期/吊销经DB标志传导到数据面的最迟窗口

// v0.3.0 Agent任务面常量（上游dsh-superagent核验8c32a9dc：无远程Client-agent桥——本面为最小自建，
// 状态机薄适配其Ticket/Assignment/Report语义：任务状态独立于Client会话；结果=结构化终态；幂等不重放）
const AGENT_TASK_TIMEOUT_DEF_SEC = 600;     // 缺省任务时限
const AGENT_TASK_MAX_CONCURRENT = 4;        // 同Client并发未终态任务上界（防队列灌爆）
const AGENT_TERMINAL = new Set(["succeeded", "failed", "cancelled", "expired"]);

// Code security: 票据哈希入库，token明文只出现一次（响应体/事件data），不落日志
function createMediaTickets(db, sessRow, at) {
  const tickets = {};
  for (const role of (sessRow.roles || ["viewer", "client"])) {
    const token = newToken();
    const expires = at + MEDIA_TICKET_TTL_SEC * 1000;
    run(db, "INSERT INTO media_ticket(ticket_ulid, media_session_rowid, role, token_hash, created_at_ms, expires_at_ms) VALUES (?,?,?,?,?,?)",
        ulid(at), sessRow.id, role, sha256b64(token), at, expires);
    tickets[role] = { role, token, expiresAt: toRfc3339(expires), oneTimeUse: true };
  }
  return tickets;
}

// B7：观看主体归属校验——带主体标记的会话仅允许创建主体操作；请求头缺失时视为部署层/admin权威调用放行
// （"创建者或明确授权角色"）；头在场则必须匹配，跨主体一律403且无副作用。
function mediaViewerCheck(m, headers) {
  if (!m.source_session_ulid && headers?.["x-media-viewer-subject"]) throw new ApiError("AUTH_SCOPE_DENIED","capture source is not a viewer subscription");
  if (!m.viewer_subject_ref) return; // admin-created subscription
  const hdr = typeof headers?.["x-media-viewer-subject"] === "string" ? headers["x-media-viewer-subject"] : null;
  if (hdr === null) return; // 无头=核心/部署层信任调用（admin Bearer已在准入①）；httpview绝不无证注入
  if (hdr !== m.viewer_subject_ref) throw new ApiError("AUTH_SCOPE_DENIED", "viewer subject mismatch");
}

// admin面媒体scope准入：org/project保鲜 + client/device同scope存在 + 设备行online
// Scope and device admission; up to sixteen independent viewer subscriptions per device.
function mediaAdmission(db, subj, q) {
  const org = one(db, "SELECT id FROM org WHERE org_ulid = ?", q.orgId);
  const proj = org && one(db, "SELECT id FROM project WHERE org_rowid = ? AND project_ulid = ?", org.id, q.projectId);
  if (!org || !proj) throw new ApiError("AUTH_SCOPE_DENIED", "target scope not granted");
  checkAdminScope(subj, db, org.id, proj.id);
  const c = one(db, "SELECT id, client_ulid, last_epoch, status, valid_until_ms FROM client WHERE client_ulid = ? AND org_rowid = ? AND project_rowid = ?", q.clientId, org.id, proj.id);
  if (!c) throw new ApiError("MEDIA_SESSION_INVALID", "client not in scope", {});
  if (c.status === "revoked") throw new ApiError("MEDIA_SESSION_INVALID", "client revoked", {});
  if (c.valid_until_ms <= Date.now()) throw new ApiError("MEDIA_SESSION_INVALID", "client authorization expired", {});
  const d = one(db, "SELECT id, device_ulid, status FROM device WHERE device_ulid = ? AND client_rowid = ? AND org_rowid = ? AND project_rowid = ?", q.deviceId, c.id, org.id, proj.id);
  if (!d) throw new ApiError("MEDIA_SESSION_INVALID", "device not in scope for client", {});
  if (d.status !== "online") throw new ApiError("MEDIA_SESSION_INVALID", "device not online in latest snapshot", { deviceId: q.deviceId, status: d.status });
  const active = one(db, "SELECT count(*) c FROM media_session WHERE device_rowid = ? AND source_session_ulid IS NOT NULL AND status IN ('authorized','live') AND expires_at_ms > ?", d.id, Date.now());
  if(active.c>=16)throw new ApiError("MEDIA_SESSION_INVALID","device viewer capacity reached",{});
  return { org, proj, client: c, device: d };
}

// v0.2.0设备快照全量安装（事务内被snapshot路由调用，不在路由表）。响应含安装后即时三态——权威落库非事件推导。
// C30#1：deviceId↔discoveryFingerprint绑定在本Client名下首建即不可变，改绑请求→409 DEVICE_IDENTITY_CONFLICT。
function installSnapshot(db, sess, body, devices, contentSha, revision, at) {
  const existing = many(db, "SELECT id, device_ulid, discovery_fingerprint FROM device WHERE client_rowid = ?", sess.client_rowid);
  const byId = new Map(); const byFp = new Map();
  for (const r of existing) { byId.set(r.device_ulid, r); byFp.set(r.discovery_fingerprint, r); }
  const eventList = [];
  const present = new Set();
  let devicesUpserted = 0;
  for (const d of devices) {
    present.add(d.deviceId);
    const row = byId.get(d.deviceId) ?? byFp.get(d.discoveryFingerprint) ?? null;
    if (row) {
      if (row.device_ulid !== d.deviceId || row.discovery_fingerprint !== d.discoveryFingerprint)
        throw new ApiError("DEVICE_IDENTITY_CONFLICT", "deviceId/fingerprint binding is immutable per client");
      run(db, "UPDATE device SET kind=?, name=COALESCE(?, name), os=?, adb_serial=COALESCE(?, adb_serial), last_seen_ms=?, last_snapshot_ms=?, last_snapshot_id=?, last_snapshot_revision=?, status='online' WHERE id=?",
          d.kind, d.deviceName ?? null, d.os, d.adbSerial ?? null, at, at, body.snapshotId, revision, row.id);
    } else {
      run(db, "INSERT INTO device(device_ulid, org_rowid, project_rowid, client_rowid, device_key, kind, name, discovery_fingerprint, os, adb_serial, first_seen_ms, last_seen_ms, last_snapshot_ms, last_snapshot_id, last_snapshot_revision, status) VALUES (?,?,?,?,?,?,?, ?,?,?, ?,?,?,?,?,'online')",
          d.deviceId, sess.org_rowid, sess.project_rowid, sess.client_rowid, d.discoveryFingerprint, d.kind, d.deviceName ?? null, d.discoveryFingerprint, d.os, d.adbSerial ?? null, at, at, at, body.snapshotId, revision);
      eventList.push({ type: "device.connected", data: { deviceId: d.deviceId } });
    }
    devicesUpserted++;
  }
  let devicesRemoved = 0;
  for (const r of existing) {
    if (!present.has(r.device_ulid)) {
      run(db, "UPDATE device SET status='offline', last_snapshot_ms=?, last_snapshot_id=?, last_snapshot_revision=? WHERE id=?", at, body.snapshotId, revision, r.id);
      eventList.push({ type: "device.offline", data: { deviceId: r.device_ulid } }); // 行保留——离线不删
      devicesRemoved++;
    }
  }
  writeSnapshotHead(db, sess, body, contentSha, revision, at);
  const statusByDevice = {};
  for (const r of many(db, "SELECT device_ulid, status FROM device WHERE client_rowid = ?", sess.client_rowid)) statusByDevice[r.device_ulid] = r.status;
  return { out: { status: 200, body: { snapshotId: body.snapshotId, revision, installed: true, devicesUpserted, devicesRemoved, statusByDevice } }, eventList };
}

// 失败快照（discoveryStatus=failed）只推水位、不装清单：revision=接收水位版本，自1起，与ok同计（满足迁移CHECK revision>=1）
function advanceHeadOnly(db, sess, body, payloadSha, revision, at) {
  writeSnapshotHead(db, sess, body, payloadSha, revision, at);
}
function failedOut(body, revision) {
  return { status: 200, body: { snapshotId: body.snapshotId, revision, installed: false, dropped: false, duplicate: false, reason: "discovery-failed" } };
}
function writeSnapshotHead(db, sess, body, contentSha, revision, at) {
  run(db, "INSERT INTO client_snapshot_head(client_rowid, epoch, seq, snapshot_id, content_sha, revision, updated_at_ms) VALUES (?,?,?,?,?,?,?) ON CONFLICT(client_rowid) DO UPDATE SET epoch=excluded.epoch, seq=excluded.seq, snapshot_id=excluded.snapshot_id, content_sha=excluded.content_sha, revision=excluded.revision, updated_at_ms=excluded.updated_at_ms",
      sess.client_rowid, body.epoch, body.seq, body.snapshotId, contentSha, revision, at);
}

export function createApp({ db, bootstrap = false, contextProvider } = {}) {
  const request = { db };
  const routes = [];
  const route = (method, pattern, handler) => {
    const names = [];
    const rx = new RegExp("^" + pattern.replace(/\{(\w+)\}/g, (_, n) => { names.push(n); return "([^/]+)"; }) + "$");
    routes.push({ method, pattern, rx, names, handler, opt: ROUTE_OPTS[`${method} ${pattern}`] ?? {} }); // W25 gate：pattern随路由保留（白名单裁决输入）
  };

  registerLabRoutes(route,{db,contextProvider,
    adminScope:ctx=>{const subject=ctx.admin(),input=ctx.body?.orgId?ctx.body:ctx.q;
      const org=one(db,'SELECT id,org_ulid FROM org WHERE org_ulid=?',input.orgId),project=one(db,'SELECT id,project_ulid,org_rowid FROM project WHERE project_ulid=?',input.projectId);
      if(!org||!project||project.org_rowid!==org.id)throw new ApiError('AUTH_SCOPE_DENIED','invalid lab project');
      checkAdminScope(subject,db,org.id,project.id);return {orgId:org.org_ulid,projectId:project.project_ulid};
    },
    clientScope:ctx=>{const session=currentSession(db,ctx.bearer);if(ctx.body?.sessionId)assertBodySession(session,ctx.body);
      const org=one(db,'SELECT org_ulid FROM org WHERE id=?',session.org_rowid),project=one(db,'SELECT project_ulid FROM project WHERE id=?',session.project_rowid);
      return {scope:{orgId:org.org_ulid,projectId:project.project_ulid},clientId:session.client_ulid};
    }
  });

  route("GET", "/v1/healthz", () => ({ status: 200, body: { status: "ok", serverTime: toRfc3339(nowMs()), contractVersion: CONTRACT_VERSION, dbMigrationVersion: currentMigrationVersion(db), roleGate: true } })); // W25 gate标记（healthz.schema同型C93修订：可选boolean白名单收编）

  // --- enrollment (anonymous) ---
  route("POST", "/v1/enrollments", ({ body }) => {
    requireFields(body, ["installationId", "publicKeyPem", "clientVersion", "capabilities", "deviceScope", "scopeRequested"]);
    if (!ULID_RE.test(body.installationId)) throw vErr("installationId must be a ULID");
    const fp = validPublicKey(body.publicKeyPem);
    const { org, proj } = orgProjectByKey(db, body.scopeRequested.orgKey, body.scopeRequested.projectKey);
    const at = nowMs();
    const active = one(db, "SELECT * FROM enrollment WHERE installation_ulid = ? AND status IN ('pending','approved') ORDER BY status DESC, id DESC LIMIT 1", body.installationId);
    if (active) {
      const sameKey = active.fingerprint_server === fp;
      if (!sameKey) throw new ApiError("ENROLL_KEY_ROTATION_CONFLICT", "active enrollment exists with a different key; revoke first");
      // 同钥幂等重申（C29）：auto下直接approved时回approveResponse同形（幂等同形）；回退模式仍pending腔调
      if (AUTO_APPROVE && active.status === "approved") {
        const c = one(db, "SELECT client_ulid, granted_at_ms FROM client WHERE installation_ulid = ? AND status='approved' ORDER BY id DESC LIMIT 1", active.installation_ulid);
        return { status: 200, body: { enrollmentId: active.enrollment_ulid, clientId: c ? c.client_ulid : null,
          status: "approved", grantedAt: toRfc3339(c ? c.granted_at_ms : active.requested_at_ms),
          validUntil: toRfc3339((c ? c.granted_at_ms : active.requested_at_ms) + MAX_RENEW_WINDOW_MS), leaseDefaultSec: DEFAULT_LEASE_SEC } };
      }
      return { status: 200, body: { enrollmentId: active.enrollment_ulid, status: active.status, createdAt: toRfc3339(active.requested_at_ms), message: "idempotent re-submit" } };
    }
    const eid = ulid(at);
    run(db, "INSERT INTO enrollment(enrollment_ulid, org_rowid, project_rowid, installation_ulid, public_key_pem, fingerprint_server, status, requested_at_ms, requested_version, device_scope_json, network_profile_json, capabilities_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        eid, org.id, proj.id, body.installationId, body.publicKeyPem, fp, "pending", at, body.clientVersion,
        JSON.stringify(body.deviceScope), JSON.stringify(body.networkProfile ?? {}), JSON.stringify(body.capabilities));
    const row = one(db, "SELECT * FROM enrollment WHERE enrollment_ulid = ?", eid);
    // C29用户裁定：注册直达成功——AUTO_APPROVE时新申请直接落client返回approved语义（不再人工审批）。
    // 兼容存量：只作用于本次新建申请；启动前已有pending保持原状由受控流程衔接，不批量处理。
    if (AUTO_APPROVE) return approveEnrollment(db, row, null); // system主体直接批准，审计记录分明
    return { status: 201, body: { enrollmentId: eid, status: "pending", createdAt: toRfc3339(row.requested_at_ms), message: "awaiting admin decision" } };
  });

  // --- enrollment admin ---
  route("GET", "/v1/enrollments", (ctx) => { const subj = ctx.admin(); const q = ctx.q;
    requireFields(q, ["orgId", "projectId"]);
    if (!ULID_RE.test(q.orgId) || !ULID_RE.test(q.projectId)) throw vErr("orgId/projectId must be ULIDs");
    const org = one(db, "SELECT id FROM org WHERE org_ulid = ?", q.orgId);
    const proj = org && one(db, "SELECT id FROM project WHERE org_rowid = ? AND project_ulid = ?", org.id, q.projectId);
    if (!org || !proj) throw new ApiError("AUTH_SCOPE_DENIED", "target scope not granted"); // 不泄存在性
    checkAdminScope(subj, db, org.id, proj.id);
    const page = q.page ? safeInt(Number(q.page), "page", { min: 1 }) : 1;
    const pageSize = q.pageSize ? safeInt(Number(q.pageSize), "pageSize", { min: 1, max: 200 }) : 20;
    const where = ["org_rowid = ?", "project_rowid = ?"]; const args = [org.id, proj.id];
    if (q.status) { where.push("status = ?"); args.push(q.status); }
    const rows = many(db, "SELECT * FROM enrollment WHERE " + where.join(" AND ") + " ORDER BY requested_at_ms DESC, id DESC LIMIT ? OFFSET ?", ...args, pageSize, (page - 1) * pageSize);
    const count = one(db, "SELECT count(*) AS c FROM enrollment WHERE " + where.join(" AND "), ...args).c;
    return { status: 200, body: { items: rows.map((r) => enrollmentRowOut(db, r)), page, pageSize, nextPage: page * pageSize < count ? page + 1 : null } };
  });

  route("GET", "/v1/enrollments/{enrollmentId}", (ctx) => { const subj = ctx.admin(); const params = ctx.params;
    const r = one(db, "SELECT * FROM enrollment WHERE enrollment_ulid = ?", params.enrollmentId);
    checkAdminScope(subj, db, r ? r.org_rowid : -1, r ? r.project_rowid : -1);
    if (!r) throw new ApiError("ENROLL_NOT_FOUND", "enrollment not found in granted scope");
    const net = JSON.parse(r.network_profile_json ?? "{}");
    // C8 R1修复：enrollmentDetail.additionalProperties=false——decidedAt只存在于audit内；null语义字段省略而非null
    const row = enrollmentRowOut(db, r);
    delete row.decidedAt;
    const audit = {};
    audit.decidedAt = sqlToUtc(r.decided_at_ms);
    if (r.decided_by_admin) {
      const lbl = one(db, "SELECT label FROM admin_subject WHERE id = ?", r.decided_by_admin)?.label;
      if (lbl) audit.decidedByLabel = lbl;
    }
    if (typeof r.reason === "string" && r.reason.length > 0) audit.reason = r.reason;
    const client = r.client_rowid ? one(db, "SELECT * FROM client WHERE id = ?", r.client_rowid) : null;
    return { status: 200, body: { ...row, networkProfile: net, audit, client: client ? { clientId: client.client_ulid, status: client.status, validUntil: toRfc3339(client.valid_until_ms) } : {} } };
  });

  // C29共用批准事务：admin批准与AUTO_APPROVE直达共用同一替代批准/事件/审计语义；
  // decidedBy=null表示系统直达批准（C29用户裁定），审计可区分人工与自动。
  route("POST", "/v1/enrollments/{enrollmentId}/decision", (ctx) => { const subj = ctx.admin(); const params = ctx.params; const body = ctx.body;
    requireFields(body, ["action"]);
    const eid = params.enrollmentId;
    const at = nowMs();
    const row = one(db, "SELECT * FROM enrollment WHERE enrollment_ulid = ?", eid);
    checkAdminScope(subj, db, row ? row.org_rowid : -1, row ? row.project_rowid : -1);
    if (!row) throw new ApiError("ENROLL_NOT_FOUND", "enrollment not found in granted scope");
    if (row.status !== "pending") throw new ApiError("ENROLL_ALREADY_DECIDED", "decision already made");
    if (body.action === "approve") {
      return approveEnrollment(db, row, subj.id, body.reason ?? null);
    } else if (body.action === "reject") {
      const changed = run(db, "UPDATE enrollment SET status='rejected', decided_at_ms=?, decided_by_admin=?, reason=? WHERE id=? AND status='pending'", at, subj.id, body.reason ?? null, row.id).changes;
      if (changed !== 1) throw new ApiError("ENROLL_ALREADY_DECIDED", "decision already made");
      return { status: 200, body: { enrollmentId: eid, status: "rejected", decidedAt: toRfc3339(at) } };
    }
    throw vErr("action must be approve|reject");
  });

  // --- client admin ---
  route("POST", "/v1/clients/{clientId}/revoke", (ctx) => { const subj = ctx.admin(); const params = ctx.params; const body = ctx.body;
    const c = resolveClient(db, params.clientId, subj);
    if (c.status !== "approved") throw new ApiError("ENROLL_ALREADY_DECIDED", "client not in approved state");
    const at = nowMs();
    db.exec("BEGIN");
    try {
      run(db, "UPDATE client SET status='revoked', revoked_at_ms=? WHERE id=?", at, c.id); // 管理吊销：revoked_by_session保持NULL——无自注销会话可关联
      run(db, "UPDATE session SET revoked_at_ms=? WHERE client_rowid=?", at, c.id);
      run(db, "UPDATE challenge SET consumed_at_ms=? WHERE subject_key=? AND subject_type='client' AND consumed_at_ms IS NULL", at, c.client_ulid);
      // C8 R6：吊销同步终结enrollment——该身份自此走"须新enrollment"路径，recover不再回到旧approved
      run(db, "UPDATE enrollment SET status='revoked', decided_at_ms=COALESCE(decided_at_ms,?), reason=? WHERE client_rowid=? AND status='approved'", at, body?.reason ?? null, c.id);
      emit(db, "client:" + c.client_ulid, 1, "client.revoked", { reason: body?.reason ?? null }, at);
      db.exec("COMMIT");
      return { status: 200, body: { clientId: c.client_ulid, status: "revoked", revokedAt: toRfc3339(at) } };
    } catch (e) { db.exec("ROLLBACK"); throw e; }
  });

  route("POST", "/v1/clients/{clientId}/renew", (ctx) => { const subj = ctx.admin(); const params = ctx.params; const body = ctx.body;
    const c = resolveClient(db, params.clientId, subj);
    if (c.status !== "approved") throw new ApiError("ENROLL_ALREADY_DECIDED", "client not in approved state");
    requireFields(body, ["validUntil"]);
    const until = fromRfc3339(body.validUntil);
    if (until === null) throw vErr("validUntil must be RFC3339 UTC");
    const at = nowMs();
    if (until <= at || until > at + MAX_RENEW_WINDOW_MS) throw vErr("validUntil out of window (max +720h)");
    run(db, "UPDATE client SET valid_until_ms=? WHERE id=? AND status='approved'", until, c.id);
    emit(db, "client:" + c.client_ulid, 1, "client.renewed", { validUntil: body.validUntil }, at);
    return { status: 200, body: { clientId: c.client_ulid, status: "approved", validUntil: toRfc3339(until) } };
  });

  // --- recover flow (anonymous) ---
  route("POST", "/v1/enrollments/recover/challenge", ({ body }) => {
    requireFields(body, ["installationId"]);
    if (!ULID_RE.test(body.installationId)) throw vErr("installationId must be a ULID");
    return { status: 200, body: challengeCreate(db, body.installationId, "installation", "enrollment.recover") };
  });

  route("POST", "/v1/enrollments/recover", ({ body }) => {
    requireFields(body, ["installationId", "challenge", "signature", "publicKeyPem"]);
    const at = nowMs();
    // C8 R6：approved必须对应仍approved的client（吊销时enrollment已同步revoked；双保险join）
    const row = one(db, `SELECT e.* FROM enrollment e
        LEFT JOIN client c ON c.id = e.client_rowid
        WHERE e.installation_ulid = ? AND (e.status = 'pending' OR (e.status = 'approved' AND c.status = 'approved'))
        ORDER BY e.status DESC, e.id DESC LIMIT 1`, body.installationId);
    // 消费优先于结果（防试钥枚举）：任何终态尝试都置consumed
    let ch; try { ch = challengeConsume(db, body.challenge, body.installationId, "enrollment.recover"); } catch (e) {
      if (e instanceof ApiError && e.code === "AUTH_CHALLENGE_EXPIRED") throw e;
      throw e;
    }
    if (!row) {
      // C29补遗（AUTO_APPROVE模式）：持钥终态确认——active缺位时按同installation最新终态行校验，
      // 同钥+验签→回revoked收据；异钥/无行保持ENROLL_NOT_FOUND（不泄露他人存在性）。
      // SOLOPI_AUTO_APPROVE=0回退旧合同（C8 R6：吊销后recover一律404），与旧套件冻结行为一致。
      if (!AUTO_APPROVE) throw new ApiError("ENROLL_NOT_FOUND", "no active enrollment for installation");
      const term = one(db, "SELECT * FROM enrollment WHERE installation_ulid = ? ORDER BY id DESC LIMIT 1", body.installationId);
      if (term && (term.status === "revoked" || term.status === "expired")
          && term.fingerprint_server === publicKeyFingerprint(body.publicKeyPem)
          && verifyChallenge(term.public_key_pem, "enrollment.recover", body.challenge, body.signature)) {
        const tc = term.client_rowid ? one(db, "SELECT client_ulid, revoked_at_ms FROM client WHERE id = ?", term.client_rowid) : null;
        return { status: 200, body: { enrollmentId: term.enrollment_ulid, clientId: tc ? tc.client_ulid : null,
          status: term.status, createdAt: toRfc3339(term.requested_at_ms),
          revokedAt: tc && tc.revoked_at_ms ? toRfc3339(tc.revoked_at_ms) : null } };
      }
      throw new ApiError("ENROLL_NOT_FOUND", "no active enrollment for installation");
    }
    const sameKey = row.fingerprint_server === publicKeyFingerprint(body.publicKeyPem);
    if (!sameKey) throw new ApiError("ENROLL_RECOVERY_KEY_MISMATCH", "declared key does not match enrollment"); // §1.5：公钥不匹配优先422
    if (!verifyChallenge(row.public_key_pem, "enrollment.recover", body.challenge, body.signature)) throw new ApiError("AUTH_TOKEN_INVALID", "invalid signature");
    const c = row.status === "approved" && row.client_rowid ? one(db, "SELECT client_ulid FROM client WHERE id = ?", row.client_rowid) : null;
    return { status: 200, body: { enrollmentId: row.enrollment_ulid, clientId: c ? c.client_ulid : null, status: row.status, createdAt: toRfc3339(row.requested_at_ms) } };
  });

  // --- session flow (anonymous) ---
  route("GET", "/v1/sessions/challenge", ({ q }) => {
    if (!q.clientId || !ULID_RE.test(q.clientId)) throw vErr("clientId must be a ULID");
    const c = one(db, "SELECT client_ulid FROM client WHERE client_ulid = ?", q.clientId);
    if (!c) throw new ApiError("CLIENT_NOT_FOUND", "client not found"); // 匿名挑战签发不泄scope
    return { status: 200, body: challengeCreate(db, q.clientId, "client", "session.create") };
  });

  route("POST", "/v1/sessions", ({ body }) => {
    requireFields(body, ["clientId", "installationId", "clientVersion", "capabilities", "challenge", "signature"]);
    const at = nowMs();
    const c = one(db, "SELECT * FROM client WHERE client_ulid = ?", body.clientId);
    challengeConsume(db, body.challenge, body.clientId, "session.create"); // 先消费防重放
    if (!c || c.installation_ulid !== body.installationId) throw new ApiError("AUTH_TOKEN_INVALID", "client identity mismatch");
    if (c.status !== "approved") throw new ApiError("AUTH_REVOKED", "client revoked");
    if (c.valid_until_ms <= at) throw new ApiError("AUTH_REVOKED", "client expired");
    if (!verifyChallenge(c.public_key_pem, "session.create", body.challenge, body.signature)) throw new ApiError("AUTH_TOKEN_INVALID", "invalid signature");
    const token = newToken();
    const lease = at + DEFAULT_LEASE_SEC * 1000;
    const epoch = c.last_epoch + 1;
    // C55修复：身份/签名/会话请求校验已全部通过——同一事务内按本合法请求刷新Client能力（升级与降级同语义），
    // 使读模型/媒体准入返回当前会话能力而非首次注册时的陈旧值；非法签名/吊销/过期/身份不配已在上行被拒，不到本处。
    const capsJson = JSON.stringify(typeof body.capabilities === "object" && body.capabilities !== null ? body.capabilities : { commands: false, media: false });
    db.exec("BEGIN");
    try {
      run(db, "UPDATE client SET capabilities_json = ?, client_version = ? WHERE id = ?", capsJson, String(body.clientVersion ?? c.client_version ?? ""), c.id);
      run(db, "INSERT INTO session(client_rowid, epoch, token_hash, heartbeat_interval_sec, created_at_ms, lease_expires_at_ms) VALUES (?,?,?,?,?,?)",
          c.id, epoch, sha256b64(token), HEARTBEAT_INTERVAL_SEC, at, lease); // DDL I5: +1严格、旧会话即作废
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
    return { status: 201, body: { sessionId: token, epoch, leaseExpiresAt: toRfc3339(lease), heartbeatIntervalSec: HEARTBEAT_INTERVAL_SEC, maxLeaseSec: DEFAULT_LEASE_SEC, contractVersion: CONTRACT_VERSION } };
  });

  // --- heartbeat (client session) ---
  route("POST", "/v1/heartbeat", ({ body, bearer }) => {
    requireFields(body, ["epoch", "sessionId", "lastEventSeqAck", "occupancy", "status"]);
    const sess = currentSession(db, bearer);
    assertBodySession(sess, body);
    safeInt(body.lastEventSeqAck, "lastEventSeqAck");
    const occ = body.occupancy ?? {};
    safeInt(occ.localUiTasks ?? 0, "occupancy.localUiTasks", { min: 0, max: 100000 }); // 越界→422在入账前拒绝
    safeInt(occ.cliTasks ?? 0, "occupancy.cliTasks", { min: 0, max: 100000 });
    const at = nowMs();
    const lease = at + DEFAULT_LEASE_SEC * 1000;
    run(db, "UPDATE session SET lease_expires_at_ms = ?, last_heartbeat_ms = ? WHERE id = ?", lease, at, sess.id);
    run(db, "INSERT INTO heartbeat_log(session_rowid, at_ms, epoch, local_ui_tasks, cli_tasks, last_event_seq_ack) VALUES (?,?,?,?,?,?)",
        sess.id, at, sess.epoch, occ.localUiTasks ?? 0, occ.cliTasks ?? 0, body.lastEventSeqAck);
    const devHead = one(db, "SELECT epoch, seq FROM client_snapshot_head WHERE client_rowid = ?", sess.client_rowid);
    return { status: 200, body: { epoch: sess.epoch, leaseExpiresAt: toRfc3339(lease), serverTime: toRfc3339(at), configVersion: "stage-a", pendingCommandsCount: 0,
      deviceSnapshot: devHead ? { epoch: devHead.epoch, seq: devHead.seq } : { epoch: sess.epoch, seq: 0 } } }; // v0.2.0水位：Client下一snapshot.seq=seq+1
  });

  // --- v0.2.0设备快照（合同§1冻结版）：会话准入（dispatch session模式），归属=会话解析，无org/project参数 ---
  // C30闭合：顺序=epoch+seq（时钟不参与）；幂等重放/迟到丢弃/hear水位裁决；发现失败不抹清单；identity绑定不可改。
  route("POST", "/v1/devices/snapshot", ({ body, sess }) => {
    requireFields(body, ["sessionId", "epoch", "seq", "snapshotId", "takenAt", "discoveryStatus", "devices"]);
    const at = nowMs();
    safeInt(body.seq, "seq", { min: 1 });
    const devices = body.devices ?? [];
    const takenMs = fromRfc3339(body.takenAt);
    if (takenMs === null) throw vErr("takenAt must be RFC3339 UTC");
    void takenMs; // C30复核修订：takenAt仅信息校验，不落权威时间——保鲜/陈旧一律用服务端接收时间
    // C30#3语义拒绝（不依赖uniqueItems）：同快照内deviceId唯一、fingerprint唯一
    const byId = new Map(); const byFp = new Map();
    for (const d of devices) {
      if (!ULID_RE.test(d.deviceId ?? "")) throw vErr("deviceId must be a ULID");
      if (byId.has(d.deviceId)) throw vErr("duplicate deviceId in snapshot");
      if (byFp.has(d.discoveryFingerprint)) throw vErr("duplicate discoveryFingerprint in snapshot");
      byId.set(d.deviceId, d); byFp.set(d.discoveryFingerprint, d);
    }
    // Code security: 幂等键=完整语义载荷摘要（discoveryStatus+devices）——failed与ok-空集不同摘要，避免重放混同
    const payloadSha = sha256b64(JSON.stringify({ discoveryStatus: body.discoveryStatus, devices }));
    let out; let eventList = [];
    // Code security: TOCTOU——head裁决+全量安装+行写入同一独占事务，水位不回退
    // C30复核修订：成功/失败快照共用同一顺序/幂等/摘要裁决；failed只在安装分支分叉，不再先于顺序判断
    db.exec("BEGIN IMMEDIATE");
    try {
      const head = one(db, "SELECT * FROM client_snapshot_head WHERE client_rowid = ?", sess.client_rowid);
      const failed = body.discoveryStatus === "failed";
      if (!head || head.epoch !== body.epoch) {
        // 本epoch首个被接纳快照：seq必须为1（revision=接收水位版本，自1起，ok与failed同计——满足0004迁移revision>=1约束）
        if (body.seq !== 1) throw new ApiError("SNAPSHOT_SEQ_GAP", "first snapshot of epoch must use seq=1", { expectedSeq: 1 });
        const rev = (head ? head.revision : 0) + 1; // 接收水位版本跨epoch连续，仍满足revision>=1
        if (failed) { advanceHeadOnly(db, sess, body, payloadSha, rev, at); out = failedOut(body, rev); }
        else { const r = installSnapshot(db, sess, body, devices, payloadSha, rev, at); out = r.out; eventList = r.eventList; }
      } else if (body.seq < head.seq) {
        out = { status: 200, body: { snapshotId: body.snapshotId, revision: head.revision, installed: false, dropped: true } }; // 迟到全量/迟到failed同判：丢弃不覆盖
      } else if (body.seq === head.seq) {
        if (body.snapshotId === head.snapshot_id && payloadSha === head.content_sha) {
          // 幂等重放统一：ok与failed同请求重发均命中（含首个failed重试），不触发GAP
          out = failed && head.content_sha === payloadSha ? { status: 200, body: { snapshotId: body.snapshotId, revision: head.revision, installed: false, dropped: false, duplicate: true, reason: "discovery-failed" } }
            : { status: 200, body: { snapshotId: body.snapshotId, revision: head.revision, installed: false, duplicate: true } };
        } else throw new ApiError("SNAPSHOT_CONFLICT", "same seq with different snapshotId/content", { headSeq: head.seq });
      } else if (body.seq > head.seq + 1) {
        throw new ApiError("SNAPSHOT_SEQ_GAP", "seq skipped; resync from heartbeat deviceSnapshot watermark", { expectedSeq: head.seq + 1 });
      } else if (failed) {
        // 发现失败：不安装清单（不得空全量抹除），只推水位——其后旧序号在途快照无法覆盖
        advanceHeadOnly(db, sess, body, payloadSha, head.revision + 1, at);
        out = failedOut(body, head.revision + 1);
      } else {
        const r = installSnapshot(db, sess, body, devices, payloadSha, head.revision + 1, at);
        out = r.out; eventList = r.eventList;
      }
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
    // 事件=页面刷新信号（合同§1.3）：COMMIT后发，不进权威事务；失败不破坏快照权威
    for (const e of eventList) { try { emit(db, "client:" + sess.client_ulid, sess.epoch, e.type, e.data, at); } catch { /* 刷新信号非权威 */ } }
    return out;
  });

  // --- v0.2.0设备列表（admin固定scope查询；三态唯一权威派生，响应无online冗余/无指纹——RO面最小字段）---
  // C30复核修订：状态/过滤/count共用同一判据——Client当前会话租约 + 服务端接收时间，不信客户端takenAt保鲜
  route("GET", "/v1/devices", (ctx) => { const subj = ctx.admin(); const q = ctx.q;
    requireFields(q, ["orgId", "projectId"]);
    const org = one(db, "SELECT id FROM org WHERE org_ulid = ?", q.orgId);
    const proj = org && one(db, "SELECT id FROM project WHERE org_rowid = ? AND project_ulid = ?", org.id, q.projectId);
    if (!org || !proj) throw new ApiError("AUTH_SCOPE_DENIED", "target scope not granted");
    checkAdminScope(subj, db, org.id, proj.id);
    const page = q.page ? safeInt(Number(q.page), "page", { min: 1 }) : 1;
    const pageSize = q.pageSize ? safeInt(Number(q.pageSize), "pageSize", { min: 1, max: 200 }) : 20;
    // 可选clientId过滤（合同增量）：ULID校验后下推c.client_ulid，RO面不开放该参数
    let where = ["d.org_rowid = ?", "d.project_rowid = ?"]; const args = [org.id, proj.id];
    if (q.clientId !== undefined) { if (!ULID_RE.test(q.clientId)) throw vErr("clientId must be a ULID"); where.push("c.client_ulid = ?"); args.push(q.clientId); }
    const now = nowMs();
    const staleEdge = now - 5 * HEARTBEAT_INTERVAL_SEC * 1000; // last_snapshot_ms=服务端接收时间
    // 三态唯一判据（state/过滤/count共用；跨行一致因同一now；C30复核r2：与currentSession心跳准入同源）：
    //   clientAdmitted = Client未吊销 ∧ 授权有效期未过（c.status<>'revoked' AND c.valid_until_ms>now）
    //   leaseActive = EXISTS(当前epoch会话未吊销且租约未到期)
    //   admitted  = clientAdmitted ∧ leaseActive —— 心跳/快照会话准入同面；授权过期或吊销即不再online保鲜
    //   online  = 行online ∧ admitted ∧ 接收龄≤窗
    //   stale   = 行online ∧ admitted ∧ 接收龄>窗
    //   offline = 行offline ∨ (行online ∧ ¬admitted)
    const CLIENT_OK = "(c.status <> 'revoked' AND c.valid_until_ms > ?)";
    const LEASE_OK = "EXISTS (SELECT 1 FROM session se WHERE se.client_rowid = d.client_rowid AND se.epoch = c.last_epoch AND se.revoked_at_ms IS NULL AND se.lease_expires_at_ms > ?)";
    if (q.status) {
      if (!["online","stale","offline"].includes(q.status)) throw vErr("invalid status filter");
      if (q.status === "online") { where.push("d.status='online' AND " + CLIENT_OK + " AND " + LEASE_OK + " AND d.last_snapshot_ms > ?"); args.push(now, now, staleEdge); }
      else if (q.status === "stale") { where.push("d.status='online' AND " + CLIENT_OK + " AND " + LEASE_OK + " AND d.last_snapshot_ms <= ?"); args.push(now, now, staleEdge); }
      else { where.push("(d.status='offline' OR (d.status='online' AND NOT (" + CLIENT_OK + " AND " + LEASE_OK + ")))"); args.push(now, now); }
    }
    // 展示层派生用同一判据的行级标量子查询（当前epoch会话租约到期时刻）
    const LEASE_EXP = "(SELECT se.lease_expires_at_ms FROM session se WHERE se.client_rowid = d.client_rowid AND se.epoch = c.last_epoch AND se.revoked_at_ms IS NULL ORDER BY se.id DESC LIMIT 1)";
    const rows = many(db, "SELECT d.*, c.client_ulid, c.status AS client_status, c.valid_until_ms AS client_valid_until, " + LEASE_EXP + " AS lease_expires FROM device d JOIN client c ON c.id=d.client_rowid WHERE " + where.join(" AND ") + " ORDER BY d.last_snapshot_ms DESC, d.id DESC LIMIT ? OFFSET ?", ...args, pageSize, (page-1)*pageSize);
    const count = one(db, "SELECT count(*) AS c FROM device d JOIN client c ON c.id=d.client_rowid WHERE " + where.join(" AND "), ...args).c;
    const items = rows.map(d => {
      let status = d.status; // 行基态（离线保留行）
      const active = d.lease_expires !== null && d.lease_expires > now
        && d.client_status !== "revoked" && d.client_valid_until > now; // 与过滤SQL同一判据（Client准入+租约）
      if (status === "online") { if (!active) status = "offline"; else if (d.last_snapshot_ms <= staleEdge) status = "stale"; } // 唯一权威派生，页面不得自行推导
      return { orgId: q.orgId, projectId: q.projectId, clientId: d.client_ulid,
        deviceId: d.device_ulid, deviceName: d.name ?? null, kind: d.kind, status,
        lastSeenAt: d.last_seen_ms ? toRfc3339(d.last_seen_ms) : null,
        lastSnapshotAt: toRfc3339(d.last_snapshot_ms),
        lastSnapshotId: d.last_snapshot_id, discoveredAt: toRfc3339(d.first_seen_ms) };
    });
    return { status: 200, body: { items, page, pageSize, nextPage: page * pageSize < count ? page + 1 : null } };
  });

  // --- v0.2.0媒体r3控制面（admin Bearer）：授权/票据/状态/停止；码流零承载（独立media-view数据面进程）---
  route("POST", "/v1/media-sessions", (ctx) => { const subj = ctx.admin(); const body = ctx.body;
    const { org, proj, client, device } = mediaAdmission(db, subj, body);
    const at = nowMs();
    const durationSec = body.requestedForSeconds ?? MEDIA_SESSION_DEFAULT_SEC;
    safeInt(durationSec, "requestedForSeconds", { min: 30, max: 86400 });
    // B7：观看主体标记（httpview在mv cookie会话鉴权后经内部头注入；sha256b64hex格式；非权力凭据，
    // 仅供状态/停止的创建者校验。无头=管理/部署层信任调用，仍为明确授权角色。）
    const viewerRefRaw = typeof ctx.headers?.["x-media-viewer-subject"] === "string" ? ctx.headers["x-media-viewer-subject"] : null;
    if (viewerRefRaw !== null && !/^[A-Za-z0-9+\/=]{43,64}$/.test(viewerRefRaw)) throw vErr("invalid viewer subject header");
    const viewerSubjectRef = viewerRefRaw;
    const sid = ulid(at);
    const expires = at + durationSec * 1000;
    let tickets,source,newSource=false,sourceTickets;
    db.exec("BEGIN IMMEDIATE");
    try {
      mediaAdmission(db,subj,body);
      source=one(db,"SELECT * FROM media_session WHERE device_rowid=? AND source_session_ulid IS NULL AND viewer_subject_ref IS NULL AND NOT EXISTS (SELECT 1 FROM media_ticket mt WHERE mt.media_session_rowid=media_session.id AND mt.role='viewer') AND status IN ('authorized','live') AND expires_at_ms>? ORDER BY id DESC LIMIT 1",device.id,at);
      if(!source){
        const sourceId=ulid(at);
        const ins=run(db,"INSERT INTO media_session(media_session_ulid,org_rowid,project_rowid,client_rowid,device_rowid,purpose,status,created_at_ms,expires_at_ms) VALUES(?,?,?,?,?,'screen-preview','authorized',?,?)",sourceId,org.id,proj.id,client.id,device.id,at,at+86400000);
        source=one(db,"SELECT * FROM media_session WHERE id=?",ins.lastInsertRowid);
        sourceTickets=createMediaTickets(db,{id:source.id,roles:['client']},at);newSource=true;
      }
      const ins=run(db,"INSERT INTO media_session(media_session_ulid,org_rowid,project_rowid,client_rowid,device_rowid,purpose,status,created_at_ms,expires_at_ms,viewer_subject_ref,source_session_ulid) VALUES(?,?,?,?,?,'screen-preview','authorized',?,?,?,?)",sid,org.id,proj.id,client.id,device.id,at,Math.min(expires,source.expires_at_ms),viewerSubjectRef,source.media_session_ulid);
      tickets=createMediaTickets(db,{id:ins.lastInsertRowid,roles:['viewer']},at);
      db.exec("COMMIT");
    }catch(e){db.exec("ROLLBACK");throw e;}
    const m=one(db,"SELECT * FROM media_session WHERE media_session_ulid=?",sid);
    if(newSource){
      const evData={mediaSessionId:source.media_session_ulid,deviceId:body.deviceId,clientTicket:sourceTickets.client,expiresAt:toRfc3339(source.expires_at_ms),dataPlanePath:"/ws/media/{ticket}"};
      try{getOrCreateStream(db,"client:"+body.clientId,at);emit(db,"client:"+body.clientId,client.last_epoch,"media.authorized",evData,at);}catch{/* existing event reconciliation */}
    }
    return { status: 200, body: { mediaSessionId: sid, orgId: body.orgId, projectId: body.projectId, clientId: body.clientId, deviceId: body.deviceId,
      purpose: m.purpose, status: "authorized", createdAt: toRfc3339(m.created_at_ms), expiresAt: toRfc3339(m.expires_at_ms),
      viewerTicket: tickets.viewer,
      dataPlane: { mode: "wss-relay", pathTemplate: "/ws/media/{ticket}", acceptsBinaryFrom: "client",
        backpressure: { maxBufferedBytes: MEDIA_MAX_BUFFERED_BYTES, maxQueueMessages: MEDIA_MAX_QUEUE_MESSAGES, violationPolicy: "disconnect-session-failed" },
        limits: { maxConcurrentSessions: 16, maxUplinkBytesPerSec: 4 * 1024 * 1024, uplinkWindowMs: 1000, ticketTtlSec: MEDIA_TICKET_TTL_SEC },
        h264Framing: { messageBoundary: "annex-b-access-unit", initialization: "idr-with-sps-pps-first", keyframeRecovery: "client-gop-idr", ptsPassthrough: "au-passthrough-no-pts" }, // r5.2：PTS不透传（AU裸字节+浏览器合成时钟33000µs/AU监视呈现）
        sweepIntervalMs: MEDIA_SWEEP_MS },
      endedReason: null, endedAt: null } };
  });

  // ---------- C98：组登记投影（合同v0.4.0§2/§3；DG1串行接线第2步——会话+scope鉴权） ----------
  // 鉴权边界（root裁定=Desktop唯一正式组写者）：upload/read均需Desktop当前会话Bearer（client身份挑战
  // 派生），**非admin Bearer**；wire.claim的clientId必须等于会话client_ulid（Check归属前置），
  // 成员deviceId按"该client名下device表"查询归属（Select——Server侧scope枚举不做全org回退）。
  // wire白名单/日历/幂等等下游校验=group-registry.mjs冻结合同载荷；此处不属于Server写回或派发——
  // 派发/步骤/媒体/报告不在本接线的范围（未实现也不冒充完成）。
  function groupSession(ctx) { // 会话准入+归属工具（Code security: T=currentSession；U=wire.clientId）
    const sess = currentSession(db, ctx.bearer);
    if (ctx.body && ctx.body.clientId !== undefined && ctx.body.clientId !== sess.client_ulid)
      throw new ApiError("GROUP_OWNER_MISMATCH", "registry caller session does not own this clientId", { clientId: ctx.body.clientId });
    return sess;
  }
  function groupMembersOwned(sess, members) { // Select：成员归属校验——本client名下device表（Server侧不猜、不回退到org全量）
    for (const m of members) {
      const d = one(db, "SELECT id FROM device WHERE device_ulid = ? AND client_rowid = ?", m.deviceId, sess.client_rowid);
      if (!d) throw new ApiError("GROUP_INVALID", "member deviceId not owned by this client", { deviceId: m.deviceId });
    }
  }
  route("POST", "/v1/group-registrations", (ctx) => { const sess = groupSession(ctx); const body = ctx.body;
    // C100（7115753）：**完整wire校验前置于成员解引用/SQL**——修前畸形输入（数字/对象/字符串/[null]/[{}]等）
    // 直接进m.deviceId解引用=500 INTERNAL。复用冻结合同校验（先于归属Select），零新增校验语义；
    // 会话准入→归属Check（groupSession）→wire校验（frozen）→成员Select→事务载荷。
    validateRegistration(body);
    groupMembersOwned(sess, body.members);
    const ack = upsertGroupRegistration(db, body); // 冻结合同§2载荷（denied→ApiError→映射EC）
    return { status: 200, body: ack };
  });
  route("GET", "/v1/group-registrations", (ctx) => { const sess = currentSession(db, ctx.bearer);
    // 只读本Desktop名下投影；不带scope注入——registries由注册面逐条读取（成员机密字段永不出库）
    const rows = many(db, "SELECT body FROM group_registration WHERE client_ulid=? ORDER BY group_uid", sess.client_ulid);
    return { status: 200, body: { items: rows.map(r => JSON.parse(r.body)), count: rows.length } };
  });
  route("POST", "/v1/group-executions", (ctx) => { const sess = groupSession(ctx); const body = ctx.body;
    // C100：同上——groupSnapshot可能非对象/成员畸形，先复用冻结合同校验再解引用Select
    validateExecution(body);
    groupMembersOwned(sess, body.groupSnapshot?.members);
    const ack = upsertGroupExecution(db, body); // 冻结合同§3载荷（不可变核心/状态机/原生单绑定）
    // DG110：派发账本镜像钩子（非侵入）——投影受理成功后按原requestId推进该派发的账目状态；
    // 非派发绑定的投影（常规组执行）GROUP_NOT_FOUND即静默；对账冲突只记不破坏冻结投影受理结果
    //（账本状态以客户端reconcile心跳/完整分页对账再收敛）。
    try { reconcileGroupDispatch(db, { clientId: body.clientId, requestId: body.requestId }, { clientUlid: sess.client_ulid, epoch: sess.epoch }); }
    catch (e) { if (!(e instanceof ApiError) || !["GROUP_NOT_FOUND", "GROUP_EXECUTION_CONFLICT"].includes(e.code)) console.warn("[group-dispatch-reconcile]", e.code ?? e.message); }
    return { status: 200, body: ack };
  });
  // DG110（Server接线候选）：登记=鉴权+归属核事实；执行授权仍在Desktop准入（登记≠可执行授权）。
  route("POST", "/v1/group-dispatches", (ctx) => { const sess = groupSession(ctx); // 准入+归属Check（wire.clientId==会话属主）
    const ack = createGroupDispatch(db, ctx.body, { clientUlid: sess.client_ulid, epoch: sess.epoch }); // 完整模块执法（typed封套/UTF8字节/幂等/同事务事件）
    return { status: 200, body: ack };
  });
  route("POST", "/v1/group-dispatches/cancel", (ctx) => { const sess = groupSession(ctx);
    const ack = requestDispatchCancel(db, { clientId: ctx.body.clientId, requestId: ctx.body.requestId }, { clientUlid: sess.client_ulid, epoch: sess.epoch });
    return { status: 200, body: ack };
  });
  // ── DG120 授权HTTP接线（f47430e已审模块）──
  route("POST", "/v1/group-grants", (ctx) => { // admin面：真实adminSubject+operator白名单403（非白名单路由）
    const subj = adminSubject(db, ctx.bearer);
    // 授权签发=admin-only：operator在本路由由assertAdminRole统一403，模块approverScope锁内再核role='admin'（双保险）
    // DG121（7128016红①闭合）：审计改为同事务钩子——在模块签发事务内、COMMIT前写admin_audit；
    // 审计写失败=整事务回滚→零签发+零审计，本读回500；不存在"已提交授权但缺审计"。异常不吞。
    const ack = issueGroupGrant(db, ctx.body, { rowid: subj.id, label: subj.label }, (info) => {
      run(db, "INSERT INTO admin_audit(admin_rowid, action, target_json, at_ms) VALUES (?,?,?,?)",
        subj.id, info.action, JSON.stringify({ grantId: info.grantId, targetClientId: info.targetClientId, groupId: info.groupId, ttlSec: info.ttlSec }), Date.now());
    });
    return { status: 200, body: ack };
  });
  route("POST", "/v1/group-grants/revoke", (ctx) => { // admin面吊销+审计
    const subj = adminSubject(db, ctx.bearer);
    // DG121（7128016红②闭合）：吊销审计同事务钩子（新吊销与幂等重放两个分支都在COMMIT前写审计；
    // 回滚语义=零吊销+零审计）
    const ack = revokeGroupGrant(db, { grantId: ctx.body.grantId }, { rowid: subj.id, label: subj.label }, (info) => {
      run(db, "INSERT INTO admin_audit(admin_rowid, action, target_json, at_ms) VALUES (?,?,?,?)",
        subj.id, info.action, JSON.stringify({ grantId: info.grantId, replay: info.replay }), Date.now());
    });
    return { status: 200, body: { grantId: ack.grantId, revoked: true, replay: ack.replay, revokedAtMs: ack.revokedAtMs } };
  });
  route("POST", "/v1/group-grants/verify", (ctx) => { // Desktop会话面：绑定全由服务端从账本权威取值
    const sess = groupSession(ctx); // 会话+归属Check前置schema（C101序；wire.clientId必等于会话属主）
    const body = ctx.body;
    // 服务端权威取值：requestId指向的待派发行——不存在/不属本会话即GROUP_NOT_FOUND（不含账本未建的情况告知）
    const row = one(db, "SELECT * FROM group_dispatch WHERE request_uid=? AND client_ulid=?", body.requestId, sess.client_ulid);
    if (!row) throw new ApiError("GROUP_NOT_FOUND", "dispatch request not found for this session; grants are verified against a persisted dispatch identity");
    // 绑定字段：group/revision/member/payload摘要+bytes全部取自账本行，不信任请求自报；payload摘要按账本存储值
    const binding = {
      requestId: row.request_uid, clientId: row.client_ulid, groupId: row.group_uid,
      expectedRevision: row.group_revision, memberSha256: row.member_sha,
      payloadSha256: row.payload_sha, payloadBytes: row.payload_bytes, dispatchPlanSha256: row.plan_sha,
    };
    const verdict = verifyGroupGrantForDispatch(db, binding, { clientUlid: sess.client_ulid });
    // 取消早到披露：账本 cancel_requested_at 伴随判决回送（消费队列自身的停止动作仍由四步序负责）
    const verdict2 = { ...verdict, cancelRequestedAt: row.cancel_requested_at, sessionEpoch: sess.epoch };
    return { status: 200, body: verdict2 };
  });

  route("GET", "/v1/group-dispatches", (ctx) => { const sess = currentSession(db, ctx.bearer); // GET会话准入
    const mirrorErrors = new Map(); // 本读次捕获的镜像冲突（请求级，不跨请求累积）
    if (String(ctx.q.clientId ?? "") !== sess.client_ulid) throw new ApiError("GROUP_OWNER_MISMATCH", "pending view must target the session owner", { clientId: ctx.q.clientId ?? null });
    // DG114（7125122红②）：完整游标/limit验证先于任何 catch-up 持久写——
    // 拒绝路径（422/403）零持久副作用；不全游标（只带afterCreatedMs缺afterDispatchUid）在本路由即拒。
    const afterCreatedMs = ctx.q.afterCreatedMs !== undefined ? safeInt(Number(ctx.q.afterCreatedMs), "afterCreatedMs") : undefined;
    const afterDispatchUid = ctx.q.afterDispatchUid !== undefined ? String(ctx.q.afterDispatchUid) : undefined;
    if ((afterCreatedMs === undefined) !== (afterDispatchUid === undefined))
      throw new ApiError("GROUP_INVALID", "cursor must carry both afterCreatedMs and afterDispatchUid or neither", { afterCreatedMs: afterCreatedMs ?? null, afterDispatchUid: afterDispatchUid ?? null });
    if (afterDispatchUid !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(afterDispatchUid))
      throw new ApiError("GROUP_INVALID", "afterDispatchUid must be UUIDv4");
    const limit = ctx.q.limit !== undefined ? safeInt(Number(ctx.q.limit), "limit", { min: 1, max: 200 }) : 50;
    // DG112（7124199红②闭环）：pending 读取本身是持久恢复点——对每个未终态行先幂等 catch-up
    // reconcile（不发新任务、不解锁资源、纯账本镜像推进；暂态故障在本读处即重试收敛）。
    // GROUP_EXECUTION_CONFLICT 不再静默吞掉：以每行 mirrorError 字段显式暴露冲突语义
    //（账本不截断投影已受理事实——冲突=判不动、终态不误退出）。
    let mirrorDegraded = null; // DG114（7125122红①）：持续DB故障不得假清晰——非ApiError存储故障=本读受控可消费失败（503 retryable），非200+mirrorError:null
    for (const row of many(db, "SELECT request_uid FROM group_dispatch WHERE client_ulid=? AND status IN ('requested','confirmed','dispatching','unknown')", sess.client_ulid)) {
      try { reconcileGroupDispatch(db, { clientId: sess.client_ulid, requestId: row.request_uid }, { clientUlid: sess.client_ulid }); } // 模块内自管BEGIN IMMEDIATE；读次即重复重试直至收敛
      catch (e) {
        if (e instanceof ApiError && e.code === "GROUP_EXECUTION_CONFLICT") mirrorErrors.set(row.request_uid, e.code);
        else if (e instanceof ApiError && e.code !== "GROUP_NOT_FOUND") throw e;
        else if (!(e instanceof ApiError)) mirrorDegraded = e; // 存储层故障（非ApiError）——不吞：全读切换为受控不确定性
      }
    }
    if (mirrorDegraded) throw Object.assign(new ApiError("UNAVAILABLE", "dispatch mirror storage is unhealthy; pending view degraded (retryable; retried on next read)"), { retryable: true });
    const page = listPendingGroupDispatches(db, { clientId: sess.client_ulid, afterCreatedMs, afterDispatchUid, limit }, { clientUlid: sess.client_ulid });
    // 稳定响应：展平clientWire字段+保留嵌套clientWire（pendingItem schema口径），可信外层=会话epoch保护的事件流+账本视图
    return { status: 200, body: { items: page.items.map((it) => ({ ...it, ...it.clientWire, mirrorError: mirrorErrors.get(it.requestId) ?? null })), nextCursor: page.nextCursor } };
  });

  // 目标4操作者/管理面受控读取（队长01a1bb25授权）：GET /v1/group-dispatch-detail/{requestId}?clientId=U。
  // admin面准入（operator在核心OPERATOR_ROUTES白名单外即403——零operator权限扩大）；归Select+checkAdminScope核
  // 目标client行org/project；输出与Client会话面同projection+steps真实投影+reportRef正式解析面。
  const GDRR_REQ_ID2 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  // 目标4组详情受控读(01a1bb35授权): GET /v1/group-dispatches-by-admin/{requestId}?clientId=U——
  // 详情含 group body members(deviceId/role 真值投影), 不放开管理面其他路由.Same Select-guard架构.
  route("GET", "/v1/group-dispatches-by-admin/{requestId}", (ctx) => { const subj = ctx.admin(); const requestId = String(ctx.params.requestId ?? "");
    if (!GDRR_REQ_ID2.test(requestId)) throw new ApiError("GROUP_INVALID", "requestId must be UUIDv4", {});
    const qcid = String(ctx.q.clientId ?? "");
    if (!/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(qcid)) throw new ApiError("GROUP_INVALID", "clientId must be Desktop ULID", {});
    const cc = one(db, "SELECT c.org_rowid, c.project_rowid, c.status FROM client c WHERE c.client_ulid = ?", qcid);
    if (!cc) throw new ApiError("GROUP_NOT_FOUND", "target client not found", {});
    checkAdminScope(subj, db, cc.org_rowid, cc.project_rowid);
    const d = one(db, "SELECT * FROM group_dispatch WHERE request_uid=? AND client_ulid=?", requestId, qcid);
    if (!d) throw new ApiError("GROUP_NOT_FOUND", "dispatch request not found for this client", {});
    const reg = one(db, "SELECT body FROM group_registration WHERE client_ulid=? AND group_uid=?", qcid, d.group_uid);
    const regBody = reg ? JSON.parse(reg.body) : null;
    return { status: 200, body: {
      requestId: d.request_uid, dispatchId: d.dispatch_uid, clientId: d.client_ulid, groupId: d.group_uid,
      status: d.status, terminalAt: d.terminal_at, terminalOutcome: d.terminal_outcome,
      cancelRequestedAt: d.cancel_requested_at, taskUid: d.task_uid, confirmedAt: d.confirmed_at,
      dispatchPlanSha256: d.plan_sha, payloadSha256: d.payload_sha, payloadBytes: d.payload_bytes, memberSha256: d.member_sha,
      expectedRevision: d.group_revision,
      group: regBody == null ? null : { groupId: regBody.groupId, name: regBody.name, revision: regBody.revision, deleted: regBody.deleted,
        updatedAtMs: regBody.updatedAtMs,
        members: Array.isArray(regBody.members) ? regBody.members.map(function(m) {
          const dv = m.deviceId ? one(db, "SELECT name, kind, status FROM device WHERE device_ulid = ?", m.deviceId) : null;
          return { deviceId: m.deviceId, role: m.role, deviceName: dv ? dv.name : null, deviceKind: dv ? (dv.kind === "other" ? null : dv.kind) : null, deviceStatus: dv ? dv.status : null };
        }) : null },
    } };
  });
  route("GET", "/v1/group-dispatch-detail/{requestId}", (ctx) => { const subj = ctx.admin(); const requestId = String(ctx.params.requestId ?? "");
    if (!GDRR_REQ_ID2.test(requestId)) throw new ApiError("GROUP_INVALID", "requestId must be UUIDv4", {});
    const qcid = String(ctx.q.clientId ?? "");
    if (!/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(qcid)) throw new ApiError("GROUP_INVALID", "clientId must be Desktop ULID", {});
    const cc = one(db, "SELECT c.org_rowid, c.project_rowid, c.status FROM client c WHERE c.client_ulid = ?", qcid);
    if (!cc) throw new ApiError("GROUP_NOT_FOUND", "target client not found", {});
    checkAdminScope(subj, db, cc.org_rowid, cc.project_rowid);
    const d = one(db, "SELECT * FROM group_dispatch WHERE request_uid=? AND client_ulid=?", requestId, qcid);
    if (!d) throw new ApiError("GROUP_NOT_FOUND", "dispatch request not found for this client (统一不泄存在性)", {});
    const exec = one(db, "SELECT * FROM group_execution_projection WHERE request_uid=?", d.request_uid);
    const execBody = exec ? JSON.parse(exec.body) : null;
    const reportRef = (execBody && execBody.receipt) ? execBody.receipt.reportRef : null;
    const reportRefParsed = (function parseRef(rr) { if (typeof rr !== "string" || rr.length === 0) return null; const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/(.*)$/.exec(rr); if (m && (m[1] === "local-report" || m[1] === "report")) return { scheme: m[1], path: m[2].slice(0, 256), fetchable: false }; return { scheme: null, path: rr.slice(0, 64), fetchable: false, parseError: "unsupported scheme" }; })(reportRef);
    return { status: 200, body: {
      requestId: d.request_uid, dispatchId: d.dispatch_uid, clientId: d.client_ulid, groupId: d.group_uid,
      expectedRevision: d.group_revision,
      dispatchPlanSha256: d.plan_sha, payloadSha256: d.payload_sha, payloadBytes: d.payload_bytes, memberSha256: d.member_sha,
      status: d.status, cancelRequestedAt: d.cancel_requested_at, taskUid: d.task_uid, confirmedAt: d.confirmed_at,
      terminalAt: d.terminal_at, terminalOutcome: d.terminal_outcome,
      execution: execBody == null ? null : {
        groupExecutionId: execBody.groupExecutionId ?? null, taskId: execBody.taskId ?? null,
        phase: execBody.phase ?? null, receipt: execBody.receipt ?? null, eventSeq: execBody.eventSeq ?? null,
      },
      steps: execBody == null ? null : (Array.isArray(execBody.steps) ? execBody.steps : null),
      reportRef, reportRefParsed,
      reportAccess: { channel: "client-local-report", holder: "owner Client", serverCopy: false,
        note: "真实报告载荷存于owner Client本地由receipt.reportRef引用; Server仅登记/解析引用不复制; 端侧可访问路径=Client报告模块的本地报告地址(按reportRef解析); Server端授权下载端点待Client对齐后接入" },
    } };
  });

  // 目标4受控终态详情读（01a1bb15授权）：GET /v1/group-dispatches-by-request/{requestId}——Client会话面。
  // Code security: currentSession准入(T) + Select归属（查询条件同时带requestId=U与会话属主client_ulid）；
  // 复用group_dispatch真实账本与group_execution_projection镜像body（receipt含reportRef原样透出，参考标识
  // 不构链接）。pending消失后行不删——按原ID仍可读终态；无新表、无新Loop、不造agent-task映射或报告URL。
  const GDR_REQ_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  route("GET", "/v1/group-dispatches-by-request/{requestId}", (ctx) => { const sess = currentSession(db, ctx.bearer); const requestId = String(ctx.params.requestId ?? "");
    if (!GDR_REQ_ID.test(requestId)) throw new ApiError("GROUP_INVALID", "requestId must be UUIDv4", {});
    const d = one(db, "SELECT * FROM group_dispatch WHERE request_uid=? AND client_ulid=?", requestId, sess.client_ulid); // Select：U+T同时入条件
    if (!d) throw new ApiError("GROUP_NOT_FOUND", "dispatch request not found for this client (统一不泄存在性)", {});
    const exec = one(db, "SELECT * FROM group_execution_projection WHERE request_uid=?", d.request_uid);
    const execBody = exec ? JSON.parse(exec.body) : null; // 不可变触发器保护：receipt/taskId/requestId身仧行不可改写
    return { status: 200, body: {
      requestId: d.request_uid, dispatchId: d.dispatch_uid, clientId: d.client_ulid, groupId: d.group_uid,
      expectedRevision: d.group_revision,
      dispatchPlanSha256: d.plan_sha, payloadSha256: d.payload_sha, payloadBytes: d.payload_bytes, memberSha256: d.member_sha,
      status: d.status, cancelRequestedAt: d.cancel_requested_at, taskUid: d.task_uid, confirmedAt: d.confirmed_at,
      terminalAt: d.terminal_at, terminalOutcome: d.terminal_outcome,
      execution: execBody == null ? null : {
        groupExecutionId: execBody.groupExecutionId ?? null, taskId: execBody.taskId ?? null,
        phase: execBody.phase ?? null,
        receipt: execBody.receipt ?? null, // 含 terminal=true/resourcesReleased/outcome/reportRef(参考标识原样)
        eventSeq: execBody.eventSeq ?? null,
      },
      steps: execBody == null ? null : (Array.isArray(execBody.steps) ? execBody.steps : null), // 目标4：真实投影（最小新增合同,零DDL）；未上报=null如实
      reportRef: (execBody && execBody.receipt) ? execBody.receipt.reportRef : null,
      reportRefParsed: (function parseRef(rr) { if (typeof rr !== "string" || rr.length === 0) return null; const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/(.*)$/.exec(rr); if (m && (m[1] === "local-report" || m[1] === "report")) return { scheme: m[1], path: m[2].slice(0, 256), fetchable: false }; return { scheme: null, path: rr.slice(0, 64), fetchable: false, parseError: "unsupported scheme" }; })((execBody && execBody.receipt) ? execBody.receipt.reportRef : null),
    } };
  });


  route("GET", "/v1/media-sessions/{mediaSessionId}", (ctx) => { const subj = ctx.admin(); const params = ctx.params; const q = ctx.q;
    const m = one(db, "SELECT * FROM media_session WHERE media_session_ulid = ?", params.mediaSessionId);
    if (!m) throw new ApiError("MEDIA_SESSION_INVALID", "media session not found", {});
    checkAdminScope(subj, db, m.org_rowid, m.project_rowid); // B2：状态读取也受会话归属scope约束
    mediaViewerCheck(m, ctx.headers); // B7：观看主体行须由创建主体读取（admin无头=明确授权角色）
    const c = one(db, "SELECT client_ulid FROM client WHERE id = ?", m.client_rowid); const d = one(db, "SELECT device_ulid FROM device WHERE id = ?", m.device_rowid);
    return { status: 200, body: { mediaSessionId: m.media_session_ulid, clientId: c.client_ulid, deviceId: d.device_ulid, purpose: m.purpose,
      status: m.status, createdAt: toRfc3339(m.created_at_ms), expiresAt: toRfc3339(m.expires_at_ms),
      clientJoinedAt: m.client_joined_ms ? toRfc3339(m.client_joined_ms) : null,
      viewerJoinedAt: m.viewer_joined_ms ? toRfc3339(m.viewer_joined_ms) : null,
      endedReason: m.ended_reason, endedAt: m.ended_at_ms ? toRfc3339(m.ended_at_ms) : null } };
  });

  route("POST", "/v1/media-sessions/{mediaSessionId}/stop", (ctx) => { const subj = ctx.admin(); const params = ctx.params; const q = ctx.q;
    const m = one(db, "SELECT * FROM media_session WHERE media_session_ulid = ?", params.mediaSessionId);
    if (!m) throw new ApiError("MEDIA_SESSION_INVALID", "media session not found", {});
    checkAdminScope(subj, db, m.org_rowid, m.project_rowid); // B2：停止受会话归属scope约束，越scope403无副作用
    mediaViewerCheck(m, ctx.headers); // B7：观看主体行须由创建主体停止（admin无头=明确授权角色；匿名在部署层已被挡）
    const at = nowMs();
    // B4：stop幂等只对未终结授权生效；已stopped/failed/expired按DB事实原样返回，不覆盖终态、不伪造stopped
    if (m.status !== "stopped" && m.status !== "failed" && m.expires_at_ms > at) {
      db.exec("BEGIN");
      try {
        run(db, "UPDATE media_session SET status='stopped', stops_at_ms=?, ended_at_ms=?, ended_reason=COALESCE(ended_reason,'stopped') WHERE id=?", at, at, m.id);
        run(db, "UPDATE media_ticket SET revoked_at_ms=? WHERE media_session_rowid=? AND revoked_at_ms IS NULL", at, m.id);
        db.exec("COMMIT");
      } catch (e) { db.exec("ROLLBACK"); throw e; }
    }
    // 过读事故态：expires已过且未终结→如实expired（读时派生与设备三态同方式）
    const fresh = one(db, "SELECT * FROM media_session WHERE id = ?", m.id);
    const c = one(db, "SELECT client_ulid, org_rowid, project_rowid FROM client WHERE id = ?", m.client_rowid);
    const d = one(db, "SELECT device_ulid FROM device WHERE id = ?", m.device_rowid);
    let stopStatus = fresh.status;
    let stopEndedReason = fresh.ended_reason; let stopEndedAt = fresh.ended_at_ms ? toRfc3339(fresh.ended_at_ms) : null;
    if (fresh.status !== "stopped" && fresh.status !== "failed" && fresh.expires_at_ms <= at) { stopStatus = "expired"; stopEndedReason = stopEndedReason ?? "expired"; stopEndedAt = stopEndedAt ?? toRfc3339(fresh.expires_at_ms); }
    return { status: 200, body: { mediaSessionId: fresh.media_session_ulid, clientId: c.client_ulid, deviceId: d.device_ulid, purpose: fresh.purpose,
      status: stopStatus, createdAt: toRfc3339(fresh.created_at_ms), expiresAt: toRfc3339(fresh.expires_at_ms),
      clientJoinedAt: fresh.client_joined_ms ? toRfc3339(fresh.client_joined_ms) : null,
      viewerJoinedAt: fresh.viewer_joined_ms ? toRfc3339(fresh.viewer_joined_ms) : null,
      endedReason: stopEndedReason, endedAt: stopEndedAt } };
  });

  // --- v0.3.0 Agent任务面：Super-agent↔Client agent双向第一批实施（直接工具调用+prompt委托同一合同）---
  // 状态机：queued→delivered→running→succeeded|failed|cancelled|expired；任务状态独立于Client会话（上游Ticket规则）。
  // 幂等：create按(client,idempotencyKey)+payload摘要；result终态首写胜出、重放同应答；迟到结果存档不改写终态。
  function agentTaskOut(db, a, extra = {}) {
    const c = one(db, "SELECT client_ulid FROM client WHERE id = ?", a.client_rowid);
    const o = one(db, "SELECT org_ulid FROM org WHERE id = ?", a.org_rowid);
    const p = one(db, "SELECT project_ulid FROM project WHERE id = ?", a.project_rowid);
    return { agentTaskId: a.agent_task_ulid, orgId: o.org_ulid, projectId: p.project_ulid, clientId: c.client_ulid,
      kind: a.task_kind,
      tool: a.task_kind === "tool-call" ? { name: a.tool_name, args: JSON.parse(a.tool_args_json ?? "null") } : null,
      prompt: a.task_kind === "prompt" ? JSON.parse(a.prompt_json ?? "null") : null,
      status: a.status, progress: a.progress ?? null, timeoutSec: a.timeout_sec,
      createdAt: toRfc3339(a.created_at_ms), expiresAt: toRfc3339(a.expires_at_ms),
      deliveredAt: a.delivered_at_ms ? toRfc3339(a.delivered_at_ms) : null,
      startedAt: a.started_at_ms ? toRfc3339(a.started_at_ms) : null,
      cancelRequestedAt: a.cancel_requested_ms ? toRfc3339(a.cancel_requested_ms) : null,
      endedAt: a.ended_at_ms ? toRfc3339(a.ended_at_ms) : null,
      result: a.result_json ? JSON.parse(a.result_json) : null,
      error: a.error ?? null, ...extra };
  }
  // 过期如实落终态（读时推进write-through，与媒体stop的事故态推导同模式；终态行保留不删）
  function agentExpireSweep(db, clientRowid) {
    const changed = run(db, "UPDATE agent_task SET status='expired', ended_at_ms=COALESCE(ended_at_ms,?) WHERE client_rowid=? AND status IN ('queued','delivered','running') AND expires_at_ms<=?",
        nowMs(), clientRowid, nowMs()).changes;
    return Number(changed);
  }
  function agentTaskPayloadSha(body) {
    return sha256b64(JSON.stringify({ kind: body.kind, tool: body.tool ?? null, prompt: body.prompt ?? null, timeoutSeconds: body.timeoutSeconds ?? null }));
  }
  function agentAdmission(db, subj, q) { // 与mediaAdmission同源准入判据（减设备维度）：scope→client→_AGENT能力门_
    const org = one(db, "SELECT id FROM org WHERE org_ulid = ?", q.orgId);
    const proj = org && one(db, "SELECT id FROM project WHERE org_rowid = ? AND project_ulid = ?", org.id, q.projectId);
    if (!org || !proj) throw new ApiError("AUTH_SCOPE_DENIED", "target scope not granted");
    checkAdminScope(subj, db, org.id, proj.id);
    const c = one(db, "SELECT id, client_ulid, last_epoch, status, valid_until_ms, capabilities_json FROM client WHERE client_ulid = ? AND org_rowid = ? AND project_rowid = ?", q.clientId, org.id, proj.id);
    if (!c) throw new ApiError("AGENT_TASK_INVALID", "client not in scope", {});
    if (c.status === "revoked") throw new ApiError("AGENT_TASK_INVALID", "client revoked", {});
    if (c.valid_until_ms <= Date.now()) throw new ApiError("AGENT_TASK_INVALID", "client authorization expired", {});
    const caps = JSON.parse(c.capabilities_json ?? "{}");
    if (caps.agent !== true) throw new ApiError("AGENT_TASK_INVALID", "client agent capability not enabled (set capabilities:{agent:true} at session)", {});
    return { org, proj, client: c };
  }
  // C71（P1复核阻塞③·能力降级）：能力门延伸到送达/执行边界（v0.3.0 §1"权限落实在准入/执行边界"）。
  // 读取模型=client行capabilities（会话签发同事务刷新，C55同源）——降级后禁止新送达（queue）/新启动（progress）；
  // result保持开放=必要停止与真实结果对账，不以一刀切阻止清理报告。
  function agentSessionGate(db, sess) {
    const c = one(db, "SELECT capabilities_json FROM client WHERE id = ?", sess.client_rowid);
    if (JSON.parse(c?.capabilities_json ?? "{}").agent !== true) throw new ApiError("AGENT_TASK_INVALID", "client agent capability not enabled (set capabilities:{agent:true} at session)", {});
  }
  // C71（P1复核阻塞②·到期统一裁决）→C72修订：列表读路径的到期write-through**只作用于本次请求已授权的
  // org/project范围**——非授权范围行零副作用；跨范围维护如需要另走明确机制，不借本端点全局回收。
  // 且仅在校验全部通过后执行：422请求不产生任何持久化副作用。
  function agentExpireSweepScope(orgRowid, projectRowid) {
    return Number(run(db, "UPDATE agent_task SET status='expired', ended_at_ms=COALESCE(ended_at_ms,?) WHERE org_rowid=? AND project_rowid=? AND status IN ('queued','delivered','running') AND expires_at_ms<=?",
        nowMs(), orgRowid, projectRowid, nowMs()).changes);
  }
  // C72：单行到期裁决（prior/竞态重答共用）——命中行已过deadline时先条件落expired再回读，
  // 幂等早返回（prior或UNIQUE竞态兜底）不得绕过到期裁决；条件UPDATE保证不覆盖既有终态
  const agentAdjudicateRow = (row) => {
    if (AGENT_TERMINAL.has(row.status) || row.expires_at_ms > Date.now()) return row;
    const at = nowMs();
    run(db, "UPDATE agent_task SET status='expired', ended_at_ms=COALESCE(ended_at_ms,?) WHERE id=? AND status NOT IN ('succeeded','failed','cancelled','expired')", at, row.id);
    return one(db, "SELECT * FROM agent_task WHERE id = ?", row.id);
  };
  // 事件游标直通端点注册顺序先于/{agentTaskId}（queue是保留字路径）
  route("GET", "/v1/agent-tasks/queue", (ctx) => { const q = ctx.q;
    const sess = currentSession(db, ctx.bearer); // GET无body epoch，准入=Bearer当前会话（同/v1/events streamAuthz模式）
    agentSessionGate(db, sess); // C71：当前会话agent能力未开=禁止新送达（queued→delivered不发生，行保持queued）
    agentExpireSweep(db, sess.client_rowid);
    const sinceId = q.sinceId !== undefined ? safeInt(Number(q.sinceId), "sinceId") : 0;
    const limit = q.limit ? safeInt(Number(q.limit), "limit", { min: 1, max: 100 }) : 20;
    const rows = many(db, "SELECT * FROM agent_task WHERE client_rowid = ? AND id > ? AND status IN ('queued','delivered','running') ORDER BY id LIMIT ?",
        sess.client_rowid, sinceId, limit + 1);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const at = nowMs();
    for (const it of items) if (it.status === "queued") { // 首次拉取=送达（送达时刻与终态分别记录）
      run(db, "UPDATE agent_task SET status='delivered', delivered_at_ms=? WHERE id=? AND status='queued'", at, it.id);
      it.status = "delivered"; it.delivered_at_ms = at;
    }
    return { status: 200, body: { items: items.map((a) => agentTaskOut(db, a)), nextSinceId: items.length ? items[items.length - 1].id : sinceId, hasMore } };
  });

  route("POST", "/v1/agent-tasks", (ctx) => { const subj = ctx.admin(); const body = ctx.body;
    requireFields(body, ["orgId", "projectId", "clientId", "kind", "idempotencyKey"]);
    const { org, proj, client } = agentAdmission(db, subj, body);
    // 语义交叉校验（Schema已保证基础形状）：kind与载荷严格配对
    if (body.kind === "tool-call" && (typeof body.tool?.name !== "string" || body.tool.name.length === 0 || typeof body.tool?.args !== "object" || body.tool.args === null)) throw vErr("tool-call requires tool:{name,args}");
    if (body.kind === "prompt" && (typeof body.prompt?.text !== "string" || body.prompt.text.length === 0)) throw vErr("prompt requires prompt:{text}");
    if (body.kind === "tool-call" && body.prompt !== undefined) throw vErr("tool-call must not carry prompt");
    if (body.kind === "prompt" && body.tool !== undefined) throw vErr("prompt must not carry tool");
    const timeoutSec = body.timeoutSeconds ?? AGENT_TASK_TIMEOUT_DEF_SEC;
    safeInt(timeoutSec, "timeoutSeconds", { min: 30, max: 86400 });
    // C71（P1复核阻塞①·满载幂等优先级）：幂等身份判决先于容量裁决——
    // 满载时同键同载荷仍200重答、同键异载荷仍409 AGENT_TASK_CONFLICT，不被RESOURCE_BUSY遮盖；容量仅限制新发放
    const payloadSha = agentTaskPayloadSha(body);
    let prior = one(db, "SELECT * FROM agent_task WHERE client_rowid = ? AND idempotency_key = ?", client.id, body.idempotencyKey);
    if (prior) { // 幂等：同键同摘要=重放重答（断线未知重提不产生副作用）；同键异摘要=冲突
      if (prior.payload_sha !== payloadSha) throw new ApiError("AGENT_TASK_CONFLICT", "same idempotencyKey with different payload", { agentTaskId: prior.agent_task_ulid });
      prior = agentAdjudicateRow(prior); // C72：过期prior先持久落expired再回读重答，不绕过到期裁决
      return { status: 200, body: agentTaskOut(db, prior, { duplicate: true }) };
    }
    // C71（阻塞②·入场回收）：新发放准入先按deadline落过期，过期未扫行不再占用并发预算
    agentExpireSweep(db, client.id);
    const at = nowMs();
    const tid = ulid(at);
    const expires = at + timeoutSec * 1000;
    // Code security: 容量计数与INSERT同一事务（check-then-act原子化）——并发发放只允许满额内一路胜出
    db.exec("BEGIN IMMEDIATE");
    let committed = false;
    try {
      const active = one(db, "SELECT count(*) c FROM agent_task WHERE client_rowid = ? AND status IN ('queued','delivered','running')", client.id).c;
      if (Number(active) >= AGENT_TASK_MAX_CONCURRENT) throw new ApiError("RESOURCE_BUSY", "client agent task queue busy", { maxConcurrent: AGENT_TASK_MAX_CONCURRENT });
      run(db, "INSERT INTO agent_task(agent_task_ulid, org_rowid, project_rowid, client_rowid, task_kind, tool_name, tool_args_json, prompt_json, idempotency_key, payload_sha, status, timeout_sec, created_at_ms, expires_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?, 'queued', ?, ?, ?)",
          tid, org.id, proj.id, client.id,
          body.kind, body.tool?.name ?? null, body.tool ? JSON.stringify(body.tool.args) : null,
          body.prompt ? JSON.stringify(body.prompt) : null, body.idempotencyKey, payloadSha, timeoutSec, at, expires);
      db.exec("COMMIT");
      committed = true;
    } catch (e) {
      if (!committed) { try { db.exec("ROLLBACK"); } catch { /* 已回滚 */ } }
      // Code security: UNIQUE(client,idempotencyKey)竞态兜底——并发同键只落一路；
      // C72：输的一路按已落行分型——同摘要=200重答（同样先做单行到期裁决），异摘要=409 AGENT_TASK_CONFLICT，
      // 绝不把约束异常泄成500
      const race = one(db, "SELECT * FROM agent_task WHERE client_rowid = ? AND idempotency_key = ?", client.id, body.idempotencyKey);
      if (race && race.payload_sha === payloadSha) return { status: 200, body: agentTaskOut(db, agentAdjudicateRow(race), { duplicate: true }) };
      if (race) throw new ApiError("AGENT_TASK_CONFLICT", "same idempotencyKey with different payload", { agentTaskId: race.agent_task_ulid });
      throw e;
    }
    const row = one(db, "SELECT * FROM agent_task WHERE agent_task_ulid = ?", tid);
    // 事件=持久订阅直通（Client经/cp/events或queue拉取；失败不回滚任务行——读取为权威）
    try { getOrCreateStream(db, "client:" + client.client_ulid, at); emit(db, "client:" + client.client_ulid, client.last_epoch, "agent.task.created",
        { agentTaskId: tid, kind: body.kind, tool: body.tool ?? null, prompt: body.prompt ?? null, timeoutSec, expiresAt: toRfc3339(expires) }, at); } catch { /* 同media语义 */ }
    return { status: 200, body: agentTaskOut(db, row, { duplicate: false }) };
  });

  route("GET", "/v1/agent-tasks", (ctx) => { const subj = ctx.admin(); const q = ctx.q;
    requireFields(q, ["orgId", "projectId"]);
    const org = one(db, "SELECT id FROM org WHERE org_ulid = ?", q.orgId);
    const proj = org && one(db, "SELECT id FROM project WHERE org_rowid = ? AND project_ulid = ?", org.id, q.projectId);
    if (!org || !proj) throw new ApiError("AUTH_SCOPE_DENIED", "target scope not granted");
    checkAdminScope(subj, db, org.id, proj.id);
    const page = q.page ? safeInt(Number(q.page), "page", { min: 1 }) : 1;
    const pageSize = q.pageSize ? safeInt(Number(q.pageSize), "pageSize", { min: 1, max: 200 }) : 20;
    let where = ["t.org_rowid = ?", "t.project_rowid = ?"]; const args = [org.id, proj.id];
    if (q.clientId !== undefined) { if (!ULID_RE.test(q.clientId)) throw vErr("clientId must be a ULID"); where.push("c.client_ulid = ?"); args.push(q.clientId); }
    if (q.status) { if (!["queued","delivered","running","succeeded","failed","cancelled","expired"].includes(q.status)) throw vErr("invalid status filter"); where.push("t.status = ?"); args.push(q.status); }
    agentExpireSweepScope(org.id, proj.id); // C72：输入/权限校验全过后，仅授权范围内到期write-through
    const rows = many(db, "SELECT t.* FROM agent_task t JOIN client c ON c.id = t.client_rowid WHERE " + where.join(" AND ") + " ORDER BY t.id DESC LIMIT ? OFFSET ?", ...args, pageSize, (page - 1) * pageSize);
    const count = one(db, "SELECT count(*) AS c FROM agent_task t JOIN client c ON c.id = t.client_rowid WHERE " + where.join(" AND "), ...args).c;
    return { status: 200, body: { items: rows.map((a) => agentTaskOut(db, a)), page, pageSize, nextPage: page * pageSize < count ? page + 1 : null } };
  });

  route("GET", "/v1/agent-tasks/{agentTaskId}", (ctx) => { const subj = ctx.admin(); const params = ctx.params;
    const a = one(db, "SELECT * FROM agent_task WHERE agent_task_ulid = ?", params.agentTaskId);
    if (!a) throw new ApiError("AGENT_TASK_INVALID", "agent task not found", {});
    checkAdminScope(subj, db, a.org_rowid, a.project_rowid);
    agentExpireSweep(db, a.client_rowid);
    return { status: 200, body: agentTaskOut(db, one(db, "SELECT * FROM agent_task WHERE id = ?", a.id)) };
  });

  route("POST", "/v1/agent-tasks/{agentTaskId}/cancel", (ctx) => { const subj = ctx.admin(); const params = ctx.params; const body = ctx.body;
    const a0 = one(db, "SELECT * FROM agent_task WHERE agent_task_ulid = ?", params.agentTaskId);
    if (!a0) throw new ApiError("AGENT_TASK_INVALID", "agent task not found", {});
    checkAdminScope(subj, db, a0.org_rowid, a0.project_rowid);
    agentExpireSweep(db, a0.client_rowid); // C71：取消前先按deadline裁决——过期行如实expired，不被cancel改写为cancelled
    const a = one(db, "SELECT * FROM agent_task WHERE id = ?", a0.id);
    const at = nowMs();
    // 取消请求/送达/实际收尾分别记录：先落cancel_requested_ms（含已终态——如实记录取消试图），仅在未终态时改写状态
    db.exec("BEGIN");
    try {
      run(db, "UPDATE agent_task SET cancel_requested_ms = COALESCE(cancel_requested_ms, ?) WHERE id = ?", at, a.id);
      const changed = run(db, "UPDATE agent_task SET status='cancelled', ended_at_ms=COALESCE(ended_at_ms, ?), error=COALESCE(error, ?) WHERE id = ? AND status NOT IN ('succeeded','failed','cancelled','expired')", at, body?.reason ?? "cancelled", a.id).changes;
      db.exec("COMMIT");
      // Client侧在途结果仍可上报=迟到存档（title不放跑：断线未知不假装已停）
      if (Number(changed) === 1) { const c = one(db, "SELECT client_ulid, last_epoch FROM client WHERE id = ?", a.client_rowid);
        try { emit(db, "client:" + c.client_ulid, c.last_epoch, "agent.task.cancelled", { agentTaskId: a.agent_task_ulid }, at); } catch { /* 同media语义 */ } }
    } catch (e) { db.exec("ROLLBACK"); throw e; }
    return { status: 200, body: agentTaskOut(db, one(db, "SELECT * FROM agent_task WHERE id = ?", a.id)) };
  });

  route("POST", "/v1/agent-tasks/{agentTaskId}/progress", (ctx) => { const sess = ctx.sess; const params = ctx.params; const body = ctx.body;
    const a = one(db, "SELECT * FROM agent_task WHERE agent_task_ulid = ?", params.agentTaskId);
    // Code security: 水平归属=会话client即行归属client（Select同源），未命中/跨主体统一拒绝不泄存在性
    if (!a || a.client_rowid !== sess.client_rowid) throw new ApiError("AUTH_SCOPE_DENIED", "agent task not owned by session client");
    agentSessionGate(db, sess); // C71：能力降级后禁止新启动（queued/delivered→running不发生）；result保持开放
    const at = nowMs();
    if (!AGENT_TERMINAL.has(a.status) && a.expires_at_ms <= at) { agentExpireSweep(db, sess.client_rowid); return { status: 200, body: agentTaskOut(db, one(db, "SELECT * FROM agent_task WHERE id = ?", a.id), { late: true }) }; }
    run(db, "UPDATE agent_task SET status='running', started_at_ms=COALESCE(started_at_ms, ?), progress=? WHERE id=? AND status NOT IN ('succeeded','failed','cancelled','expired')", at, typeof body.note === "string" ? body.note.slice(0, 1024) : null, a.id);
    return { status: 200, body: agentTaskOut(db, one(db, "SELECT * FROM agent_task WHERE id = ?", a.id)) };
  });

  route("POST", "/v1/agent-tasks/{agentTaskId}/result", (ctx) => { const sess = ctx.sess; const params = ctx.params; const body = ctx.body;
    const a0 = one(db, "SELECT * FROM agent_task WHERE agent_task_ulid = ?", params.agentTaskId);
    if (!a0 || a0.client_rowid !== sess.client_rowid) throw new ApiError("AUTH_SCOPE_DENIED", "agent task not owned by session client");
    const at = nowMs();
    const outcomeStatus = body.outcome === "succeeded" ? "succeeded" : "failed";
    db.exec("BEGIN");
    try {
      // 幂等/迟到（同一原子事务：首写胜出；终态后上报=存档不改写，cancel_requested如实保留）
      let a = one(db, "SELECT * FROM agent_task WHERE id = ?", a0.id);
      // C71（P1复核阻塞②·到期统一裁决）：不先读哪个端点不影响同一墙钟下的结论——
      // 未终态且已过deadline的行先原子落expired，再按迟到存档处理（产物照实保留late:true）
      if (!AGENT_TERMINAL.has(a.status) && a.expires_at_ms <= at) {
        run(db, "UPDATE agent_task SET status='expired', ended_at_ms=COALESCE(ended_at_ms,?) WHERE id=? AND status NOT IN ('succeeded','failed','cancelled','expired')", at, a.id);
        a = one(db, "SELECT * FROM agent_task WHERE id = ?", a.id);
      }
      if (AGENT_TERMINAL.has(a.status)) {
        const resultJson = JSON.stringify(body.result ?? null);
        const errorVal = typeof body.error === "string" ? body.error.slice(0, 2048) : null;
        // 重放判别：终态正是由本结果构成（同载荷）→ 幂等同应答；否则为迟到存档（cancel/expired后收到的真实产物照实保留）
        const isReplay = a.result_json === resultJson && a.error === errorVal;
        if (!isReplay && a.result_json === null) run(db, "UPDATE agent_task SET result_json=?, error=? WHERE id=?", resultJson, errorVal, a.id);
        db.exec("COMMIT");
        return { status: 200, body: agentTaskOut(db, one(db, "SELECT * FROM agent_task WHERE id = ?", a.id), isReplay ? {} : { late: true }) };
      }
      const changed = run(db, "UPDATE agent_task SET status=?, ended_at_ms=?, result_json=?, error=? WHERE id=? AND status NOT IN ('succeeded','failed','cancelled','expired')",
          outcomeStatus, at, JSON.stringify(body.result ?? null), typeof body.error === "string" ? body.error.slice(0, 2048) : null, a.id).changes;
      db.exec("COMMIT");
      if (Number(changed) !== 1) return { status: 200, body: agentTaskOut(db, one(db, "SELECT * FROM agent_task WHERE id = ?", a.id), { late: true }) }; // 并发胜者已有终态
      const c = one(db, "SELECT client_ulid, last_epoch FROM client WHERE id = ?", a.client_rowid);
      try { emit(db, "client:" + c.client_ulid, c.last_epoch, "agent.task.result",
          { agentTaskId: a.agent_task_ulid, outcome: outcomeStatus }, at); } catch { /* 事件失败不回滚终态 */ }
      return { status: 200, body: agentTaskOut(db, one(db, "SELECT * FROM agent_task WHERE id = ?", a.id)) };
    } catch (e) { db.exec("ROLLBACK"); throw e; }
  });

  // --- C29持钥注销：仅本机身份操作自身——从Bearer会话解析client，绝不接受body/路径传任何身份标识 ---
  route("POST", "/v1/enrollments/revoke", ({ body, sess }) => {
    // Code security: 主体=T（revokeReceiptSession在dispatch①②③已定），schema拒一切身份标识参数
    const at = nowMs();
    const c = one(db, "SELECT * FROM client WHERE id = ?", sess.client_rowid);
    if (!c) throw new ApiError("ENROLL_ALREADY_DECIDED", "client not found for this session");
    if (c.status === "revoked") {
      // 会话主体已在dispatch①②③绑定为T，且revokeReceiptSession确保仅发起会话到达这里
      return { status: 200, body: { clientId: c.client_ulid, status: "revoked", revokedAt: toRfc3339(c.revoked_at_ms), idempotent: true } };
    }
    if (c.status !== "approved") throw new ApiError("ENROLL_ALREADY_DECIDED", "client not in approved state");
    db.exec("BEGIN");
    try {
      // B1修复：精确记录本次注销的发起会话行id——收据重放仅认这个会话（revoked_by_session）
      run(db, "UPDATE client SET status='revoked', revoked_at_ms=?, revoked_by_session=? WHERE id=?", at, sess.id, c.id);
      run(db, "UPDATE session SET revoked_at_ms=? WHERE client_rowid=?", at, c.id);
      run(db, "UPDATE challenge SET consumed_at_ms=? WHERE subject_key=? AND subject_type='client' AND consumed_at_ms IS NULL", at, c.client_ulid);
      run(db, "UPDATE enrollment SET status='revoked', decided_at_ms=COALESCE(decided_at_ms,?), reason=? WHERE client_rowid=? AND status='approved'", at, body?.reason ?? "client-self-revoked", c.id);
      emit(db, "client:" + c.client_ulid, sess.epoch, "client.revoked", { reason: body?.reason ?? "client-self-revoked" }, at);
      db.exec("COMMIT");
      return { status: 200, body: { clientId: c.client_ulid, status: "revoked", revokedAt: toRfc3339(at) } };
    } catch (e) { db.exec("ROLLBACK"); throw e; }
  });

  // --- clients admin ---
  route("GET", "/v1/clients", (ctx) => { const subj = ctx.admin(); const q = ctx.q;
    requireFields(q, ["orgId", "projectId"]);
    const org = one(db, "SELECT id FROM org WHERE org_ulid = ?", q.orgId);
    const proj = org && one(db, "SELECT id FROM project WHERE org_rowid = ? AND project_ulid = ?", org.id, q.projectId);
    if (!org || !proj) throw new ApiError("AUTH_SCOPE_DENIED", "target scope not granted");
    checkAdminScope(subj, db, org.id, proj.id);
    const page = q.page ? safeInt(Number(q.page), "page", { min: 1 }) : 1;
    const pageSize = q.pageSize ? safeInt(Number(q.pageSize), "pageSize", { min: 1, max: 200 }) : 20;
    const where = ["org_rowid = ?", "project_rowid = ?"]; const args = [org.id, proj.id];
    if (q.status) { where.push("status = ?"); args.push(q.status); }
    const rows = many(db, "SELECT * FROM client WHERE " + where.join(" AND ") + " ORDER BY granted_at_ms DESC, id DESC LIMIT ? OFFSET ?", ...args, pageSize, (page - 1) * pageSize);
    const count = one(db, "SELECT count(*) AS c FROM client WHERE " + where.join(" AND "), ...args).c;
    return { status: 200, body: { items: rows.map((c) => clientSummaryOut(db, c)), page, pageSize, nextPage: page * pageSize < count ? page + 1 : null } };
  });
  // DG142：组层级只读路由（复用/v1/clients的租户scope/分页/错误封套模式；零写）。
  route("GET", "/v1/group-levels", (ctx) => { const subj = ctx.admin(); const q = ctx.q;
    requireFields(q, ["orgId", "projectId"]);
    const org = one(db, "SELECT id FROM org WHERE org_ulid = ?", q.orgId);
    const proj = org && one(db, "SELECT id FROM project WHERE org_rowid = ? AND project_ulid = ?", org.id, q.projectId);
    if (!org || !proj) throw new ApiError("AUTH_SCOPE_DENIED", "target scope not granted");
    checkAdminScope(subj, db, org.id, proj.id);
    const page = q.page ? safeInt(Number(q.page), "page", { min: 1 }) : 1;
    const pageSize = q.pageSize ? safeInt(Number(q.pageSize), "pageSize", { min: 1, max: 200 }) : 20;
    return { status: 200, body: listGroupLevels(db, org.id, proj.id, { page, pageSize }) };
  });

  route("GET", "/v1/clients/{clientId}", (ctx) => { const subj = ctx.admin(); const params = ctx.params;
    const c = resolveClient(db, params.clientId, subj);
    return { status: 200, body: clientSummaryOut(db, c) };
  });

  // --- events (authz: own stream for client session; admin scope for org/project streams) ---
  function streamAuthz({ bearer, q }) {
    const stream = q.stream;
    if (!stream || !STREAM_RE.test(stream)) throw vErr("stream must match client|org|project:{ULID}");
    const [kind, id] = stream.split(":");
    if (kind === "client") {
      // 优先会话准入（§2.1①）；会话不可用（未携带/失效/客户端已吊销）时允许管理面审计读取：
      // Code security: Select模式——管理主体scope必须覆盖该client的org/project，否则403（不泄存在性）
      if (bearer) {
        const sess = one(db, `
          SELECT se.id, se.epoch, se.token_hash, se.client_rowid, se.lease_expires_at_ms, se.revoked_at_ms,
                 c.client_ulid, c.status AS client_status, c.last_epoch, c.org_rowid, c.project_rowid, c.valid_until_ms
          FROM session se JOIN client c ON c.id = se.client_rowid WHERE se.token_hash = ?`, sha256b64(bearer));
        if (sess) {
          if (sess.client_ulid !== id) throw new ApiError("AUTH_SCOPE_DENIED", "stream not owned by session");
          if (sess.client_status === "revoked") throw new ApiError("AUTH_REVOKED", "client revoked");
          if (sess.valid_until_ms <= Date.now()) throw new ApiError("AUTH_REVOKED", "client expired"); // C8 R3
          if (sess.revoked_at_ms !== null || sess.epoch !== sess.last_epoch) throw new ApiError("AUTH_TOKEN_INVALID", "session superseded");
          if (sess.lease_expires_at_ms <= Date.now()) throw new ApiError("AUTH_TOKEN_INVALID", "session lease expired");
          return { kind, sess };
        }
      }
      const subj = adminSubject(db, bearer);
      const c = one(db, "SELECT org_rowid, project_rowid FROM client WHERE client_ulid = ?", id);
      if (!c) throw new ApiError("AUTH_SCOPE_DENIED", "stream not granted");
      checkAdminScope(subj, db, c.org_rowid, c.project_rowid);
      return { kind, subj, adminOf: id };
    }
    const subj = adminSubject(db, bearer);
    const rowids = { org: one(db, "SELECT id FROM org WHERE org_ulid = ?", id), project: one(db, "SELECT p.id, p.org_rowid FROM project p JOIN org o ON o.id = p.org_rowid WHERE p.project_ulid = ?", id) };
    if (kind === "org") { if (!rowids.org) checkAdminOrgScope(subj, db, -1); else checkAdminOrgScope(subj, db, rowids.org.id); } // C8 R4：仅org级grant
    else { if (!rowids.project) checkAdminScope(subj, db, -1); else checkAdminScope(subj, db, rowids.project.org_rowid, rowids.project.id); }
    return { kind, subj };
  }
  function eventOut(e, streamKey) {
    return { eventId: e.event_ulid, stream: streamKey, seq: e.seq, epoch: e.epoch, type: e.type, data: JSON.parse(e.data_json), occurredAt: toRfc3339(e.occurred_at_ms) };
  }

  route("GET", "/v1/events", ({ bearer, q }) => {
    const { kind } = streamAuthz({ bearer, q });
    const since = q.sinceSeq ? safeInt(Number(q.sinceSeq), "sinceSeq") : 0;
    const limit = q.limit ? safeInt(Number(q.limit), "limit", { min: 1, max: 1000 }) : 1000;
    const s = one(db, "SELECT id, low_watermark_seq FROM stream WHERE stream_key = ?", q.stream);
    if (!s) return { status: 200, body: { events: [], snapshotSeq: 1, hasMore: false } };
    const rows = many(db, "SELECT * FROM event WHERE stream_rowid = ? AND seq > ? ORDER BY seq LIMIT ?", s.id, since, limit + 1);
    const hasMore = rows.length > limit;
    return { status: 200, body: { events: rows.slice(0, limit).map((e) => eventOut(e, q.stream)), snapshotSeq: s.low_watermark_seq, hasMore } };
  });

  route("GET", "/v1/events/snapshot", ({ bearer, q }) => {
    const { kind } = streamAuthz({ bearer, q });
    const limit = q.limit ? safeInt(Number(q.limit), "limit", { min: 1, max: 1000 }) : 1000;
    const since = q.sinceSeq !== undefined ? safeInt(Number(q.sinceSeq), "sinceSeq") : null;
    let state = null; let events = []; let snapshotSeq = 1; let hasMore = false; let stateInstalledSeq = 0;
    // 快照=同一只读事务：state/低水位/保留窗同拍（§5.3.1一致性边界）；翻页按"最后已见"严格大于续拉
    db.exec("BEGIN");
    try {
      const s = one(db, "SELECT id, low_watermark_seq, next_seq FROM stream WHERE stream_key = ?", q.stream);
      if (kind === "client") {
        const [_, cuid] = q.stream.split(":");
        const c = one(db, "SELECT * FROM client WHERE client_ulid = ?", cuid);
        if (c) { const sum = clientSummaryOut(db, c); state = { clientId: sum.clientId, status: sum.status, online: sum.online, lastEpoch: c.last_epoch, lastHeartbeatAt: sum.lastHeartbeatAt, leaseExpiresAt: sum.leaseExpiresAt, validUntil: sum.validUntil, occupancy: sum.occupancy }; }
      }
      if (s) {
        snapshotSeq = s.low_watermark_seq;
        stateInstalledSeq = s.next_seq - 1; // C8 R5：安装水位——state已包含效果的最高seq（读事务同拍）
        const afterSeq = since !== null ? since : snapshotSeq - 1; // 首页=保留窗起点；续页=严格大于
        const rows = many(db, "SELECT * FROM event WHERE stream_rowid = ? AND seq > ? ORDER BY seq LIMIT ?", s.id, afterSeq, limit + 1);
        hasMore = rows.length > limit;
        events = rows.slice(0, limit).map((e) => eventOut(e, q.stream));
      }
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
    return { status: 200, body: { stream: q.stream, state, stateInstalledSeq, events, snapshotSeq, hasMore } };
  });

  route("POST", "/v1/events/ack", ({ body, bearer }) => {
    requireFields(body, ["stream", "lastSeq", "sessionId", "epoch"]);
    const sess = currentSession(db, bearer);
    assertBodySession(sess, body);
    const m = STREAM_RE.exec(body.stream);
    if (!m || m[1] !== "client") throw vErr("only client streams are ackable");
    if (m[2] !== sess.client_ulid) throw new ApiError("AUTH_SCOPE_DENIED", "stream not owned by session");
    safeInt(body.lastSeq, "lastSeq", { min: 1 });
    const s = one(db, "SELECT id, next_seq FROM stream WHERE stream_key = ?", body.stream);
    const maxSeq = s ? s.next_seq - 1 : 0;
    if (body.lastSeq > maxSeq) throw vErr("ack beyond emitted maxSeq", { maxSeq }); // 超前ack→422
    const at = nowMs();
    if (!s) { getOrCreateStream(db, body.stream, at); }
    // Code security: UPSERT 由触发器I7'/I8约束——仅同client更高epoch未作废会话可接管，水位取max不回退
    run(db, "INSERT INTO event_ack(stream_rowid, session_rowid, acked_seq, updated_at_ms) VALUES ((SELECT id FROM stream WHERE stream_key = ?), (SELECT id FROM session WHERE token_hash = ?), ?, ?) ON CONFLICT(stream_rowid) DO UPDATE SET session_rowid = excluded.session_rowid, acked_seq = max(event_ack.acked_seq, excluded.acked_seq), updated_at_ms = excluded.updated_at_ms",
        body.stream, sess.token_hash, body.lastSeq, at);
    const acked = one(db, "SELECT acked_seq FROM event_ack WHERE stream_rowid = (SELECT id FROM stream WHERE stream_key = ?)", body.stream).acked_seq;
    return { status: 200, body: { stream: body.stream, ackedSeq: acked } };
  });

  // ---------- dispatch ----------
  return function dispatch(method, url, { headers = {}, body = null, query = null } = {}) {
    const path = url.split("?")[0];
    let query2 = Object.assign({}, query);
    if (!query && url.includes("?")) { query2 = Object.fromEntries(new URLSearchParams(url.split("?")[1])); }
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.rx.exec(path);
      if (!m) continue;
      const params = {}; r.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
      const ctx = {
        params, body: body ?? {}, q: query2, headers, bearer: parseBearer(headers), db,
        admin: () => adminSubject(db, parseBearer(headers)), // 管理端点显式加载自身鉴权主体
      };
      const cv = { "X-Solopi-Contract-Version": CONTRACT_VERSION };
      try {
        // C8 R2：准入顺序＝鉴权①→请求Schema（§4语义层422）→业务；Schema在挑战消费/写入前拒绝
        if (r.opt.auth === "admin") { const subj = adminSubject(db, ctx.bearer); assertAdminRole(method, r.pattern, subj); } // W25 gate：operator白名单外403
        if (r.opt.auth === "session") { ctx.sess = currentSession(db, ctx.bearer); assertBodySession(ctx.sess, ctx.body); }
        // C101（7116276顺序回退修复）：组投影POST的真实Client会话+归属Check**前置于schema**——
        // 匿名/坏token/跨Client对坏封套也必须先按准入判决（401/403），不以schema 422吞掉未授权探针；
        // 与 handler 内的 groupSession186 语义同源（见下 handler 定义），handler 保留为二次守卫。
        if (r.opt.groupSession && (method === "POST")) groupRouteAdmission(db, ctx);
        if (r.opt.auth === "revoke") { ctx.sess = revokeReceiptSession(db, ctx.bearer, ctx.body); }
        if (r.opt.req) {
          const errs = validateRef(r.opt.req, ctx.body);
          if (errs) return { status: 422, headers: cv, body: { error: { code: "VALIDATION_FAILED", message: "request violates binding schema", retryable: false, details: { errors: errs.slice(0, 20) } } } };
        }
        const out = r.handler(ctx);
        if (r.opt.resp?.[out.status]) {
          const errs = validateRef(r.opt.resp[out.status], out.body);
          if (errs) { // 响应也受绑定Schema约束；实现bug兜底不外发不合法JSON
            console.error("schema violation in response:", JSON.stringify(errs));
            return { status: 500, headers: cv, body: { error: { code: "INTERNAL", message: "internal error", retryable: true } } };
          }
        }
        return { status: out.status, headers: cv, body: out.body };
      } catch (e) {
        if (e instanceof ApiError) return { status: e.status, headers: { "X-Solopi-Contract-Version": CONTRACT_VERSION }, body: e.body(e.retryable === true || e.extra?.retryable === true) };
        const ve = Object.values(e).length, isValidation = e.message?.startsWith("invalid integer") || e.message?.startsWith("missing field");
        if (isValidation) return { status: 422, headers: { "X-Solopi-Contract-Version": CONTRACT_VERSION }, body: { error: { code: "VALIDATION_FAILED", message: e.message, retryable: false } } };
        console.error("[internal]", e?.constructor?.name ?? "unknown", e?.code ?? "-"); // DG112：受控错误类别——不落原始stack/message/payload（7124199红③闭环）
        return { status: 500, headers: { "X-Solopi-Contract-Version": CONTRACT_VERSION }, body: { error: { code: "INTERNAL", message: "internal error", retryable: true } } };
      }
    }
    return { status: 404, headers: { "X-Solopi-Contract-Version": CONTRACT_VERSION }, body: { error: { code: "VALIDATION_FAILED", message: "no such route", retryable: false, details: { path } } } };
  };
}
