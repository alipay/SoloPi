/**
 * 只读 JSON 请求封装（浏览器侧）。
 *
 * W1 骨架阶段该函数只被「已接线」的数据区使用；当前全部数据区未接线，
 * 因此运行时不会发起请求，也不存在任何 mock 成功路径。
 * 认证/分页/游标等语义全部留给服务端合同定义，这里不做假设。
 *
 * W2/C1 修复：每次请求带总超时（默认 15s，可覆盖），调用方取消会即时中止，
 * 避免无界 pending 与离线未决请求阻塞恢复后的刷新。
 */

/** 合同错误envelope（v0.1.5 error.schema.json 的最简镜像） */
export interface ErrorEnvelope {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
  retryAfterSec?: number;
}

export class ApiError extends Error {
  readonly status: number;
  /** 尽力解析的合同错误envelope；非JSON/不合同时为 null */
  readonly envelope: ErrorEnvelope | null;

  constructor(status: number, message: string, envelope: ErrorEnvelope | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.envelope = envelope;
  }
}

/** 尽力从错误响应体解析合同错误envelope；失败返回 null（响应体不落入异常信息） */
function parseErrorEnvelope(text: string): ErrorEnvelope | null {
  try {
    const body = JSON.parse(text) as { error?: Partial<ErrorEnvelope> };
    const e = body?.error;
    if (
      typeof e?.code === 'string' &&
      typeof e?.message === 'string' &&
      typeof e?.retryable === 'boolean'
    ) {
      return {
        code: e.code,
        message: e.message,
        retryable: e.retryable,
        ...(typeof e.details === 'object' && e.details != null ? { details: e.details as Record<string, unknown> } : {}),
        ...(typeof e.retryAfterSec === 'number' ? { retryAfterSec: e.retryAfterSec } : {}),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

export async function fetchJson<T>(
  url: string,
  signal: AbortSignal,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
  headers?: HeadersInit,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // 调用方取消即时传导（作用域切换/离线/卸载）
  const relayAbort = () => controller.abort();
  signal.addEventListener('abort', relayAbort);
  // W3/C6复核修复：调用方 signal 进入时已 abort，则 abort 事件不会再触发——
  // 立即中止并直接失败，禁止发起 fetch（预取消不得产生网络请求或成功结果）。
  if (signal.aborted) {
    clearTimeout(timer);
    signal.removeEventListener('abort', relayAbort);
    throw new Error('请求已取消');
  }

  try {
    let resp: Response;
    try {
      resp = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json', ...(headers ?? {}) },
        credentials: 'same-origin',
      });
    } catch (err) {
      if (signal.aborted) throw new Error('请求已取消');
      if (controller.signal.aborted) throw new Error(`读取超时（${timeoutMs}ms）`);
      // Code security: 不把网络错误原文以外的信息拼进展示，只区分连接失败
      throw new Error(`无法连接到 lab-server（${(err as Error).message}）`);
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      const envelope = parseErrorEnvelope(text);
      const hint = envelope != null ? envelope.message : text.slice(0, 160);
      throw new ApiError(resp.status, `HTTP ${resp.status}${hint ? `：${hint}` : ''}`, envelope);
    }

    return (await resp.json()) as T;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', relayAbort);
  }
}

/**
 * 同源 JSON POST（credentials: same-origin——携带服务端签发的 HttpOnly 主体 cookie）。
 * 语义与 fetchJson 一致：总超时+调用方取消传导+错误envelope解析；keepalive 供页面卸载路径尽力送达。
 */
export async function postJson<T>(
  url: string,
  body: unknown,
  signal: AbortSignal,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
  opts: { keepalive?: boolean } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const relayAbort = () => controller.abort();
  signal.addEventListener('abort', relayAbort);
  if (signal.aborted) {
    clearTimeout(timer);
    signal.removeEventListener('abort', relayAbort);
    throw new Error('请求已取消');
  }
  try {
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        credentials: 'same-origin',
        keepalive: opts.keepalive === true,
        headers: { Accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
    } catch (err) {
      if (signal.aborted) throw new Error('请求已取消');
      if (controller.signal.aborted) throw new Error(`请求超时（${timeoutMs}ms）`);
      // Code security: 网络错误只区分「无法连接」，不透传原文细节
      throw new Error(`无法连接到 lab-server（${(err as Error).message}）`);
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      const envelope = parseErrorEnvelope(text);
      const hint = envelope != null ? `：${envelope.message}` : '';
      throw new ApiError(resp.status, `HTTP ${resp.status}${hint}`, envelope);
    }
    return (await resp.json()) as T;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', relayAbort);
  }
}
