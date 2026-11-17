// SoloPi Lab Server — 组派发请求账本模块候选 r3（DG107 7122976 精确报告的下一最小闭环）。
// 权威边界（v0.4.0 §0 不变）：Desktop 仍是组配置与组执行唯一正式写者。本账本只登记派发请求、在
// 同一 BEGIN IMMEDIATE 事务内发布持久派发事件、绑定请求时成员快照摘要，并以"未终态待办视图"
// 提供与事件 retention 无关的对账恢复。不写回组配置、不自动重派、不复制执行真相。
// r3 关键语义（响应 DG107§1—§4）：
//   §1 账本/事件同事务：createGroupDispatch / requestDispatchCancel 在同一事务内 appendEvent 到既有
//      `client:<clientUlid>` 持久事件流（stream/seq/epoch 沿用现事件外壳）；事件失败=整事务回滚。
//      【接线注意】事件 epoch=路由层注入的会话真实 epoch；模块缺省 1 仅供隔离回归（DG106 复放兼容），
//      生产接线必须显式传入，不得依赖缺省。
//   §2 request 级持久取消：cancel_requested_at 在账本层持久（先于任何 prepared 也保留）；
//      dispatchToClientWire 输出携带取消标记——取消早到即在 run 输入层送达，Desktop 消费者在
//      native prepare 前先持久取消意图并据此拒入（合同 §4B），不依赖"下轮心跳/用户再取消"。
//   §3 分域摘要：dispatchPlanSha256=sha256(canon({groupId,expectedRevision,requestId,payload}))，
//      【不含 taskId】；nativePlanSha256 属端侧 DG1 定义（含 taskId）——两域绝不互换比较；
//      payloadSha256/UTF8 payloadBytes 随 run 输出供端侧收件校验。
//   §4 不可变成员快照绑定：创建时绑定当时注册投影成员摘要 member_sha256；确认绑定时投影快照成员
//      摘要必须一致（同组同 revision 异成员 prepared 拒绝）。Desktop 仍以本地 CAS+不可变快照承载
//      serial/sourceIdentity 可信性——Server 只绑定成员集摘要，不复制其权威。
// 接线边界：本候选独立可测（路由/鉴权/schema 绑定未接）；v0.4.0 冻结载荷零改动；0012 为唯一合同负责人
// 给出的精确增量迁移（0011 字节不变）。typed payload 封套=服务端拒绝边界（非 cases/steps 语义冻结）。
// Code security: 全部 SQL 参数化；session（T）由路由层注入，wire 内身份字段为 U 并与 T 比对（Check）
// 或以归属列入 SQL（Select）后方可进任何 sink；事件 data 域不写任何 serial/指纹/凭据。
import { ApiError } from "./util.mjs";
import { appendEvent } from "./db.mjs";
import { createHash, randomUUID } from "node:crypto";

const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const UUIDV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL = new Set(["done", "cancelled"]);
const MAX_PAYLOAD_BYTES = 262144; // canonical UTF-8 实测字节上限（r2 已定，r3 不变）
const MAX_CASES = 512, MAX_STEPS = 512, MAX_ID_BYTES = 128;

function derr(code, message) { return new ApiError(code, message); }
function canon(value) {
  const visit = (v) => {
    if (v === null || typeof v === "string" || typeof v === "boolean") return v;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (Array.isArray(v)) return v.map(visit);
    if (v && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, visit(v[k])]));
    throw derr("GROUP_INVALID", "JSON values required");
  };
  return JSON.stringify(visit(value));
}
function allowKeys(obj, keys, where) {
  if (!obj || Object.getPrototypeOf(obj) !== Object.prototype) throw derr("GROUP_INVALID", where + " must be a JSON object");
  for (const k of Object.keys(obj)) if (!keys.includes(k)) throw derr("GROUP_INVALID", `field not allowed in ${where}: ${k}`);
}
function intAtLeast(v, name, min) { if (!Number.isSafeInteger(v) || v < min) throw derr("GROUP_INVALID", `${name} (>=${min}) required`); return v; }
function sha256Of(text) { return createHash("sha256").update(text).digest("hex"); }
function utf8(canonText) { return Buffer.byteLength(canonText, "utf8"); }
// 请求成员集摘要：成员按 deviceId 排序、清理为 {deviceId,role}（与冻结注册/执行投影同清洗口径）
function memberDigest(members) {
  const clean = members.map((m) => ({ deviceId: m.deviceId, role: m.role })).sort((a, b) => a.deviceId.localeCompare(b.deviceId));
  return sha256Of(canon(clean));
}

// §D1 表结构：0011 主体 + 0012 增量（member_sha 绑定列+专用不可变触发器+pending索引）。迁移链
// 0001…0012 与本 ensure 同构（隔离回归断言：列集+触发器/索引集）；0011 字节不变，0012 为精确增量。
export function ensureGroupDispatchSchema(db) {
  db.exec([
    "CREATE TABLE IF NOT EXISTS group_dispatch (",
    "  dispatch_uid TEXT PRIMARY KEY, client_ulid TEXT NOT NULL, group_uid TEXT NOT NULL,",
    "  request_uid TEXT NOT NULL UNIQUE,",
    "  group_revision INTEGER NOT NULL CHECK (typeof(group_revision)='integer' AND group_revision>=1),",
    "  plan_sha TEXT NOT NULL, payload_sha TEXT NOT NULL,",
    "  payload_bytes INTEGER NOT NULL CHECK (typeof(payload_bytes)='integer' AND payload_bytes>=0),",
    "  status TEXT NOT NULL CHECK (status IN ('requested','confirmed','dispatching','unknown','done','cancelled')),",
    "  cancel_requested_at TEXT, task_uid TEXT, confirmed_at TEXT, terminal_at TEXT, terminal_outcome TEXT, late_result TEXT,",
    "  dispatch_wire TEXT NOT NULL,",
    "  member_sha TEXT,",
    "  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms)='integer'),",
    "  updated_at_ms INTEGER NOT NULL CHECK (typeof(updated_at_ms)='integer'));",
    "CREATE TRIGGER IF NOT EXISTS group_dispatch_immutable BEFORE UPDATE ON group_dispatch",
    " WHEN NEW.dispatch_uid IS NOT OLD.dispatch_uid OR NEW.client_ulid IS NOT OLD.client_ulid",
    "  OR NEW.group_uid IS NOT OLD.group_uid OR NEW.request_uid IS NOT OLD.request_uid",
    "  OR NEW.group_revision IS NOT OLD.group_revision OR NEW.plan_sha IS NOT OLD.plan_sha",
    "  OR NEW.payload_sha IS NOT OLD.payload_sha OR NEW.payload_bytes IS NOT OLD.payload_bytes",
    "  OR json_extract(NEW.dispatch_wire,'$.groupId') IS NOT json_extract(OLD.dispatch_wire,'$.groupId')",
    "  OR json_extract(NEW.dispatch_wire,'$.requestId') IS NOT json_extract(OLD.dispatch_wire,'$.requestId')",
    "  OR json_extract(NEW.dispatch_wire,'$.payload') IS NOT json_extract(OLD.dispatch_wire,'$.payload')",
    " BEGIN SELECT RAISE(ABORT,'GROUP_DISPATCH_IMMUTABLE'); END;",
    "CREATE INDEX IF NOT EXISTS idx_group_dispatch_by_client ON group_dispatch(client_ulid, group_uid);",
    // DG108红①闭合：member_sha 由专用不可变触发器保护（与0012同DDL字节）——真实0011非空库升级路径上
    // 既有触发器不会被 IF NOT EXISTS 重定义，篡改成员摘要必须由本守卫显式拒绝；旧行 NULL 不补写。
    "CREATE TRIGGER IF NOT EXISTS group_dispatch_member_immutable BEFORE UPDATE ON group_dispatch",
    " WHEN NEW.member_sha IS NOT OLD.member_sha",
    " BEGIN SELECT RAISE(ABORT,'GROUP_DISPATCH_IMMUTABLE'); END;",
    "CREATE INDEX IF NOT EXISTS idx_group_dispatch_pending ON group_dispatch(client_ulid, status, created_at_ms);",
  ].join("\n"));
}

// §D2 typed payload 封套（服务端拒绝边界）：payload 只接受 {cases:[{id,steps:[…]}]}——
// case.id 1..128 UTF-8 字节、steps 为 JSON 对象数组（≤512 项；步骤内部结构不加语义解释，
// 语义/宿主命令 schema 与审批属端侧步骤合同，见草案§4C）。任意 JSON、"创建即受理"不再成立：
// 本封装之外的一切形状在服务端即拒，绝不进入派发事件。
function validatePayloadEnvelope(payload) {
  allowKeys(payload, ["cases"], "payload");
  if (!Array.isArray(payload.cases) || payload.cases.length < 1 || payload.cases.length > MAX_CASES)
    throw derr("GROUP_INVALID", `payload.cases must be an array of 1..${MAX_CASES} cases`);
  for (const c of payload.cases) {
    if (!c || Object.getPrototypeOf(c) !== Object.prototype) throw derr("GROUP_INVALID", "case must be a JSON object");
    allowKeys(c, ["id", "steps"], "case"); // 封套期白名单：语义字段冻结前不收键值夹带
    if (typeof c.id !== "string" || c.id.length < 1 || utf8(c.id) > MAX_ID_BYTES) throw derr("GROUP_INVALID", `case.id must be 1..${MAX_ID_BYTES} UTF-8 bytes`);
    if (!Array.isArray(c.steps) || c.steps.length > MAX_STEPS) throw derr("GROUP_INVALID", `case.steps must be an array of <=${MAX_STEPS} entries`);
    for (const s of c.steps) if (!s || Object.getPrototypeOf(s) !== Object.prototype) throw derr("GROUP_INVALID", "step entries must be JSON objects");
  }
}

// §D2 派发请求白名单校验：clientId/groupId/requestId/expectedRevision/payload——身份/凭据/摘要上送
// 字段一律拒（payloadShа256 等由服务端自算）；载荷限幅按 canonical UTF-8 实际字节（r2 语义保留）。
export function validateDispatchRequest(wire) {
  allowKeys(wire, ["clientId", "groupId", "requestId", "expectedRevision", "payload"], "group dispatch request");
  if (!ULID.test(String(wire.clientId ?? ""))) throw derr("GROUP_INVALID", "clientId must be Desktop ULID");
  if (!UUIDV4.test(String(wire.groupId ?? ""))) throw derr("GROUP_INVALID", "groupId must be UUIDv4");
  if (!UUIDV4.test(String(wire.requestId ?? ""))) throw derr("GROUP_INVALID", "requestId must be UUIDv4");
  intAtLeast(wire.expectedRevision, "expectedRevision", 1);
  if (!wire.payload || Object.getPrototypeOf(wire.payload) !== Object.prototype) throw derr("GROUP_INVALID", "payload object required");
  validatePayloadEnvelope(wire.payload);
  const payloadCanonical = canon(wire.payload);
  const payloadBytes = utf8(payloadCanonical);
  if (payloadBytes > MAX_PAYLOAD_BYTES) throw derr("GROUP_INVALID", `payload canonical size <= ${MAX_PAYLOAD_BYTES} UTF-8 bytes required (got ${payloadBytes})`);
  return {
    clientId: wire.clientId, groupId: wire.groupId, requestId: wire.requestId, expectedRevision: wire.expectedRevision,
    payload: JSON.parse(payloadCanonical), payloadCanonical, payloadBytes,
  };
}

// §D3 创建派发请求（账本+持久事件同一 BEGIN IMMEDIATE 事务）：
//   * 消费恢复不以事件为唯一途径——group_dispatch 表本身是可对账积压（见 listPendingGroupDispatches）；
//   * 归属/幂等/竞态语义同 r2（Check+Select+plan_sha 精确重放幂等/异计划冲突）；
//   * 新增：member_sha256 请求时成员快照绑定（0012 列）+ 事务内事件发布。
export function createGroupDispatch(db, wire, session) {
  if (!session || Object.getPrototypeOf(session) !== Object.prototype || !ULID.test(String(session.clientUlid ?? "")))
    throw derr("GROUP_INVALID", "trusted session clientId required"); // Code security: 身份来源必须是路由层注入的会话主体
  const v = validateDispatchRequest(wire);
  if (v.clientId !== session.clientUlid) throw derr("GROUP_OWNER_MISMATCH", "dispatch target must be the session owner");
  const planSha = sha256Of(canon({ groupId: v.groupId, expectedRevision: v.expectedRevision, requestId: v.requestId, payload: v.payload })); // 分域：不含 taskId
  const payloadSha = sha256Of(v.payloadCanonical);
  const at = Date.now();
  const eventEpoch = Number.isSafeInteger(session.epoch) ? session.epoch : 1; // 接线必须注入真实会话 epoch（缺省 1 仅隔离回归）
  const exec = db.exec.bind(db);
  exec("BEGIN IMMEDIATE");
  try {
    const out = createGroupDispatchTx(db, { v, planSha, payloadSha, at, eventEpoch });
    exec("COMMIT");
    return out;
  } catch (e) { try { exec("ROLLBACK"); } catch { /* already rolled back */ } throw e; }
}
function createGroupDispatchTx(db, { v, planSha, payloadSha, at, eventEpoch }) {
  const prior = db.prepare("SELECT * FROM group_dispatch WHERE request_uid=?").get(v.requestId);
  if (prior) {
    if (prior.plan_sha !== planSha || prior.client_ulid !== v.clientId || prior.group_uid !== v.groupId || prior.group_revision !== v.expectedRevision)
      throw derr("GROUP_EXECUTION_CONFLICT", "requestId already bound to a different dispatch plan");
    return { dispatchId: prior.dispatch_uid, requestId: prior.request_uid, accepted: true, replay: true, status: prior.status };
  }
  const reg = db.prepare("SELECT revision, deleted, body FROM group_registration WHERE client_ulid=? AND group_uid=?").get(v.clientId, v.groupId);
  if (!reg) throw derr("GROUP_NOT_FOUND", "group registration must exist before dispatch request");
  if (reg.deleted === 1) throw derr("GROUP_NOT_FOUND", "group is deleted");
  if (reg.revision !== v.expectedRevision)
    throw derr("GROUP_REVISION_CONFLICT", `dispatch expectedRevision ${v.expectedRevision} != registered revision ${reg.revision}`);
  const members = JSON.parse(reg.body).members;
  const memberSha = memberDigest(members); // 请求时绑定成员集摘要；历史快照不因后续登记演进而被覆盖比对
  const dispatchUid = randomUUID();
  const dispatchWire = canon({
    groupId: v.groupId, expectedRevision: v.expectedRevision, requestId: v.requestId, payload: v.payload,
  });
  // 显式列名：迁移链(0012 ALTER把member_sha追加至列尾)与ensure直建列序不同，位置式INSERT不可移植
  db.prepare("INSERT INTO group_dispatch (dispatch_uid, client_ulid, group_uid, request_uid, group_revision, plan_sha, payload_sha, payload_bytes, status, cancel_requested_at, task_uid, confirmed_at, terminal_at, terminal_outcome, late_result, dispatch_wire, member_sha, created_at_ms, updated_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(dispatchUid, v.clientId, v.groupId, v.requestId, v.expectedRevision, planSha, payloadSha, v.payloadBytes,
      "requested", null, null, null, null, null, null, dispatchWire, memberSha, at, at);
  // 同事务事件：发布面沿既有 client:<uid> 持久事件流外壳；data 不含 serial/指纹/凭据
  appendEvent(db, "client:" + v.clientId, eventEpoch, "group.dispatch.requested", {
    dispatchId: dispatchUid, requestId: v.requestId, clientId: v.clientId, groupId: v.groupId, expectedRevision: v.expectedRevision,
    payload: v.payload, payloadSha256: payloadSha, payloadBytes: v.payloadBytes,
    dispatchPlanSha256: planSha, memberSha256: memberSha, requestedAtMs: at,
  }, at);
  return { dispatchId: dispatchUid, requestId: v.requestId, accepted: true, replay: false, status: "requested" };
}

// §D4 request 级持久取消（先持久首写、终态不擦除、事务内发布取消事件——取消早到即在事件面可见，
// 端侧消费者可在 native prepare 前登记意图；重驱不靠本事件"送达成功"——未终态视图恒可恢复）。
export function requestDispatchCancel(db, { clientId, requestId }, session) {
  if (!session || !ULID.test(String(session.clientUlid ?? ""))) throw derr("GROUP_INVALID", "trusted session clientId required");
  if (!ULID.test(String(clientId ?? "")) || !UUIDV4.test(String(requestId ?? ""))) throw derr("GROUP_INVALID", "clientId ULID + requestId UUIDv4 required");
  if (clientId !== session.clientUlid) throw derr("GROUP_OWNER_MISMATCH", "cancel must target the session owner dispatch"); // Code security: U 与 T 比对
  const at = Date.now();
  const eventEpoch = Number.isSafeInteger(session.epoch) ? session.epoch : 1;
  const exec = db.exec.bind(db);
  exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT * FROM group_dispatch WHERE request_uid=?").get(requestId);
    if (!row || row.client_ulid !== clientId) throw derr("GROUP_NOT_FOUND", "dispatch request not found");
    let out;
    if (TERMINAL.has(row.status))
      out = { dispatchId: row.dispatch_uid, accepted: false, status: row.status, terminal: true, cancelRequestedAt: row.cancel_requested_at };
    else if (row.cancel_requested_at)
      out = { dispatchId: row.dispatch_uid, accepted: true, replay: true, cancelRequestedAt: row.cancel_requested_at }; // 首写保留
    else {
      const atIso = new Date().toISOString();
      db.prepare("UPDATE group_dispatch SET cancel_requested_at=?, updated_at_ms=? WHERE request_uid=?").run(atIso, at, requestId);
      appendEvent(db, "client:" + clientId, eventEpoch, "group.dispatch.cancel-requested", {
        dispatchId: row.dispatch_uid, requestId, clientId, cancelRequestedAt: atIso,
      }, at);
      out = { dispatchId: row.dispatch_uid, accepted: true, replay: false, cancelRequestedAt: atIso };
    }
    exec("COMMIT");
    return out;
  } catch (e) { try { exec("ROLLBACK"); } catch { /* already rolled back */ } throw e; }
}

// §D5 对账（确认绑定/状态镜像/迟结果）：以冻结投影行为唯一事实；r3 新增成员摘要守卫——
//   投影快照成员摘要必须等于请求时绑定的 member_sha256（同组同 revision 异成员拒绝，零写不绑 task）。
export function reconcileGroupDispatch(db, { clientId, requestId }, session) {
  if (!session || !ULID.test(String(session.clientUlid ?? ""))) throw derr("GROUP_INVALID", "trusted session clientId required");
  if (!ULID.test(String(clientId ?? "")) || !UUIDV4.test(String(requestId ?? ""))) throw derr("GROUP_INVALID", "clientId ULID + requestId UUIDv4 required");
  if (clientId !== session.clientUlid) throw derr("GROUP_OWNER_MISMATCH", "reconcile must target the session owner dispatch"); // Code security: U 与 T 比对
  const at = Date.now();
  const exec = db.exec.bind(db);
  exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT * FROM group_dispatch WHERE request_uid=?").get(requestId);
    if (!row || row.client_ulid !== clientId) throw derr("GROUP_NOT_FOUND", "dispatch request not found"); // Select归属列
    const out = reconcileTx(db, { row, at });
    exec("COMMIT");
    return out;
  } catch (e) { try { exec("ROLLBACK"); } catch { /* already rolled back */ } throw e; }
}
function reconcileTx(db, { row, at }) {
  const original = { ...row }; // DB读出时的原始行快照（applyDispatchUpdate键过滤基准）
  row.__original = original;
  const proj = db.prepare("SELECT * FROM group_execution_projection WHERE request_uid=? AND client_ulid=?").get(row.request_uid, row.client_ulid);
  if (proj && (proj.group_uid !== row.group_uid || proj.group_revision !== row.group_revision))
    throw derr("GROUP_EXECUTION_CONFLICT", `execution projection snapshot ${proj.group_uid}@${proj.group_revision} does not belong to dispatch request ${row.group_uid}@${row.group_revision}`);
  let status = row.status;
  const sets = { updated_at_ms: at };
  if (proj) {
    const projBody = JSON.parse(proj.body);
    // 成员快照绑定守卫（DG107§4 红例）：同组同 revision 异成员的 prepared 不得确认本派发。
    // 成员可信性的 serial/sourceIdentity 维度仍由 Desktop 本地 CAS+不可变快照承担（本账不复制）。
    if (memberDigest(projBody.groupSnapshot.members) !== row.member_sha)
      throw derr("GROUP_EXECUTION_CONFLICT", "execution projection member snapshot differs from the request-bound member digest");
    if (row.task_uid && proj.task_uid !== row.task_uid)
      throw derr("GROUP_EXECUTION_CONFLICT", "dispatch taskId binding differs from projection");
    if (!row.task_uid) { sets.task_uid = proj.task_uid; sets.confirmed_at = new Date().toISOString(); row.task_uid = proj.task_uid; }
    if (TERMINAL.has(row.status)) {
      if (proj.phase === "done" && projBody.receipt && projBody.receipt.outcome !== row.terminal_outcome)
        throw derr("GROUP_EXECUTION_CONFLICT", "projection terminal outcome differs from registered dispatch terminal");
    } else if (proj.phase === "done") {
      const outcome = projBody.receipt.outcome;
      sets.terminal_at = new Date().toISOString();
      sets.terminal_outcome = outcome;
      status = outcome === "cancelled" ? "cancelled" : "done";
      if (row.cancel_requested_at && outcome !== "cancelled") sets.late_result = `terminal ${outcome} after cancel intent`;
    } else {
      status = proj.phase === "prepared" ? "confirmed" : proj.phase;
    }
    sets.status = status;
  }
  applyDispatchUpdate(db, row.dispatch_uid, sets, row);
  return { dispatchId: row.dispatch_uid, requestId: row.request_uid, status, terminal: TERMINAL.has(status), taskUid: row.task_uid ?? null, projectionSeen: !!proj };
}
function applyDispatchUpdate(db, dispatchUid, sets, row) {
  // DG112：keys必须以进入事务前的原始行快照为基准过滤——reconcileTx 会先动 row.task_uid，
  // 若用已在内存中被修改过的 row 过滤，task_uid 会被误判为"无变化"而永不落库（实测红：status=confirmed 且 task_uid=NULL）。
  const baseline = row.__original ?? row;
  const keys = Object.keys(sets).filter((k) => sets[k] !== undefined && baseline[k] !== sets[k]);
  if (!keys.length) return; // 精确重放幂等：无可变列即零写
  const sql = `UPDATE group_dispatch SET ${keys.map((k) => `${k}=?`).join(", ")} WHERE dispatch_uid=?`;
  // Code security: keys只来自本文件白名单列名，值全部参数化——列名拼接无外部输入
  db.prepare(sql).run(...keys.map((k) => sets[k]), dispatchUid);
}

// §D6 未终态待办视图（与事件 retention 无关的恢复对账面）：断线/retention gap 后客户端按此全量重导；
//   非终态行含取消标记与分域摘要——取消意图可再取、重驱停止由端侧据标记执行（不靠事件"尽力送达"）。
//   游标=(lastCreatedMs,lastDispatchUid) 双元组，分页按创建序推进。
export function listPendingGroupDispatches(db, { clientId, afterCreatedMs, afterDispatchUid, limit = 50 }, session) {
  if (!session || !ULID.test(String(session.clientUlid ?? ""))) throw derr("GROUP_INVALID", "trusted session clientId required");
  if (!ULID.test(String(clientId ?? ""))) throw derr("GROUP_INVALID", "clientId U required");
  if (clientId !== session.clientUlid) throw derr("GROUP_OWNER_MISMATCH", "pending view must target the session owner"); // Code security: U 与 T 比对
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw derr("GROUP_INVALID", "limit 1..200 required");
  let sql = "SELECT * FROM group_dispatch WHERE client_ulid=? AND status IN ('requested','confirmed','dispatching','unknown')";
  const args = [clientId];
  if (afterCreatedMs !== undefined && afterDispatchUid !== undefined) {
    if (!Number.isSafeInteger(afterCreatedMs) || !UUIDV4.test(String(afterDispatchUid ?? ""))) throw derr("GROUP_INVALID", "cursor must be {afterCreatedMs, afterDispatchUid}");
    sql += " AND (created_at_ms > ? OR (created_at_ms = ? AND dispatch_uid > ?))";
    args.push(afterCreatedMs, afterCreatedMs, afterDispatchUid);
  } else if (afterCreatedMs !== undefined || afterDispatchUid !== undefined) {
    throw derr("GROUP_INVALID", "cursor must carry both afterCreatedMs and afterDispatchUid");
  }
  const rows = db.prepare(sql + " ORDER BY created_at_ms, dispatch_uid LIMIT ?").all(...args, limit);
  return {
    items: rows.map((r) => ({
      ...toDispatchView(r),
      clientWire: wireOut(JSON.parse(r.dispatch_wire), r),
    })),
    nextCursor: rows.length === limit
      ? { afterCreatedMs: rows[rows.length - 1].created_at_ms, afterDispatchUid: rows[rows.length - 1].dispatch_uid } : null,
  };
}

export function getGroupDispatch(db, clientId, requestId) {
  if (!ULID.test(String(clientId ?? "")) || !UUIDV4.test(String(requestId ?? ""))) throw derr("GROUP_INVALID", "clientId ULID + requestId UUIDv4 required");
  const r = db.prepare("SELECT * FROM group_dispatch WHERE client_ulid=? AND request_uid=?").get(clientId, requestId);
  return r ? { ...toDispatchView(r), bodyCanonical: r.dispatch_wire } : null;
}
export function listGroupDispatches(db, clientId) {
  if (!ULID.test(String(clientId ?? ""))) throw derr("GROUP_INVALID", "clientId must be Desktop ULID");
  return db.prepare("SELECT * FROM group_dispatch WHERE client_ulid=? ORDER BY request_uid").all(clientId).map(toDispatchView);
}
function toDispatchView(r) {
  return {
    dispatchId: r.dispatch_uid, clientId: r.client_ulid, groupId: r.group_uid, requestId: r.request_uid,
    expectedRevision: r.group_revision, payloadSha256: r.payload_sha, payloadBytes: r.payload_bytes,
    // 分域命名（DG107§3）：dispatch 摘要不与 native plan_sha（含 taskId）混用
    dispatchPlanSha256: r.plan_sha, memberSha256: r.member_sha,
    status: r.status, cancelRequestedAt: r.cancel_requested_at, taskUid: r.task_uid, confirmedAt: r.confirmed_at,
    terminalAt: r.terminal_at, terminalOutcome: r.terminal_outcome, lateResult: r.late_result,
    createdAtMs: r.created_at_ms, updatedAtMs: r.updated_at_ms,
  };
}
function wireOut(base, r) {
  return {
    groupId: base.groupId, expectedRevision: base.expectedRevision, requestId: base.requestId, payload: base.payload,
    payloadSha256: r.payload_sha, payloadBytes: r.payload_bytes, dispatchPlanSha256: r.plan_sha,
    ...(r.cancel_requested_at ? { cancelRequestedAt: r.cancel_requested_at } : {}), // 取消早到随输入送达
  };
}

// §D7 下发载荷（消费输入形态）：字段=DG104 GroupService.run 真实输入 + 分域摘要（端侧收件校验）
// + 取消标记（早到取消在 run 输入层显式可见）。通道封套未冻结（§4A/§4B 合同候选不猜路由）。
export function dispatchToClientWire(db, clientId, requestId) {
  const r = getGroupDispatch(db, clientId, requestId);
  if (!r) throw derr("GROUP_NOT_FOUND", "dispatch request not found");
  return wireOut(JSON.parse(r.bodyCanonical), db.prepare("SELECT * FROM group_dispatch WHERE client_ulid=? AND request_uid=?").get(clientId, requestId));
}
