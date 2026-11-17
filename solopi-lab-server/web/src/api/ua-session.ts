/**
 * G2 受控会话客户端（/ua面；dg150现役）。真实鉴权连接+agent任务委托/回执。
 *
 * 纪律：
 * - token只在POST /ua/session正文体一次性提交，服务端换发HttpOnly(SameSite=Strict+Secure)
 *   会话cookie；本层**不在内存/存储之外留存token**（不在URL/日志）——只保留login函数入参；
 * - 同幂等键对账：创建响应缺失/网络失败=结果未知，**绝不自动重发**——由调用方用同idempotencyKey
 *   重放请求（服务端同键同载荷回duplicate原状）或查询任务列表对账；本层提供对账助手；
 * - /ua detail拿到result/prompt归档原文（受控会话可见），页面如实分账渲染，不冒充RO面。
 */
import { fetchJson, postJson, ApiError } from './http';

export type OperatorSession = { operatorSession: boolean; expiresInSeconds: number };

/** 一次性提交凭据换HttpOnly会话；失败401/403/429如实抛给调用方（不清cookie——服务端已拒绝发放） */
export function uaLogin(token: string, signal: AbortSignal): Promise<OperatorSession> {
  return postJson<OperatorSession>('/ua/session', { token }, signal, 10_000);
}

export function uaLogout(signal: AbortSignal): Promise<{ operatorSession: boolean }> {
  return postJson<{ operatorSession: boolean }>('/ua/logout', {}, signal, 10_000);
}

/** 会话状态探针：401=未登录（HttpOnly cookie不可读——页面只能靠探针判定） */
export async function uaWhoami(signal: AbortSignal): Promise<OperatorSession | null> {
  try {
    return await fetchJson<OperatorSession>('/ua/whoami', signal);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err; // 其他失败（网络/5xx）如实上抛：页面显示错误而非"未登录"
  }
}

export interface UaCreatePromptRequest {
  kind: 'prompt';
  prompt: { text: string };
  clientId: string;
  idempotencyKey: string;
  timeoutSeconds?: number;
}

export interface UaAgentTaskDetail {
  agentTaskId: string;
  clientId: string;
  kind: 'prompt' | 'tool-call';
  tool: { name: string; args: Record<string, unknown> | null } | null;
  prompt: { text: string } | null;
  status: 'queued' | 'delivered' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired';
  progress: string | null;
  timeoutSec: number;
  createdAt: string;
  expiresAt: string;
  deliveredAt: string | null;
  startedAt: string | null;
  cancelRequestedAt: string | null;
  endedAt: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
}

function badShape(what: string): never {
  throw new ApiError(-1, `UA面响应不符合合同形态（${what}）——按失败处理，不冒充可用`, null);
}

const STATUS_SET = new Set<UaAgentTaskDetail['status']>(['queued', 'delivered', 'running', 'succeeded', 'failed', 'cancelled', 'expired']);
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** G1受控详情：会话401如实为null（未登录）；行级形态校验防坏封套冒充 */
export async function uaTaskDetail(agentTaskId: string, signal: AbortSignal): Promise<UaAgentTaskDetail | null> {
  if (!ULID_RE.test(agentTaskId)) badShape('agentTaskId必须为ULID');
  let raw: unknown;
  try {
    raw = await fetchJson<unknown>(`/ua/agent-tasks/${agentTaskId}`, signal);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
  if (typeof raw !== 'object' || raw == null) badShape('响应非对象');
  const r = raw as Record<string, unknown>;
  if (typeof r.agentTaskId !== 'string' || r.agentTaskId !== agentTaskId) badShape('agentTaskId身份失配');
  if (typeof r.clientId !== 'string' || !ULID_RE.test(r.clientId)) badShape('clientId');
  if (r.kind !== 'prompt' && r.kind !== 'tool-call') badShape('kind');
  if (typeof r.status !== 'string' || !STATUS_SET.has(r.status as UaAgentTaskDetail['status'])) badShape('status');
  if (typeof r.timeoutSec !== 'number' || !Number.isInteger(r.timeoutSec) || r.timeoutSec < 1) badShape('timeoutSec');
  if (r.prompt != null && (typeof r.prompt !== 'object' || typeof (r.prompt as Record<string, unknown>).text !== 'string')) badShape('prompt');
  if (r.result !== null && typeof r.result !== 'object') badShape('result');
  if (r.error !== null && typeof r.error !== 'string') badShape('error');
  return {
    agentTaskId: r.agentTaskId, clientId: r.clientId, kind: r.kind as UaAgentTaskDetail['kind'],
    tool: (r.tool as UaAgentTaskDetail['tool']) ?? null,
    prompt: (r.prompt as UaAgentTaskDetail['prompt']) ?? null,
    status: r.status as UaAgentTaskDetail['status'],
    progress: typeof r.progress === 'string' ? r.progress : null,
    timeoutSec: r.timeoutSec,
    createdAt: String(r.createdAt ?? ''), expiresAt: String(r.expiresAt ?? ''),
    deliveredAt: r.deliveredAt != null ? String(r.deliveredAt) : null,
    startedAt: r.startedAt != null ? String(r.startedAt) : null,
    cancelRequestedAt: r.cancelRequestedAt != null ? String(r.cancelRequestedAt) : null,
    endedAt: r.endedAt != null ? String(r.endedAt) : null,
    result: (r.result as Record<string, unknown>) ?? null,
    error: (r.error as string) ?? null,
  };
}

export type UaCreateOutcome =
  | { kind: 'created' | 'duplicate'; detail: UaAgentTaskDetail }
  | { kind: 'conflict'; message: string }
  | { kind: 'rejected'; status: number; message: string }
  | { kind: 'unauthorized' }
  | { kind: 'unknown' }; // 网络中断等真·结果未知——绝不自动重发，调用方同幂等键对账

/** 创建/幂等重试统一入口。冲突/拒绝/未授权/未知逐一如实分账，无静默成功。 */
export async function uaCreatePromptOutcome(req: UaCreatePromptRequest, signal: AbortSignal): Promise<UaCreateOutcome> {
  try {
    const raw = await postJson<unknown>('/ua/agent-tasks', req, signal, 15_000);
    // 200行=与detail同形（agentTaskOut）——复用行级校验
    if (typeof raw !== 'object' || raw == null) return { kind: 'rejected', status: 200, message: '响应不符合合同形态' };
    const t = (raw ?? {}) as Record<string, unknown>;
    if (typeof t.agentTaskId !== 'string' || !ULID_RE.test(t.agentTaskId) || (t.kind !== 'prompt' && t.kind !== 'tool-call') || typeof t.status !== 'string' || !STATUS_SET.has(t.status as UaAgentTaskDetail['status']) || typeof t.clientId !== 'string' || !ULID_RE.test(t.clientId)) {
      return { kind: 'rejected', status: 200, message: '响应不符合合同形态' };
    }
    const duplicate = t.duplicate === true; // 服务端同键同载荷幂等命中时回duplicate:true（核心合同实测）
    const detail = {
      agentTaskId: t.agentTaskId, clientId: t.clientId, kind: t.kind as UaAgentTaskDetail['kind'],
      tool: (t.tool as UaAgentTaskDetail['tool']) ?? null,
      prompt: (t.prompt as UaAgentTaskDetail['prompt']) ?? null,
      status: t.status as UaAgentTaskDetail['status'],
      progress: typeof t.progress === 'string' ? t.progress : null,
      timeoutSec: t.timeoutSec as number,
      createdAt: String(t.createdAt ?? ''), expiresAt: String(t.expiresAt ?? ''),
      deliveredAt: t.deliveredAt != null ? String(t.deliveredAt) : null,
      startedAt: t.startedAt != null ? String(t.startedAt) : null,
      cancelRequestedAt: t.cancelRequestedAt != null ? String(t.cancelRequestedAt) : null,
      endedAt: t.endedAt != null ? String(t.endedAt) : null,
      result: (t.result as Record<string, unknown>) ?? null,
      error: (t.error as string) ?? null,
    };
    return { kind: duplicate ? 'duplicate' : 'created', detail };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 401) return { kind: 'unauthorized' };
      if (err.status === 409) return { kind: 'conflict', message: String(err.message) };
      // 200同键幂等命中：服务端(duplicate)以200回原行——ApiError抛出的只有真4xx/5xx
      if (err.status >= 400) return { kind: 'rejected', status: err.status, message: String(err.message) };
      return { kind: 'unknown' };
    }
    return { kind: 'unknown' }; // 网络中断=结果未知：**绝不自动重发**
  }
}

export function uaCancel(agentTaskId: string, reason: string, signal: AbortSignal): Promise<unknown> {
  return postJson<unknown>(`/ua/agent-tasks/${agentTaskId}/cancel`, { reason }, signal, 10_000);
}
