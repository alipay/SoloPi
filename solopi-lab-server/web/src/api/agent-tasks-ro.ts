/**
 * RO 任务只读投影客户端（W25R3；v0.3.3 终封套，Server 非作者已审 d227d34）。
 * 浏览器零凭据：同 /ro/clients 模式（服务端固定 scope solopi-lab/glasses）。
 * 运行时校验（非作者 R1–R4/R11 反例闭合）：封套缺项/坏 items/非法行/详情身份失配
 * 一律拒绝（按读取失败上抛），调用方按「保旧行标陈旧」处理——绝不以坏响应冒充确认空集；
 * 缺失/非法字段在页面层如实「未知」，不伪 false/成功。GET 只读——本模块无任何写调用。
 */
import { fetchJson, ApiError } from './http';

export type AgentTaskKind = 'tool-call' | 'prompt';
export type AgentTaskStatus = 'queued' | 'delivered' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired';

const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;  // ULID有效范围：首字符0-7（时间戳48位，复核者P3）
const STATUS_SET = new Set<AgentTaskStatus>(['queued', 'delivered', 'running', 'succeeded', 'failed', 'cancelled', 'expired']);
const KIND_SET = new Set<AgentTaskKind>(['tool-call', 'prompt']);

export interface AgentTaskRow {
  agentTaskId: string;
  clientId: string;
  kind: AgentTaskKind;
  toolName: string | null;
  status: AgentTaskStatus;
  /** progress 原文不下发——仅存在性（缺失/非法展示层作未知） */
  hasProgress: boolean | null;
  timeoutSec: number;
  createdAt: string;
  expiresAt: string;
  deliveredAt: string | null;
  startedAt: string | null;
  cancelRequestedAt: string | null;
  endedAt: string | null;
}

/** 详情五列全持久行推导；`undefined`=字段缺失（未知），`null`=确认无 */
export type AgentTaskDetail = AgentTaskRow & {
  resultArchived: boolean | null | undefined;
  resultOutcome: 'succeeded' | 'failed' | null | undefined;
  lateArchivedResult: boolean | null | undefined;
  resultErrorCode: string | null | undefined;
  hasResultError: boolean | null | undefined;
};

export interface AgentTasksPage {
  items: AgentTaskRow[];
  page: number;
  pageSize: number;
  nextPage: number | null;
}

function badShape(what: string): never {
  throw new ApiError(-1, `任务读面响应不符合合同形态（${what}）——按读取失败处理，不冒充空集`, null);
}

/** 复核者P4：时间必须是真实可解析的UTC RFC3339形态（拒绝 'not-a-date-at-all' 等任意串） */
const isRealUTC = (v: unknown): boolean => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v)) return false;
  return !Number.isNaN(Date.parse(v));
};

/** 行级运行时校验（R3）：ULID 身份、kind/status 枚举、时间形态——任一非法整行拒绝 */
function validateRow(raw: unknown): AgentTaskRow {
  if (typeof raw !== 'object' || raw == null) badShape('item 非对象');
  const a = raw as Record<string, unknown>;
  if (typeof a.agentTaskId !== 'string' || !ULID_RE.test(a.agentTaskId)) badShape('agentTaskId');
  if (typeof a.clientId !== 'string' || !ULID_RE.test(a.clientId)) badShape('clientId');
  if (typeof a.kind !== 'string' || !KIND_SET.has(a.kind as AgentTaskKind)) badShape('kind');
  if (typeof a.status !== 'string' || !STATUS_SET.has(a.status as AgentTaskStatus)) badShape('status');
  if (typeof a.timeoutSec !== 'number' || !Number.isFinite(a.timeoutSec) || a.timeoutSec < 0 || !Number.isInteger(a.timeoutSec)) badShape('timeoutSec 非法/负值');
  if (a.toolName != null && typeof a.toolName !== 'string') badShape('toolName');
  if (a.hasProgress != null && typeof a.hasProgress !== 'boolean') badShape('hasProgress');
  if (!isRealUTC(a.createdAt) || !isRealUTC(a.expiresAt)) badShape('时间字段');
  for (const k of ['deliveredAt', 'startedAt', 'cancelRequestedAt', 'endedAt'] as const) {
    if (a[k] != null && !isRealUTC(a[k])) badShape(k);
  }

  return {
    agentTaskId: a.agentTaskId, clientId: a.clientId, kind: a.kind as AgentTaskKind,
    toolName: (a.toolName as string | null) ?? null, status: a.status as AgentTaskStatus,
    hasProgress: a.hasProgress == null ? null : a.hasProgress as boolean,
    timeoutSec: a.timeoutSec, createdAt: a.createdAt as string, expiresAt: a.expiresAt as string,
    deliveredAt: (a.deliveredAt as string | null) ?? null, startedAt: (a.startedAt as string | null) ?? null,
    cancelRequestedAt: (a.cancelRequestedAt as string | null) ?? null, endedAt: (a.endedAt as string | null) ?? null,
  };
}

function validatePage(raw: unknown): AgentTasksPage {
  if (typeof raw !== 'object' || raw == null) badShape('响应非对象');
  const p = raw as Record<string, unknown>;
  if (!Array.isArray(p.items)) badShape('items 非数组');                       // R2
  if (typeof p.page !== 'number' || !Number.isFinite(p.page) || !Number.isInteger(p.page) || p.page < 1) badShape('分页 page 非法');          // R1+P2：合同 page>=1
  if (typeof p.pageSize !== 'number' || !Number.isFinite(p.pageSize) || !Number.isInteger(p.pageSize) || p.pageSize < 1 || p.pageSize > 200) badShape('分页 pageSize 非法（合同1..200）'); // P2
  if (!('nextPage' in p)) badShape('缺 required 字段 nextPage');               // P1：nextPage是必填列——缺失=坏封套
  if (p.nextPage != null && (typeof p.nextPage !== 'number' || !Number.isInteger(p.nextPage) || p.nextPage < 1)) badShape('nextPage 非法');
  return { items: (p.items as unknown[]).map(validateRow), page: p.page, pageSize: p.pageSize, nextPage: (p.nextPage as number | null) ?? null };
}

/** 请求代次（页面列表防迟覆盖由调用方配合 seqGuard 消费） */
export function fetchAgentTasksPage(params: { status?: AgentTaskStatus; clientId?: string; page?: number }, signal: AbortSignal): Promise<AgentTasksPage> {
  const q = new URLSearchParams({ page: String(params.page ?? 1), pageSize: '50' });
  if (params.status != null) q.set('status', params.status);
  if (params.clientId != null && params.clientId !== '') q.set('clientId', params.clientId);
  return fetchJson<unknown>(`/ro/agent-tasks?${q.toString()}`, signal).then(validatePage);
}

export function fetchAgentTaskDetail(agentTaskId: string, signal: AbortSignal): Promise<AgentTaskDetail> {
  return fetchJson<unknown>(`/ro/agent-tasks/${agentTaskId}`, signal).then((raw: unknown) => {
    if (typeof raw !== 'object' || raw == null) badShape('详情非对象');
    const row = validateRow(raw);                                          // R3 行级
    if (row.agentTaskId !== agentTaskId) badShape('详情身份失配');            // R4 请求ID≠响应ID
    const d = raw as Record<string, unknown>;
    const boolOrUndef = (v: unknown): boolean | null | undefined =>
      v === undefined ? undefined : v === null ? null : typeof v === 'boolean' ? v : undefined; // 非法→未知(undefined)
    const outcome: 'succeeded' | 'failed' | null | undefined =
      d.resultOutcome === 'succeeded' || d.resultOutcome === 'failed' ? d.resultOutcome
        : d.resultOutcome === null ? null : undefined;
    return {
      ...row,
      resultArchived: boolOrUndef(d.resultArchived),
      resultOutcome: outcome,
      lateArchivedResult: boolOrUndef(d.lateArchivedResult),
      resultErrorCode: d.resultErrorCode == null ? null : typeof d.resultErrorCode === 'string' ? d.resultErrorCode : undefined,
      hasResultError: boolOrUndef(d.hasResultError),
    };
  });
}

/** 读面存在性（R5）：只把 404（no route）判未部署；500/网络失败等读失败面照常可用（可刷新恢复） */
export async function probeAgentTasksRo(signal: AbortSignal): Promise<boolean> {
  try {
    await fetchJson<unknown>('/ro/agent-tasks?page=1&pageSize=1', signal);
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return false; // no route → 未部署
    return true; // 500/坏形状/网络失败 → 面在；失败由 load() 如实报读取错误
  }
}
