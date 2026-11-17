/**
 * RO 设备组层级只读投影客户端（DG142 前端消费面；v0.4.2 groupLevelsPage）。
 * 浏览器零凭据：同 /ro/clients 模式（服务端固定 scope，orgId/projectId/token 不可由浏览器传递）。
 * 运行时校验同 agent-tasks-ro 纪律：封套缺项/坏 items/非法行一律按读取失败上抛，调用方
 * 「保旧行标陈旧」处理——绝不以坏响应冒充确认空集；缺失/非法字段页面层如实「未知」。
 * GET 只读——本模块无任何写调用；任务/报告标识仅原样展示（读面无按 UUID 的既有详情端点，
 * 不构造假链接）。
 */
import { fetchJson, ApiError } from './http';

export type ClientStatusKind = 'approved' | 'revoked' | 'rejected' | 'expired';
export type MemberRole = 'phone' | 'glasses';
export type DeviceKind = 'phone' | 'glasses' | 'tablet' | 'other' | 'unknown' | '';
export type ExecutionPhase = 'prepared' | 'dispatching' | 'unknown' | 'done';
export type ReceiptOutcome = 'succeeded' | 'failed' | 'cancelled';

export interface GroupLevelsMember {
  deviceId: string | null;
  role: MemberRole | null;
  deviceKind: DeviceKind | null;
  deviceName: string | null;
  deviceStatus: string | null;
}

export interface GroupLevelsReceipt {
  taskId: string | null;
  terminal: boolean;
  resourcesReleased: boolean;
  outcome: ReceiptOutcome | null;
  reportRef: string | null;
}

export interface GroupLevelsExecution {
  groupExecutionId: string | null;
  requestId: string | null;
  taskId: string | null;
  phase: ExecutionPhase;
  updatedAtMs: number;
  stopRequestedAt?: string;
  receipt?: GroupLevelsReceipt;
}

export interface GroupLevelsGroup {
  groupId: string;
  name: string;
  revision: number;
  deleted: boolean;
  updatedAtMs: number;
  members: GroupLevelsMember[];
  executions: GroupLevelsExecution[];
}

export interface GroupLevel {
  clientId: string;
  clientStatus: ClientStatusKind;
  deviceScope: { hostname: string } | null;
  groups: GroupLevelsGroup[];
}

export interface GroupLevelsPage {
  items: GroupLevel[];
  page: number;
  pageSize: number;
  nextPage: number | null;
}

const CLIENT_STATUS_SET = new Set<ClientStatusKind>(['approved', 'revoked', 'rejected', 'expired']);
const ROLE_SET = new Set<MemberRole>(['phone', 'glasses']);
const PHASE_SET = new Set<ExecutionPhase>(['prepared', 'dispatching', 'unknown', 'done']);
const OUTCOME_SET = new Set<ReceiptOutcome>(['succeeded', 'failed', 'cancelled']);
const UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function badShape(what: string): never {
  throw new ApiError(-1, `组层级读面响应不符合合同形态（${what}）——按读取失败处理，不冒充空集`, null);
}

const isStrOrNull = (v: unknown): v is string | null => v == null ? true : typeof v === 'string';

function validateMember(raw: unknown): GroupLevelsMember {
  if (typeof raw !== 'object' || raw == null) badShape('member 非对象');
  const m = raw as Record<string, unknown>;
  if (m.deviceId != null && typeof m.deviceId !== 'string') badShape('member.deviceId');
  if (m.role != null && (typeof m.role !== 'string' || !ROLE_SET.has(m.role as MemberRole))) badShape('member.role 非法（枚举外或非空非null）');
  if (m.deviceKind != null && typeof m.deviceKind !== 'string') badShape('member.deviceKind 非法（真值枚举留给渲染层）');
  if (m.deviceName !== undefined && !isStrOrNull(m.deviceName)) badShape('member.deviceName');
  if (m.deviceStatus !== undefined && !isStrOrNull(m.deviceStatus)) badShape('member.deviceStatus');
  return {
    deviceId: (m.deviceId as string | null) ?? null,
    role: m.role == null ? null : m.role as MemberRole,
    deviceKind: m.deviceKind == null ? null : m.deviceKind as DeviceKind,
    deviceName: (m.deviceName as string | null) ?? null,
    deviceStatus: (m.deviceStatus as string | null) ?? null,
  };
}

function validateExecution(raw: unknown): GroupLevelsExecution {
  if (typeof raw !== 'object' || raw == null) badShape('execution 非对象');
  const e = raw as Record<string, unknown>;
  if (typeof e.phase !== 'string' || !PHASE_SET.has(e.phase as ExecutionPhase)) badShape('execution.phase 非法');
  if (typeof e.updatedAtMs !== 'number' || !Number.isFinite(e.updatedAtMs) || !Number.isInteger(e.updatedAtMs) || e.updatedAtMs < 0) badShape('execution.updatedAtMs 非法');
  if (e.stopRequestedAt !== undefined && (typeof e.stopRequestedAt !== 'string' || !UTC_RE.test(e.stopRequestedAt))) badShape('execution.stopRequestedAt 非法');
  if (e.receipt !== undefined && (typeof e.receipt !== 'object' || e.receipt == null)) badShape('execution.receipt 非对象');
  const out: GroupLevelsExecution = {
    groupExecutionId: (e.groupExecutionId as string | null) ?? null,
    requestId: (e.requestId as string | null) ?? null,
    taskId: (e.taskId as string | null) ?? null,
    phase: e.phase as ExecutionPhase,
    updatedAtMs: e.updatedAtMs,
  };
  if (e.stopRequestedAt !== undefined) out.stopRequestedAt = e.stopRequestedAt as string;
  if (e.receipt !== undefined) {
    const r = e.receipt as Record<string, unknown>;
    if (r.terminal !== undefined && typeof r.terminal !== 'boolean') badShape('receipt.terminal 非布尔');
    if (r.resourcesReleased !== undefined && typeof r.resourcesReleased !== 'boolean') badShape('receipt.resourcesReleased 非布尔');
    if (r.outcome !== undefined && r.outcome !== null && (typeof r.outcome !== 'string' || !OUTCOME_SET.has(r.outcome as ReceiptOutcome))) badShape('receipt.outcome 非法');
    if (r.reportRef !== undefined && !isStrOrNull(r.reportRef)) badShape('receipt.reportRef 非法');
    out.receipt = {
      taskId: (r.taskId as string | null) ?? null,
      terminal: r.terminal === true,
      resourcesReleased: r.resourcesReleased === true,
      outcome: r.outcome == null || r.outcome === undefined ? null : r.outcome as ReceiptOutcome,
      reportRef: (r.reportRef as string | null) ?? null,
    };
  }
  return out;
}

function validateGroup(raw: unknown): GroupLevelsGroup {
  if (typeof raw !== 'object' || raw == null) badShape('group 非对象');
  const g = raw as Record<string, unknown>;
  if (typeof g.groupId !== 'string' || g.groupId.length === 0) badShape('group.groupId');
  if (typeof g.name !== 'string') badShape('group.name');
  if (typeof g.revision !== 'number' || !Number.isInteger(g.revision) || g.revision < 1) badShape('group.revision 非法');
  if (typeof g.deleted !== 'boolean') badShape('group.deleted 非布尔');
  if (typeof g.updatedAtMs !== 'number' || !Number.isFinite(g.updatedAtMs) || g.updatedAtMs < 0) badShape('group.updatedAtMs 非法');
  if (!Array.isArray(g.members)) badShape('group.members 非数组');
  if (!Array.isArray(g.executions)) badShape('group.executions 非数组');
  return {
    groupId: g.groupId, name: g.name, revision: g.revision, deleted: g.deleted, updatedAtMs: g.updatedAtMs,
    members: (g.members as unknown[]).map(validateMember),
    executions: (g.executions as unknown[]).map(validateExecution),
  };
}

function validateLevel(raw: unknown): GroupLevel {
  if (typeof raw !== 'object' || raw == null) badShape('level 非对象');
  const l = raw as Record<string, unknown>;
  if (typeof l.clientId !== 'string' || l.clientId.length === 0) badShape('level.clientId');
  if (typeof l.clientStatus !== 'string' || !CLIENT_STATUS_SET.has(l.clientStatus as ClientStatusKind)) badShape('level.clientStatus 非法');
  if (l.deviceScope != null) {
    if (typeof l.deviceScope !== 'object') badShape('level.deviceScope 非对象');
    const s = l.deviceScope as Record<string, unknown>;
    if (typeof s.hostname !== 'string') badShape('level.deviceScope.hostname 非串');
  }
  if (!Array.isArray(l.groups)) badShape('level.groups 非数组');
  return {
    clientId: l.clientId, clientStatus: l.clientStatus as ClientStatusKind,
    deviceScope: l.deviceScope == null ? null : { hostname: (l.deviceScope as Record<string, unknown>).hostname as string },
    groups: (l.groups as unknown[]).map(validateGroup),
  };
}

function validatePage(raw: unknown): GroupLevelsPage {
  if (typeof raw !== 'object' || raw == null) badShape('响应非对象');
  const p = raw as Record<string, unknown>;
  if (!Array.isArray(p.items)) badShape('items 非数组');
  if (typeof p.page !== 'number' || !Number.isInteger(p.page) || p.page < 1) badShape('分页 page 非法');
  if (typeof p.pageSize !== 'number' || !Number.isInteger(p.pageSize) || p.pageSize < 1 || p.pageSize > 200) badShape('分页 pageSize 非法（合同1..200）');
  if (!('nextPage' in p)) badShape('缺 required 字段 nextPage');
  if (p.nextPage != null && (typeof p.nextPage !== 'number' || !Number.isInteger(p.nextPage) || p.nextPage < 1)) badShape('nextPage 非法');
  return { items: (p.items as unknown[]).map(validateLevel), page: p.page, pageSize: p.pageSize, nextPage: (p.nextPage as number | null) ?? null };
}

/** 请求代次（页面防迟覆盖由调用方配合 seq 消费——同 Tasks 页纪律） */
export function fetchGroupLevelsPage(page: number, signal: AbortSignal): Promise<GroupLevelsPage> {
  const q = new URLSearchParams({ page: String(page), pageSize: '50' });
  return fetchJson<unknown>(`/ro/group-levels?${q.toString()}`, signal).then(validatePage);
}

/** 读面存在性：只把 404（no route）判未部署；其余失败留给 load() 如实报读取错误 */
export async function probeGroupLevelsRo(signal: AbortSignal): Promise<boolean> {
  try {
    await fetchJson<unknown>('/ro/group-levels?page=1&pageSize=1', signal);
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return false;
    return true;
  }
}
