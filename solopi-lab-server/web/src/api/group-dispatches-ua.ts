/**
 * 组任务（group dispatch）前端消费客户端（AMAW-21；对齐 2026-11-08 已上线 Server 面）。
 *
 * 现役 alignment（全部实测来源）：
 * - **列表**：/ro/group-levels（已上线零凭据只读投影）——组执行 request 行从真实的
 *   group_registration / group_execution_projection 投影展平（requestId 即组执行 request，
 *   可为 null——纯组执行无派发时如实不列详情入口）；与 Agent 任务 ID（ULID）分账，
 *   **不把 group request 当 agentTaskId**；
 * - **详情**：GET /ua/group-dispatch-detail/{requestId}?clientId={ULID}（Server 20:43+上线的
 *   操作者/管理面受控读——会话门401+核心 adminSubject/checkAdminScope，浏览器只带 /ua
 *   HttpOnly 会话 cookie，**绝不使用 Client 会话 Bearer**，org/project/token 浏览器不可传）；
 * - 详情体字段与核心逐字对齐（server/src/app.mjs route /v1/group-dispatch-detail——
 *   group_dispatch 账本 + group_execution_projection 镜像 + reportRef 参考标识解析）；
 * - **reportRef**：仅为参考标识。reportRefParsed.fetchable 恒 false——正式授权读取/下载
 *   接口未上线前不构造链接，单独摘要不叫可访问报告；
 * - steps/members 为 Client 真实投影的**可选扩展位**（上报合同未冻结）：null/缺失=如实
 *   「未到」，数组=真值渲染——不假填；
 * - 坏封套/非法行按读取失败上抛（同 ua-session.ts 纪律），页面保旧行标陈旧；
 * - 401=未登录（受控登录在「Agent 会话」页）；会话失效时调用方须清受控详情原文
 *  （沿 AMAW-20 鉴权清理成果），不把 UI 残留误称可用。
 */
import { fetchJson, ApiError } from './http';
import type { GroupLevelsPage } from './group-levels-ro';

/** group_dispatch 账本状态真值枚举（server/src/group-dispatch.mjs CHECK 约束逐字） */
export type GroupDispatchStatus =
  | 'requested' | 'confirmed' | 'dispatching' | 'unknown' | 'done' | 'cancelled';

export const GROUP_DISPATCH_STATUS_SET: ReadonlySet<GroupDispatchStatus> =
  new Set(['requested', 'confirmed', 'dispatching', 'unknown', 'done', 'cancelled']);

/** 账本非终态（详情轮询继续；终态即停） */
export const GROUP_DISPATCH_NON_TERMINAL: ReadonlySet<GroupDispatchStatus> =
  new Set(['requested', 'confirmed', 'dispatching', 'unknown']);

const UUIDv4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function badShape(what: string): never {
  throw new ApiError(-1, `组任务详情响应不符合合同形态（${what}）——按读取失败处理，不冒充可用`, null);
}

const isStrOrNull = (v: unknown): v is string | null => v == null ? true : typeof v === 'string';

function intOrBad(v: unknown, what: string, min: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min) badShape(what);
  return v;
}

function optionalStr(v: unknown, what: string): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') badShape(what);
  return v;
}

/** 组执行 request 行（来自 /ro/group-levels 真实投影展平；含该行所属组和Desktop真值） */
export interface GroupDispatchListRow {
  requestId: string; // 组执行 request（UUIDv4）——详情准入可选（派发 request 可不带；列表面不假填）
  clientId: string;
  groupId: string;
  groupName: string;
  groupExecutionId: string | null;
  taskId: string | null; // 组执行 taskId（Client 报告真值）
  phase: string; // 登记投影 phase 原值（prepared/unknown≠成功）
  updatedAtMs: number;
  stopRequestedAt?: string; // 可选：停止意图事实（与取消终态分开表达）
  receiptTerminal?: boolean; // 回执终态合取（terminal&&resourcesReleased 由校验层算）
  receiptOutcome?: string | null;
  reportRef?: string | null;
}

/** 从 /ro/group-levels 真实层级页展平组执行 request 行（页面分页即层级分页） */
export function flattenGroupDispatchRows(page: GroupLevelsPage): GroupDispatchListRow[] {
  const rows: GroupDispatchListRow[] = [];
  for (const level of page.items) {
    for (const g of level.groups) {
      for (const e of g.executions) {
        rows.push({
          requestId: e.requestId ?? '', // null=纯组执行无派发request（详情入口如实禁用）
          clientId: level.clientId,
          groupId: g.groupId,
          groupName: g.name,
          groupExecutionId: e.groupExecutionId,
          taskId: e.taskId,
          phase: e.phase,
          updatedAtMs: e.updatedAtMs,
          ...(e.stopRequestedAt != null ? { stopRequestedAt: e.stopRequestedAt } : {}),
          ...(e.receipt != null ? {
            receiptTerminal: e.receipt.terminal === true && e.receipt.resourcesReleased === true,
            receiptOutcome: e.receipt.outcome,
            reportRef: e.receipt.reportRef,
          } : {}),
        });
      }
    }
  }
  return rows;
}

/** 步骤行（Client 步骤真实投影 candidate；宽松形态——只认真实存在值，缺失如实未知） */
export interface GroupDispatchStep {
  index: number | null;
  action: string | null;
  deviceId: string | null;
  status: string | null;
  note: string | null;
  at: string | null;
}

function validateStep(raw: unknown): GroupDispatchStep {
  if (typeof raw !== 'object' || raw == null) badShape('step 非对象');
  const s = raw as Record<string, unknown>;
  if (s.index !== undefined && s.index !== null && typeof s.index !== 'number') badShape('step.index');
  return {
    index: s.index != null && typeof s.index === 'number' ? s.index : null,
    action: optionalStr(s.action, 'step.action'),
    deviceId: optionalStr(s.deviceId, 'step.deviceId'),
    status: optionalStr(s.status, 'step.status'),
    note: optionalStr(s.note, 'step.note'),
    at: optionalStr(s.at, 'step.at'),
  };
}

/** 组成员投影（Client 真实投影候选位：deviceId 为真实设备标识——非ULID标识（如 23117RK66C /
 * RG_glasses2 一类真实型号/序列标识）按原样字符串接受，真值形态归 Client/Server 合同；缺失如实） */
export interface GroupDispatchMember {
  deviceId: string | null;
  deviceName: string | null;
}

function validateMember(raw: unknown): GroupDispatchMember {
  if (typeof raw !== 'object' || raw == null) badShape('member 非对象');
  const m = raw as Record<string, unknown>;
  if (m.deviceId !== undefined && !isStrOrNull(m.deviceId)) badShape('member.deviceId');
  if (m.deviceName !== undefined && !isStrOrNull(m.deviceName)) badShape('member.deviceName');
  return { deviceId: (m.deviceId as string | null) ?? null, deviceName: (m.deviceName as string | null) ?? null };
}

export interface GroupDispatchReceipt {
  terminal: boolean | null;
  resourcesReleased: boolean | null;
  outcome: string | null;
  reportRef: string | null;
}

function validateReceipt(raw: unknown): GroupDispatchReceipt {
  if (typeof raw !== 'object' || raw == null) badShape('execution.receipt 非对象');
  const r = raw as Record<string, unknown>;
  if (r.terminal !== undefined && typeof r.terminal !== 'boolean') badShape('receipt.terminal 非布尔');
  if (r.resourcesReleased !== undefined && typeof r.resourcesReleased !== 'boolean') badShape('receipt.resourcesReleased 非布尔');
  if (r.outcome !== undefined && !isStrOrNull(r.outcome)) badShape('receipt.outcome');
  if (r.reportRef !== undefined && !isStrOrNull(r.reportRef)) badShape('receipt.reportRef');
  return {
    terminal: r.terminal === undefined ? null : r.terminal === true,
    resourcesReleased: r.resourcesReleased === undefined ? null : r.resourcesReleased === true,
    outcome: optionalStr(r.outcome, 'receipt.outcome'),
    reportRef: optionalStr(r.reportRef, 'receipt.reportRef'),
  };
}

export interface GroupDispatchExecution {
  groupExecutionId: string | null;
  taskId: string | null;
  phase: string | null;
  receipt: GroupDispatchReceipt | null;
  eventSeq: number | null;
}

function validateExecution(raw: unknown): GroupDispatchExecution {
  if (typeof raw !== 'object' || raw == null) badShape('execution 非对象');
  const e = raw as Record<string, unknown>;
  if (e.eventSeq !== undefined && e.eventSeq !== null && typeof e.eventSeq !== 'number') badShape('execution.eventSeq 非数');
  return {
    groupExecutionId: optionalStr(e.groupExecutionId, 'execution.groupExecutionId'),
    taskId: optionalStr(e.taskId, 'execution.taskId'),
    phase: optionalStr(e.phase, 'execution.phase'),
    receipt: e.receipt == null ? null : validateReceipt(e.receipt),
    eventSeq: e.eventSeq != null && typeof e.eventSeq === 'number' ? e.eventSeq : null,
  };
}

/** reportRef 参考标识解析（核心原样透出；fetchable 恒 false——不构链接） */
export interface ReportRefParsed {
  scheme: string | null;
  path: string | null;
  fetchable: boolean;
  parseError?: string;
}

function validateReportRefParsed(raw: unknown): ReportRefParsed | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object') badShape('reportRefParsed 非对象');
  const p = raw as Record<string, unknown>;
  return {
    scheme: optionalStr(p.scheme, 'reportRefParsed.scheme'),
    path: optionalStr(p.path, 'reportRefParsed.path'),
    fetchable: p.fetchable === true, // 核心 fetchable:false 恒真——true 也不会渲染为链接（仍是参考标识）
    ...(p.parseError !== undefined && p.parseError !== null && typeof p.parseError !== 'string' ? badShape('reportRefParsed.parseError') : { }),
    ...(typeof p.parseError === 'string' ? { parseError: p.parseError } : {}),
  };
}

/** 详情：与 /v1/group-dispatch-detail 核心响应逐字对齐（账本投影 + 镜像 + reportRef） */
export interface GroupDispatchDetail {
  requestId: string;
  dispatchId: string;
  clientId: string;
  groupId: string;
  expectedRevision: number;
  dispatchPlanSha256: string | null;
  payloadSha256: string | null;
  payloadBytes: number | null;
  memberSha256: string | null;
  status: GroupDispatchStatus;
  cancelRequestedAt: string | null;
  taskUid: string | null;
  confirmedAt: string | null;
  terminalAt: string | null;
  terminalOutcome: string | null;
  execution: GroupDispatchExecution | null;
  /** Client 真实步骤投射；null=合同未冻结/未到——如实缺失，非空数组冒充 */
  steps: GroupDispatchStep[] | null;
  /** Client 真实成员投影候选位；缺失=未到——成员画绑定回退 /ro/group-levels 该组真值 */
  members: GroupDispatchMember[] | null;
  reportRef: string | null;
  reportRefParsed: ReportRefParsed | null;
}

/**
 * 详情读取：GET /ua/group-dispatch-detail/{requestId}?clientId={ULID}——操作者受控
 * （HttpOnly 会话 cookie 自动携带；401=未登录如实抛出）。requestId 必须来自列表行真实
 * projection（不猜存在）；本层校验响应身份（requestId 回环=请求、clientId 同主）。
 */
export async function fetchGroupDispatchDetail(requestId: string, clientId: string, signal: AbortSignal): Promise<GroupDispatchDetail> {
  if (!UUIDv4_RE.test(requestId)) badShape('requestId 非 UUIDv4（组 request 标识——非 agentTaskId）');
  if (!/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(clientId)) badShape('clientId 非 Desktop ULID');
  const raw = await fetchJson<unknown>(
    `/ua/group-dispatch-detail/${encodeURIComponent(requestId)}?clientId=${encodeURIComponent(clientId)}`,
    signal,
  );
  if (typeof raw !== 'object' || raw == null) badShape('响应非对象');
  const d = raw as Record<string, unknown>;
  if (typeof d.requestId !== 'string' || d.requestId !== requestId) badShape('requestId 身份失配（响应≠请求）');
  if (typeof d.dispatchId !== 'string' || d.dispatchId.length === 0) badShape('dispatchId');
  if (typeof d.clientId !== 'string' || d.clientId !== clientId) badShape('clientId 身份失配（响应≠请求行属主）');
  if (typeof d.groupId !== 'string' || d.groupId.length === 0) badShape('groupId');
  if (typeof d.status !== 'string' || !GROUP_DISPATCH_STATUS_SET.has(d.status as GroupDispatchStatus)) badShape('status 非账本枚举');
  if (d.reportRef !== undefined && !isStrOrNull(d.reportRef)) badShape('reportRef 非法');
  let steps: GroupDispatchStep[] | null = null;
  if (Array.isArray(d.steps)) steps = (d.steps as unknown[]).map(validateStep); // null=未到，不以空数组冒充
  let members: GroupDispatchMember[] | null = null;
  if (Array.isArray(d.members)) members = (d.members as unknown[]).map(validateMember);
  return {
    requestId: d.requestId, dispatchId: d.dispatchId, clientId: d.clientId, groupId: d.groupId,
    expectedRevision: intOrBad(d.expectedRevision, 'expectedRevision', 0),
    dispatchPlanSha256: optionalStr(d.dispatchPlanSha256, 'dispatchPlanSha256'),
    payloadSha256: optionalStr(d.payloadSha256, 'payloadSha256'),
    payloadBytes: d.payloadBytes == null ? null : intOrBad(d.payloadBytes, 'payloadBytes', 0),
    memberSha256: optionalStr(d.memberSha256, 'memberSha256'),
    status: d.status as GroupDispatchStatus,
    cancelRequestedAt: optionalStr(d.cancelRequestedAt, 'cancelRequestedAt'),
    taskUid: optionalStr(d.taskUid, 'taskUid'),
    confirmedAt: optionalStr(d.confirmedAt, 'confirmedAt'),
    terminalAt: optionalStr(d.terminalAt, 'terminalAt'),
    terminalOutcome: optionalStr(d.terminalOutcome, 'terminalOutcome'),
    execution: d.execution == null ? null : validateExecution(d.execution),
    steps,
    members,
    reportRef: optionalStr(d.reportRef, 'reportRef'),
    reportRefParsed: validateReportRefParsed(d.reportRefParsed),
  };
}
