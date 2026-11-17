// 只读组投影（网站真实Desktop→设备组→设备层级数据面）。DG142候选。
// 边界：零写、不新造组权威——组/成员/执行状态全部读自既有登记投影表（group_registration /
// group_execution_projection），登记≠执行，phase原样透出（prepared/unknown不是成功）；角色只取登记
// 成员明确role，设备种类只取device表真值（未确认为other/缺失如实null），不推断不补齐。
// 敏感字段（adb_serial/discoveryFingerprint/sourceIdentity/payload/凭据/token）一律不外送。
// 复用依据（上游核，见随包说明）：DeepSeek 6337fc8授权作用于工作项/Agent会话，无设备组只读API可复用；
// 本模块复用本项目既有只读面模式（adminSubject+checkAdminScope租户路径与/ro固定scope进程内调用）。
import { one, many } from "./db.mjs";
import { ApiError } from "./util.mjs";

const DEVICE_SAFE_ROWS = "SELECT kind, name, status FROM device WHERE device_ulid = ? ORDER BY last_seen_ms DESC, id DESC LIMIT 1";

function readDeviceFacts(db, deviceId) {
  const d = one(db, DEVICE_SAFE_ROWS, deviceId);
  return d ? { deviceKind: d.kind, deviceName: d.name, deviceStatus: d.status } : { deviceKind: null, deviceName: null, deviceStatus: null };
}

export function listGroupLevels(db, orgRowid, projectRowid, { page, pageSize }) {
  // 分层基元：该租户scope内有登记投影的Desktop（含吊销——历史如实可见，真值显示）。空库=真实空态。
  const clients = many(db,
    "SELECT c.id, c.client_ulid, c.status, c.device_scope_json FROM client c " +
    "WHERE c.org_rowid = ? AND c.project_rowid = ? AND EXISTS (" +
    "SELECT 1 FROM group_registration g WHERE g.client_ulid = c.client_ulid) " +
    "ORDER BY c.granted_at_ms DESC, c.id DESC LIMIT ? OFFSET ?",
    orgRowid, projectRowid, pageSize, (page - 1) * pageSize);
  const counted = one(db,
    "SELECT count(*) AS c FROM client c WHERE c.org_rowid = ? AND c.project_rowid = ? AND EXISTS (" +
    "SELECT 1 FROM group_registration g WHERE g.client_ulid = c.client_ulid)", orgRowid, projectRowid).c;
  const items = clients.map((c) => {
    let scope = null;
    try { const scopeJson = JSON.parse(c.device_scope_json || "null"); if (scopeJson && typeof scopeJson.hostname === "string") scope = { hostname: scopeJson.hostname }; } catch { scope = null; }
    const groups = many(db, "SELECT body, updated_at_ms FROM group_registration WHERE client_ulid = ? ORDER BY group_uid", c.client_ulid).map((g) => {
      const body = JSON.parse(g.body);
      const executions = many(db, "SELECT execution_uid, request_uid, task_uid, phase, body, updated_at_ms FROM group_execution_projection WHERE client_ulid = ? AND group_uid = ? ORDER BY updated_at_ms DESC, execution_uid", c.client_ulid, body.groupId).map((e) => {
        const proj = JSON.parse(e.body);
        // 仅显式存在的既有标识；stopped/reportAvailable可选——缺字段如实缺，不虚构执行成功。
        const out = { groupExecutionId: proj.groupExecutionId, requestId: proj.requestId, taskId: proj.taskId, phase: e.phase, updatedAtMs: e.updated_at_ms };
        if (typeof proj.stopRequestedAt === "string") out.stopRequestedAt = proj.stopRequestedAt;
        if (proj.receipt && typeof proj.receipt === "object") out.receipt = { taskId: proj.receipt.taskId ?? null, terminal: proj.receipt.terminal === true, resourcesReleased: proj.receipt.resourcesReleased === true, outcome: typeof proj.receipt.outcome === "string" ? proj.receipt.outcome : null, reportRef: typeof proj.receipt.reportRef === "string" ? proj.receipt.reportRef : null }; // 回执原样字段，仅显式已存在标识
        return out;
      });
      return {
        groupId: body.groupId, name: body.name, revision: body.revision, deleted: body.deleted === true, updatedAtMs: g.updated_at_ms,
        members: Array.isArray(body.members) ? body.members.map((m) => ({ deviceId: m.deviceId, role: m.role, ...readDeviceFacts(db, m.deviceId) })) : [],
        executions,
      };
    });
    return { clientId: c.client_ulid, clientStatus: c.status, deviceScope: scope, groups };
  });
  return { items, page, pageSize, nextPage: page * pageSize < counted ? page + 1 : null };
}
