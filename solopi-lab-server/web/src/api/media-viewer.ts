/**
 * 媒体观看主体 /mv 客户端（浏览器侧，W20 接线，服务端 r5.1 B7 已部署）。
 *
 * 安全边界（服务端合同 §2 B7 / W43 复核结论）：
 * - 观的主体会话由服务端侧裁决并管理（HttpOnly cookie，浏览器不可读）——本模块
 *   对会话态的判断全部来自服务端 401/403/422 实际响应或探测结果，
 *   不在前端猜测/缓存任何身份；
 * - 用户 2026-11-06 决定：网站观看屏幕无任何密码/口令拦截。W23fix3 起本站移除观看口令
 *   输入面——不采集、不持有、不传输任何口令，也不构造口令登录请求；会话是否建立、
 *   如何建立完全由服务端免密码路径裁决——前端对 401/403 只如实展示状态与错误，
 *   不提示口令、不重试登录、不冒充已授权；
 * - viewer 票为短时单用途，仅保存在组件内存中用于当前查看，关闭即随连接释放，
 *   服务端停止/断链由 sweep 兜底回收。
 */

import { fetchJson, postJson, ApiError } from './http';

/** /mv/authorize 响应（即 /v1/media-sessions 最小字段集，服务端固定 scope 直调） */
export interface MvAuthorizeResponse {
  mediaSessionId: string;
  clientId: string;
  deviceId: string;
  purpose: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  viewerTicket: { role: 'viewer'; token: string; expiresAt: string; oneTimeUse: true };
  dataPlane: {
    mode: 'wss-relay';
    pathTemplate: '/ws/media/{ticket}';
    acceptsBinaryFrom: 'client';
    backpressure: { maxBufferedBytes: number; maxQueueMessages: number; violationPolicy: string };
    limits?: Record<string, unknown>;
    h264Framing?: Record<string, unknown>;
    sweepIntervalMs?: number;
  };
  endedReason: string | null;
  endedAt: string | null;
}

/** 登录探测结果（不缓存身份，只缓存探测结论——服务端未配置=发放面禁用） */
export type MvLoginProbe =
  | { kind: 'ok' } // 已持有效主体会话（探测 422=会话不存在但主体已通过）
  | { kind: 'anonymous' } // 401=服务端未建立观看会话（W23fix3：本站无口令输入面，不做登录，状态如实展示）
  | { kind: 'not-configured' } // 403=服务端观看发放面禁用（未配置）
  | { kind: 'unavailable' }; // 非 /mv 响应形态（dev origin / 未部署等同源面缺失）

// ---- 共享会话态（镜像 connection.ts 订阅模式；HttpOnly cookie 不可读，状态仅是探测结论） ----
// Code security: 会话/会话票据、以及任何曾经存在过的口令类输入永不写入本 store；
// store 只保存「探测结论」——W23fix3 后本站不再有任何口令输入面，无从持有口令。
export type MediaLoginState = {
  probe: 'unknown' | MvLoginProbe['kind'];
};

const state: MediaLoginState = { probe: 'unknown' };
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeMediaLogin(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getMediaLoginState(): MediaLoginState {
  return state;
}

function notifyMediaLogin() {
  for (const listener of [...listeners]) listener();
}

function setMediaLogin(next: Partial<MediaLoginState>) {
  Object.assign(state, next);
  notifyMediaLogin();
}

/** 登录探测：探测一个不存在但合法 ULID 的 /mv/status——401=匿名，422=已登录，403=未配置 */
const PROBE_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
let probing: Promise<void> | null = null;

export function probeMediaLogin(): Promise<void> {
  if (probing != null) return probing;
  probing = (async () => {
    let probe: MvLoginProbe;
    try {
      await fetchJson<unknown>(`/mv/status/${PROBE_ULID}`, new AbortController().signal);
      probe = { kind: 'ok' }; // 不应出现（不存在会话）；出现也按已登录处理
    } catch (err) {
      if (err instanceof ApiError) {
        probe = err.status === 401 ? { kind: 'anonymous' } : err.status === 403 ? { kind: 'not-configured' } : err.status === 422 ? { kind: 'ok' } : { kind: 'unavailable' };
      } else {
        // 同源面存在但响应非JSON/断连——区分「网络失败」与「面不存在」：
        // fetch 对 index.html 回退会解析失败，与网络失败同形；此处统一 unavailable（保守显示未接入比误报可用更诚实）
        probe = { kind: 'unavailable' };
      }
    }
    setMediaLogin({ probe: probe.kind });
  })().finally(() => {
    probing = null;
  });
  return probing;
}

/**
 * v0.2.1 r6（Server 451ff54c604d…，合同 contracts/v0.2.1）免口令观看主体：
 * POST /mv/session 空 JSON body（{}，绝不携带任何口令类字段）即自动发放短时
 * HttpOnly+SameSite=Strict（HTTPS 部署附 Secure）主体 cookie；旧 accessKey 字段
 * 由服务端忽略——本端只发 {}，从源头保证不存在口令传输面。
 * 主体不宣传为独立用户身份；新主体不能停旧主体会话（服务端语义不变）。
 */
export interface MvSessionResponse {
  viewerSubject: boolean;
  expiresInSeconds: number;
}

/** 建立免口令观看主体（空 body）；成功即主体 cookie 由服务端 Set-Cookie 下发（浏览器不可读） */
let sessionOpening: Promise<MvSessionResponse> | null = null;
export function mvSession(): Promise<MvSessionResponse> {
  if (sessionOpening) return sessionOpening;
  sessionOpening = openSession().finally(() => { sessionOpening = null; });
  return sessionOpening;
}
async function openSession(): Promise<MvSessionResponse> {
  const resp = await postJson<MvSessionResponse>('/mv/session', {}, new AbortController().signal, 10_000);
  setMediaLogin({ probe: 'ok' });
  return resp;
}

/** 发起观看授权；401 抛 ApiError（会话未建立/过期），其余错误如实抛出；前端不猜成功 */
let firstScreen:Promise<MvAuthorizeResponse>|null=null;
let cookieReady=false;
export async function mvAuthorize(clientId: string, deviceId: string): Promise<MvAuthorizeResponse> {
  // The first open also establishes the cookie. Share that barrier across
  // auto-opening devices so simultaneous initial requests keep one owner.
  if(firstScreen)await firstScreen.catch(()=>{});
  const request=postJson<MvAuthorizeResponse>('/mv/authorize', { clientId, deviceId }, new AbortController().signal, 10_000);
  if(!cookieReady){firstScreen=request;try{const result=await request;cookieReady=true;return result;}finally{firstScreen=null;}}
  return request;
}

/** 停止观看（幂等；网络失败静默——服务端 sweep/租约到期兜底，不假装已停止） */
export async function mvStop(mediaSessionId: string, keepalive = false): Promise<void> {
  try {
    await postJson<unknown>('/mv/stop', { mediaSessionId }, new AbortController().signal, 8_000, { keepalive });
  } catch {
    // 网络失败不阻塞本地释放——服务端 sweep/租约到期兜底回收
  }
}

/** Read the authoritative end reason before deciding whether a viewer may recover. */
export function mvStatus(mediaSessionId: string): Promise<{status:string;endedReason:string|null}> {
  return fetchJson('/mv/status/'+encodeURIComponent(mediaSessionId),new AbortController().signal,5000);
}
