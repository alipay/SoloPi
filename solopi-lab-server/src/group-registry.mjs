// SoloPi Lab Server — 设备组登记投影模块候选（合同 v0.4.0 §2/§3 的 Server 侧投影；DG1=Board 7111188 输入）。
// 权威边界（合同 §0 冻结候选）：Desktop 是唯一正式组写者（本地 CAS 账本 device-groups.sqlite）；本模块只把
// Desktop 上送的注册/执行投影登记为 Server 只读状态——不写回组配置、不猜测身份、不自动重放、不派生执行。
// wire 白名单不含也不会接受 serial/fingerprint/sourceIdentity（Desktop 私有本地校验值，不上送——合同 §2）。
// 接线说明：本候选独立可测（ensureGroupRegistrySchema 仅隔离库使用）；生产接入必须走迁移 0010（同 DDL 字节，
// 见合同 §8 交接清单）+ app.mjs 路由白名单/鉴权（串行接续），届时 GROUP_* 错误码才进入 util EC 状态映射。
// Code security: 全部 SQL 经 db.prepare 参数化；投影 canonical JSON 排序键化——同输入恒同串，杜绝排序抖动误判冲突。
import { ApiError } from "./util.mjs";

const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const UUIDV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHASES = ["prepared", "dispatching", "unknown", "done"];
// 合同 §3 状态机（前向唯一；没有 unknown→dispatching 自动重放）：
const PHASE_FORWARD = new Set(["prepared>dispatching", "prepared>done", "dispatching>unknown", "dispatching>done", "unknown>done"]);

function gerr(code, message) { return new ApiError(code, message); }
function canon(value) { // 与 DG1 端侧同口径的排序键 canonical JSON——幂等/冲突判定唯一依据
  const visit = (v) => {
    if (v === null || typeof v === "string" || typeof v === "boolean") return v;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (Array.isArray(v)) return v.map(visit);
    if (v && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, visit(v[k])]));
    throw gerr("GROUP_INVALID", "JSON values required");
  };
  return JSON.stringify(visit(value));
}
function allowKeys(obj, keys, where) {
  if (!obj || Object.getPrototypeOf(obj) !== Object.prototype) throw gerr("GROUP_INVALID", where + " must be a JSON object");
  for (const k of Object.keys(obj)) if (!keys.includes(k)) throw gerr("GROUP_INVALID", `field not allowed in ${where}: ${k}`);
}
function str(v, name, max) { if (typeof v !== "string" || v.length < 1 || v.length > max) throw gerr("GROUP_INVALID", `${name} (1..${max}) required`); return v; }
function intAtLeast(v, name, min) { if (!Number.isSafeInteger(v) || v < min) throw gerr("GROUP_INVALID", `${name} (>=${min}) required`); return v; }
const RFC3339UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/; // 与项目healthz/执行合同同口径UTC形态
// C95b（7114057）：真实日历校验——7113451复核实测`2026-99-99T99:99:99Z`通过形状正则；只对合法
// 公历日期/时刻放行（月1..12、日随月/闰年、时0..23、分/秒0..59）。
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function isRealGregorianInstant(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(v);
  if (!m) return false;
  const [, Y, Mo, D, H, Mi, S] = m.map(Number);
  if (Mo < 1 || Mo > 12 || H > 23 || Mi > 59 || S > 59) return false;
  let maxD = DAYS_IN_MONTH[Mo - 1];
  if (Mo === 2 && ((Y % 4 === 0 && Y % 100 !== 0) || Y % 400 === 0)) maxD = 29;
  return D >= 1 && D <= maxD;
}
function rfc3339(v, name) { if (typeof v !== "string" || !RFC3339UTC.test(v) || !isRealGregorianInstant(v)) throw gerr("GROUP_INVALID", `${name} must be a real RFC3339 UTC calendar instant`); return v; }

// C100（7115753）：完整wire校验导出给app.mjs接线层在成员解引用/SQL前复用——校验语义零改动
// （修前畸形wire直接进m.deviceId解引用=500 INTERNAL，掩盖校验缺失）。
export { validateRegistration, validateExecution };

// §2 注册 wire：clientId/groupId/revision/name/deleted/members[{deviceId,role}]——其余一律拒
function validateRegistration(wire) {
  allowKeys(wire, ["clientId", "groupId", "revision", "name", "deleted", "members"], "group registration");
  if (!ULID.test(String(wire.clientId ?? ""))) throw gerr("GROUP_INVALID", "clientId must be Desktop ULID");
  if (!UUIDV4.test(String(wire.groupId ?? ""))) throw gerr("GROUP_INVALID", "groupId must be UUIDv4");
  const revision = intAtLeast(wire.revision, "revision", 1);
  const name = str(wire.name, "name", 128);
  if (typeof wire.deleted !== "boolean") throw gerr("GROUP_INVALID", "deleted must be boolean");
  if (!Array.isArray(wire.members) || wire.members.length < 1 || wire.members.length > 128) throw gerr("GROUP_INVALID", "1..128 members required");
  const ids = new Set();
  const members = wire.members.map((m) => {
    allowKeys(m, ["deviceId", "role"], "group member"); // 合同 §2：serial/fingerprint/sourceIdentity 上送即拒（非白名单字段）
    if (!ULID.test(String(m.deviceId ?? ""))) throw gerr("GROUP_INVALID", "member deviceId must be stable ULID");
    const role = str(m.role, "role", 64); // 注册层不限制角色枚举；准入拒绝由 Desktop runner 判 GROUP_RUNNER_UNSUPPORTED
    if (ids.has(m.deviceId)) throw gerr("GROUP_DUPLICATE_MEMBER", m.deviceId);
    ids.add(m.deviceId);
    return { deviceId: m.deviceId, role };
  }).sort((a, b) => a.deviceId.localeCompare(b.deviceId));
  return canon({ clientId: wire.clientId, groupId: wire.groupId, revision, name, deleted: wire.deleted, members });
}
// §3 执行投影 wire：groupExecutionId/clientId/groupSnapshot/requestId/taskId/phase[/stopRequestedAt/receipt/eventSeq]
function validateExecution(wire) {
  // 目标4最小新增（队长01a1bb25授权）：steps——步骤/设备报告投影真实承载（可选字段,零DDL,零冻结载荷改动）。
  // 形态校验严格：0..512或省略，每项恰{index,action,deviceId?,status,note?,atMs?}；坏形态=GROUP_INVALID拒收(零持久)。
  const STEP_STATUS = new Set(["pending", "running", "succeeded", "failed", "skipped"]);
  const STEP_ACTION_RE = /^[A-Za-z0-9._:-]{1,64}$/;
  const stepsIn = wire.steps;
  if (stepsIn !== undefined) {
    if (!Array.isArray(stepsIn) || stepsIn.length > 512) throw gerr("GROUP_INVALID", "steps must be array <=512 when present");
    for (const st of stepsIn) {
      allowKeys(st, ["index", "action", "deviceId", "deviceName", "status", "note", "atMs"], "execution step");
      if (!Number.isSafeInteger(st.index) || st.index < 1 || st.index > 512) throw gerr("GROUP_INVALID", "step index 1..512");
      if (typeof st.action !== "string" || !STEP_ACTION_RE.test(st.action)) throw gerr("GROUP_INVALID", "step action charset violation");
      if (st.deviceId !== undefined && st.deviceId !== null && !ULID.test(String(st.deviceId))) throw gerr("GROUP_INVALID", "step deviceId must be ULID|null");
    // 01a1bb35对齐: Client真实设备标识=serial(如23117RK66C/RG_glasses2)—— steps 允许 deviceName(≤64安全字符)
    // 并在上报侧Select核对该serial确实属于本Client的device表(防伪造); deviceId 保底仍可选。
    if (st.deviceName !== undefined && st.deviceName !== null) {
      if (typeof st.deviceName !== "string" || st.deviceName.length === 0 || st.deviceName.length > 64) throw gerr("GROUP_INVALID", "step deviceName must be string 1..64|null");

    }
      if (typeof st.status !== "string" || !STEP_STATUS.has(st.status)) throw gerr("GROUP_INVALID", "step status enum pending|running|succeeded|failed|skipped");
      if (st.note !== undefined && st.note !== null && (typeof st.note !== "string" || st.note.length > 128)) throw gerr("GROUP_INVALID", "step note <=128");
      if (st.atMs !== undefined && st.atMs !== null && (!Number.isSafeInteger(st.atMs) || st.atMs < 0)) throw gerr("GROUP_INVALID", "step atMs integer>=0");
    }
  }
  allowKeys(wire, ["groupExecutionId", "clientId", "groupSnapshot", "requestId", "taskId", "phase", "stopRequestedAt", "receipt", "eventSeq", "steps"], "group execution projection");
  for (const f of ["groupExecutionId", "requestId", "taskId"]) if (!UUIDV4.test(String(wire[f] ?? ""))) throw gerr("GROUP_INVALID", `${f} must be native UUIDv4`);
  if (!ULID.test(String(wire.clientId ?? ""))) throw gerr("GROUP_INVALID", "clientId must be Desktop ULID");
  allowKeys(wire.groupSnapshot, ["groupId", "revision", "members"], "groupSnapshot");
  if (!UUIDV4.test(String(wire.groupSnapshot.groupId ?? ""))) throw gerr("GROUP_INVALID", "snapshot groupId must be UUIDv4");
  intAtLeast(wire.groupSnapshot.revision, "snapshot revision", 1);
  if (!Array.isArray(wire.groupSnapshot.members) || wire.groupSnapshot.members.length < 1 || wire.groupSnapshot.members.length > 128) throw gerr("GROUP_INVALID", "snapshot members (1..128) required");
  const snapSeen = new Set();
  const snapMembers = wire.groupSnapshot.members.map((m) => {
    allowKeys(m, ["deviceId", "role"], "snapshot member"); // 快照同样不得带 serial/sourceIdentity 上送
    if (!ULID.test(String(m.deviceId ?? ""))) throw gerr("GROUP_INVALID", "snapshot member deviceId must be ULID");
    if (snapSeen.has(m.deviceId)) throw gerr("GROUP_DUPLICATE_MEMBER", `snapshot duplicate member ${m.deviceId}`); // 7113451：重复成员拒
    snapSeen.add(m.deviceId);
    return { deviceId: m.deviceId, role: str(m.role, "snapshot role", 64) };
  }).sort((a, b) => a.deviceId.localeCompare(b.deviceId));
  if (!PHASES.includes(wire.phase)) throw gerr("GROUP_INVALID", "phase must be prepared|dispatching|unknown|done");
  if (wire.stopRequestedAt !== undefined) rfc3339(wire.stopRequestedAt, "stopRequestedAt"); // 7113451：坏日期拒（不再仅typeof string）
  if (wire.receipt !== undefined) {
    allowKeys(wire.receipt, ["taskId", "terminal", "resourcesReleased", "outcome", "reportRef"], "receipt");
    if (wire.receipt.taskId !== wire.taskId) throw gerr("GROUP_EXECUTION_CONFLICT", "receipt taskId must match execution taskId");
    if (wire.receipt.terminal !== true || wire.receipt.resourcesReleased !== true) throw gerr("GROUP_RECONCILIATION_REQUIRED", "receipt must carry trusted terminal+resourcesReleased evidence");
    if (!["succeeded", "failed", "cancelled"].includes(wire.receipt.outcome)) throw gerr("GROUP_RECONCILIATION_REQUIRED", "outcome must be succeeded|failed|cancelled");
    if (wire.receipt.reportRef !== undefined && wire.receipt.reportRef !== null && (typeof wire.receipt.reportRef !== "string" || wire.receipt.reportRef.length < 1 || wire.receipt.reportRef.length > 512)) throw gerr("GROUP_INVALID", "reportRef must be string|null (<=512)"); // 7113451：reportRef类型与合同一致
    if (wire.phase !== "done") throw gerr("GROUP_PROJECTION_INVALID_TRANSITION", "receipt only on done");
  }
  const eventSeq = intAtLeast(wire.eventSeq, "eventSeq", 0); // 7113451：eventSeq必填——缺失不再补0
  const body = {
    groupExecutionId: wire.groupExecutionId, clientId: wire.clientId,
    groupSnapshot: { groupId: wire.groupSnapshot.groupId, revision: wire.groupSnapshot.revision, members: snapMembers },
    requestId: wire.requestId, taskId: wire.taskId, phase: wire.phase,
    ...(wire.stopRequestedAt !== undefined ? { stopRequestedAt: wire.stopRequestedAt } : {}),
    ...(wire.receipt !== undefined ? { receipt: {
      taskId: wire.receipt.taskId, terminal: true, resourcesReleased: true,
      outcome: wire.receipt.outcome, reportRef: wire.receipt.reportRef === undefined ? null : wire.receipt.reportRef,
    } } : {}),
    ...(stepsIn !== undefined ? { steps: stepsIn.map((st) => ({
      index: st.index, action: st.action,
      ...(st.deviceId !== undefined ? { deviceId: st.deviceId === null ? null : st.deviceId } : {}),
    ...(st.deviceName !== undefined ? { deviceName: st.deviceName === null ? null : st.deviceName } : {}),
      status: st.status,
      ...(st.note !== undefined ? { note: st.note } : {}),
      ...(st.atMs !== undefined ? { atMs: st.atMs } : {}),
    })) } : {}),
    eventSeq,
  };
  return canon(body);
}

export function ensureGroupRegistrySchema(db) { // 候选期隔离库使用；生产接入走迁移0010（同DDL字节，合同 §8）
  db.exec([
    "CREATE TABLE IF NOT EXISTS group_registration (",
    "  client_ulid TEXT NOT NULL, group_uid TEXT NOT NULL,",
    "  revision INTEGER NOT NULL CHECK (typeof(revision)='integer' AND revision>=1),",
    "  deleted INTEGER NOT NULL CHECK (deleted IN (0,1) AND typeof(deleted)='integer'),",
    "  name TEXT NOT NULL, member_count INTEGER NOT NULL CHECK (typeof(member_count)='integer'),",
    "  body TEXT NOT NULL, updated_at_ms INTEGER NOT NULL CHECK (typeof(updated_at_ms)='integer'),",
    "  PRIMARY KEY (client_ulid, group_uid));",
    "CREATE TABLE IF NOT EXISTS group_execution_projection (",
    "  execution_uid TEXT PRIMARY KEY, client_ulid TEXT NOT NULL, group_uid TEXT NOT NULL,",
    "  request_uid TEXT NOT NULL UNIQUE, task_uid TEXT NOT NULL UNIQUE,",
    "  group_revision INTEGER NOT NULL, phase TEXT NOT NULL CHECK (phase IN ('prepared','dispatching','unknown','done')),",
    "  body TEXT NOT NULL, updated_at_ms INTEGER NOT NULL CHECK (typeof(updated_at_ms)='integer'));",
    // 快照/原生身份不可变（Server 只投影 Desktop 事实，不为重写留门）：
    "CREATE TRIGGER IF NOT EXISTS group_execution_projection_immutable BEFORE UPDATE ON group_execution_projection",
    " WHEN NEW.execution_uid IS NOT OLD.execution_uid OR NEW.request_uid IS NOT OLD.request_uid OR NEW.task_uid IS NOT OLD.task_uid",
    "  OR NEW.client_ulid IS NOT OLD.client_ulid OR NEW.group_uid IS NOT OLD.group_uid OR NEW.group_revision IS NOT OLD.group_revision", // 7113451：SQL标量归属列不可变
    "  OR json_extract(NEW.body,'$.groupExecutionId') IS NOT json_extract(OLD.body,'$.groupExecutionId')",
    "  OR json_extract(NEW.body,'$.requestId') IS NOT json_extract(OLD.body,'$.requestId')",
    "  OR json_extract(NEW.body,'$.taskId') IS NOT json_extract(OLD.body,'$.taskId')",
    "  OR json_extract(NEW.body,'$.clientId') IS NOT json_extract(OLD.body,'$.clientId')",
    "  OR json_extract(NEW.body,'$.groupSnapshot') IS NOT json_extract(OLD.body,'$.groupSnapshot')",
    " BEGIN SELECT RAISE(ABORT,'GROUP_PROJECTION_IMMUTABLE'); END;",
    "CREATE INDEX IF NOT EXISTS idx_group_exec_by_client ON group_execution_projection(client_ulid, group_uid);",
  ].join("\n"));
}

// §2 注册投影：单调 revision、幂等重放、同 revision 异 body 冲突、墓碑后高 revision 拒（唯一写者不可回填）
export function upsertGroupRegistration(db, wire) {
  const canonical = validateRegistration(wire);
  const at = Date.now();
  // 7113451：注册投影=CAS写——读判写放同一BEGIN IMMEDIATE短事务（SQLite单写者全序）。修前无事务：
  // 真实双进程并发时"迟到低revision体"可在墓碑落定后被读旧值覆盖（复核实测rev3墓碑被迟到rev2覆盖，
  // 实际回到revision=2/deleted=false）。事务化后两类交叉序都安全：迟rev仅在墓碑前提交才生效，此后一律stale/拒。
  const exec = db.exec.bind(db);
  exec("BEGIN IMMEDIATE");
  try {
    const out = upsertGroupRegistrationTx(db, { canonical, wire, at });
    exec("COMMIT");
    return out;
  } catch (e) { try { exec("ROLLBACK"); } catch { /* already rolled back */ } throw e; }
}
function upsertGroupRegistrationTx(db, { canonical, wire, at }) {
  const cur = db.prepare("SELECT revision, deleted, body FROM group_registration WHERE client_ulid=? AND group_uid=?").get(wire.clientId, wire.groupId);
  if (!cur) {
    db.prepare("INSERT INTO group_registration VALUES (?,?,?,?,?,?,?,?)")
      .run(wire.clientId, wire.groupId, wire.revision, wire.deleted ? 1 : 0, wire.name, wire.members.length, canonical, at);
    return { groupId: wire.groupId, revision: wire.revision, accepted: true, currentRevision: wire.revision };
  }
  if (wire.revision === cur.revision) {
    if (canon(JSON.parse(cur.body)) !== canonical) // canonical 重排序后比较（稳定）
      throw gerr("GROUP_REGISTRATION_CONFLICT", `same revision ${cur.revision} with different body`);
    return { groupId: wire.groupId, revision: cur.revision, accepted: true, currentRevision: cur.revision }; // 精确重放幂等
  }
  if (wire.revision < cur.revision) // 旧 revision 不覆盖、不报错——回当前投影供 Desktop 对账游标
    return { groupId: wire.groupId, revision: cur.revision, accepted: false, currentRevision: cur.revision, stale: true };
  if (cur.deleted === 1) // 墓碑后不可能出现更高 revision（Desktop 端已 GROUP_DELETED）——出现即唯一写者纪律破坏
    throw gerr("GROUP_REGISTRATION_CONFLICT", `group ${wire.groupId} is tombstoned at revision ${cur.revision}; higher revisions are refused (no backfill after delete)`);
  db.prepare("UPDATE group_registration SET revision=?, deleted=?, name=?, member_count=?, body=?, updated_at_ms=? WHERE client_ulid=? AND group_uid=?")
    .run(wire.revision, wire.deleted ? 1 : 0, wire.name, wire.members.length, canonical, at, wire.clientId, wire.groupId);
  return { groupId: wire.groupId, revision: wire.revision, accepted: true, currentRevision: wire.revision };
}

export function getGroupRegistration(db, clientId, groupId) {
  if (!ULID.test(String(clientId ?? "")) || !UUIDV4.test(String(groupId ?? ""))) throw gerr("GROUP_INVALID", "clientId ULID + groupId UUIDv4 required");
  const r = db.prepare("SELECT body FROM group_registration WHERE client_ulid=? AND group_uid=?").get(clientId, groupId);
  return r ? { ...JSON.parse(r.body), bodyCanonical: r.body } : null;
}

// §3 执行投影：幂等重放、不可变核心、前向状态机、原生 taskId 只绑一个 groupExecutionId
export function upsertGroupExecution(db, wire) {
  const canonical = validateExecution(wire);
  // 01a1bb35 对齐: steps.deviceName(真实serial)归属Select——须与该Client device表名称一致(防伪造, 不靠schema)
  {
    const body = JSON.parse(canonical);
    if (Array.isArray(body.steps)) {
      const cli = db.prepare("SELECT id FROM client WHERE client_ulid = ?", wire.clientId).get();
      if (!cli) throw gerr("GROUP_INVALID", "client must exist for step deviceName check");
      for (const st of body.steps) {
        if (st.deviceName !== undefined && st.deviceName !== null) {
          const dv = db.prepare("SELECT 1 FROM device WHERE name = ? AND client_rowid = ?", st.deviceName, cli.id).get();
          if (!dv) throw gerr("GROUP_INVALID", "step deviceName must match this client owned device names(真实serial, 不接受伪造)");
        }
      }
    }
  }
  const at = Date.now();
  const cur = db.prepare("SELECT body FROM group_execution_projection WHERE execution_uid=?").get(wire.groupExecutionId);
  if (!cur) {
    // 未知组族的执行不投影：注册必须先于执行存在（clientId+groupId 在册即可，允许后续组被删——快照自证）
    const reg = db.prepare("SELECT 1 FROM group_registration WHERE client_ulid=? AND group_uid=?").get(wire.clientId, wire.groupSnapshot.groupId);
    if (!reg) throw gerr("GROUP_NOT_FOUND", "group registration must exist before execution projection");
    // 原生身份单绑定（合同 §3）：同一 requestId/taskId 只能映射一个 groupExecutionId——显式拒绝而非裸唯一键错误
    if (db.prepare("SELECT 1 FROM group_execution_projection WHERE request_uid=? AND execution_uid<>?").get(wire.requestId, wire.groupExecutionId))
      throw gerr("GROUP_EXECUTION_CONFLICT", "requestId already bound to another groupExecutionId");
    if (db.prepare("SELECT 1 FROM group_execution_projection WHERE task_uid=? AND execution_uid<>?").get(wire.taskId, wire.groupExecutionId))
      throw gerr("GROUP_EXECUTION_CONFLICT", "native taskId already bound to another groupExecutionId");
    const prior = JSON.parse(canonical);
    // 7113451：**首报只允许 prepared**——修前"首报done可无receipt、prepared取消可无先前stop意图"红例在此闭合：
    // done/终态只能经有守卫的转场路径到达（receipt必须、cancelled必须先前已持久化stop意图）。
    if (prior.phase !== "prepared") throw gerr("GROUP_PROJECTION_INVALID_TRANSITION", "first projection must be phase=prepared; done is only reachable through guarded forward transitions");
    if (prior.receipt !== undefined) throw gerr("GROUP_PROJECTION_INVALID_TRANSITION", "receipt only on done; a fresh prepared execution cannot carry a receipt");
    db.prepare("INSERT INTO group_execution_projection VALUES (?,?,?,?,?,?,?,?,?)")
      .run(prior.groupExecutionId, prior.clientId, prior.groupSnapshot.groupId, prior.requestId, prior.taskId, prior.groupSnapshot.revision, prior.phase, canonical, at);
    return { groupExecutionId: prior.groupExecutionId, phase: prior.phase, eventSeq: prior.eventSeq, accepted: true };
  }
  const prev = JSON.parse(cur.body);
  const immutableCore = JSON.stringify({ a: canon({ groupExecutionId: prev.groupExecutionId, clientId: prev.clientId, groupSnapshot: prev.groupSnapshot, requestId: prev.requestId, taskId: prev.taskId }) });
  const nextCore = JSON.stringify({ a: canon({ groupExecutionId: wire.groupExecutionId, clientId: wire.clientId, groupSnapshot: { groupId: wire.groupSnapshot.groupId, revision: wire.groupSnapshot.revision, members: JSON.parse(canonical).groupSnapshot.members }, requestId: wire.requestId, taskId: wire.taskId }) });
  if (immutableCore !== nextCore)
    throw gerr("GROUP_EXECUTION_CONFLICT", "immutable execution core differs (groupSnapshot/requestId/taskId/clientId)");
  // C95b（7114057）：停止意图不是可覆盖展示值——已持久化的stopRequestedAt不因后续普通事件省略该可选
  // 字段而被擦除（7113451探针：prepared(seq0)→stop(seq1)→dispatching缺字段(seq2)后 stored 变 null，
  // 随后真实cancelled回执被GROUP_STOP_REQUESTED拒）。取持久化时序中的最早意图直至done。
  // B97（7114057续）修订：**终态同样继承持久停止事实**——done收尾记录保留stopRequestedAt事实层
  // ＝取消回执的合法性证据在终态后仍可审；继承对任何相态统一执行（含done），故同一done wire省略可选
  // 字段的幂等重放经同样合并后与存储逐字相等——事实继承与幂等重放自洽，互不冲突。
  const nextBody = JSON.parse(canonical);
  if (prev.stopRequestedAt !== undefined && nextBody.stopRequestedAt === undefined)
    nextBody.stopRequestedAt = prev.stopRequestedAt;
  const canonical2 = canon(nextBody);
  const prevEventSeq = prev.eventSeq ?? 0, nextEventSeq = JSON.parse(canonical2).eventSeq;
  if (nextEventSeq === prevEventSeq) {
    if (canon(prev) !== canonical2) throw gerr("GROUP_EXECUTION_CONFLICT", `same eventSeq ${prevEventSeq} with different body`);
    return { groupExecutionId: prev.groupExecutionId, phase: prev.phase, eventSeq: prevEventSeq, accepted: true }; // 精确重放幂等
  }
  if (nextEventSeq < prevEventSeq)
    return { groupExecutionId: prev.groupExecutionId, phase: prev.phase, eventSeq: prevEventSeq, accepted: false, currentEventSeq: prevEventSeq, stale: true };
  if (prev.phase === "done") // 合同 §3：done为终态——此后仅byte级重放幂等，回执/状态不可改
    throw gerr("GROUP_EXECUTION_CONFLICT", "done is terminal; receipt and state are immutable (exact replay only)");
  if (prev.phase !== nextBody.phase) {
    if (!PHASE_FORWARD.has(`${prev.phase}>${nextBody.phase}`))
      throw gerr("GROUP_PROJECTION_INVALID_TRANSITION", `${prev.phase} > ${nextBody.phase} is not a forward transition`);
    if (nextBody.phase === "done") {
      const r = nextBody.receipt;
      if (!r) throw gerr("GROUP_RECONCILIATION_REQUIRED", "done requires trusted native receipt");
      // 7113451：取消意图守卫严格化——cancelled必须**先前已持久化**stop意图（prev.stopRequestedAt）；
      // 不得以本次done wire顺带携带的 stopRequestedAt 冒充先前意图（修前"随报取消"路径闭合）。
      if (r.outcome === "cancelled" && prev.stopRequestedAt === undefined)
        throw gerr("GROUP_STOP_REQUESTED", "cancelled outcome requires a previously persisted stop intent (stopRequestedAt on an earlier event)");
    }
  }
  const next = JSON.parse(canonical2);
  db.prepare("UPDATE group_execution_projection SET phase=?, body=?, updated_at_ms=? WHERE execution_uid=?")
    .run(next.phase, canonical2, at, next.groupExecutionId);
  return { groupExecutionId: next.groupExecutionId, phase: next.phase, eventSeq: next.eventSeq, accepted: true };
}

export function getGroupExecutionProjection(db, groupExecutionId) {
  if (!UUIDV4.test(String(groupExecutionId ?? ""))) throw gerr("GROUP_INVALID", "groupExecutionId must be UUIDv4");
  const r = db.prepare("SELECT body FROM group_execution_projection WHERE execution_uid=?").get(groupExecutionId);
  return r ? { ...JSON.parse(r.body), bodyCanonical: r.body } : null;
}

export function listGroupRegistrations(db, clientId) {
  if (!ULID.test(String(clientId ?? ""))) throw gerr("GROUP_INVALID", "clientId must be Desktop ULID");
  return db.prepare("SELECT body FROM group_registration WHERE client_ulid=? ORDER BY group_uid").all(clientId).map((r) => JSON.parse(r.body));
}
