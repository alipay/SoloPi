/**
 * 运行时连接配置（真实API入口的唯一通道，W4）。
 *
 * 安全边界（合同 §0.6 受控交付要求）：
 * - 管理token只保存于本模块内存，页面刷新即清空；**不写localStorage、
 *   不进构建产物、不进URL参数/Referer、不进console日志**；
 * - API 基址、orgId/projectId 亦按敏感联调信息同内存处理；
 * - 人类可读的 orgKey/projectKey 引导名由受控 `admin grant` 一次性输出，
 *   页面只作展示标签，不参与请求。
 *
 * 真实读取的启用门槛（全部满足后才把 fetchers-v015 接入数据区）：
 * 服务端候选通过独立复核 → 部署地址就绪 → 受控 token+scope 映射
 * 经授权通道交付 → 合同版本核对。在此之前三数据区保持未接线。
 */

export interface ConnectionScope {
  orgId: string;
  projectId: string;
}

export interface RuntimeConnection {
  apiBaseUrl: string;
  adminToken: string;
  scope: ConnectionScope;
  /** 仅供展示的引导名（来自 admin grant 一次性映射输出） */
  orgKey?: string;
  projectKey?: string;
}

const state: { connection: RuntimeConnection | null } = { connection: null };

// ---- 反应式订阅（W6接线用）：连接变化时通知使用方重建数据区 ----
type Listener = () => void;
const listeners = new Set<Listener>();

/** useSyncExternalStore 订阅入口；snapshot=getRuntimeConnection（引用稳定） */
export function subscribeConnection(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyConnectionChange(): void {
  for (const listener of [...listeners]) listener();
}

// ---- 连接健康度（W7）：401/403后全局横幅不得声称“已连接” ----
export type ConnectionHealth = 'untested' | 'ok' | 'denied' | 'unreachable';

export interface ConnectionView {
  connection: RuntimeConnection | null;
  /** 最近一次真实读取的健康度；连接清除后回 untested */
  health: ConnectionHealth;
  /**
   * 同源固定scope只读代理模式（W11）：页面探测到同源 /ro/* 端点可用时为 true。
   * 该模式下数据区使用 /ro 代理（服务端硬编码 solopi-lab/glasses，无token），
   * 浏览器连接配置/旧token均不得改变代理scope；HTTPS手工连接路径在非RO来源继续保留。
   */
  proxyRo: boolean;
  /** 同源只读设备面（/ro/devices）探测结果：probe成功才接线设备列表（W13b） */
  roDevices: boolean;
}

let health: ConnectionHealth = 'untested';
let view: ConnectionView = { connection: null, health: 'untested', proxyRo: false, roDevices: false };

/**
 * 连接代次（W8/C13①③）：每次 set/clear 单调递增。
 * fetcher 在真正发出请求前核对代次与身份，旧代次的闭包直接调用也不得把旧token送上网络；
 * bootstrap 在发起时捕获代次，用户clear/手工配置后迟到的结果按代次失配丢弃。
 */
let generation = 0;

export function connectionGeneration(): number {
  return generation;
}

// ---- 同源只读代理模式（W11）----
let proxyRo = false;
let roDevices = false;

/** 页面启动探测结果写入；RO代次与连接代次独立，一旦启用常驻本页生命周期 */
export function setProxyRoMode(enabled: boolean): void {
  if (proxyRo === enabled) return;
  proxyRo = enabled;
  rebuildView(true);
}

/** 同源只读设备面探测结果（W13b）：仅在RO模式下有意义，失败不启用 */
export function setRoDevicesAvailable(available: boolean): void {
  if (roDevices === available) return;
  roDevices = available;
  rebuildView(true);
}

function rebuildView(notify: boolean): void {
  // RO模式下无连接也可保留健康度（真实读取驱动横幅）；非RO无连接=无读取语义
  if (state.connection == null && !proxyRo) health = 'untested';
  const effectiveHealth = state.connection == null && !proxyRo ? 'untested' : health;
  view = { connection: state.connection, health: effectiveHealth, proxyRo: proxyRo, roDevices: roDevices && proxyRo };
  if (notify) notifyConnectionChange();
}

/** useSyncExternalStore 的组合snapshot（引用只在变化时更新） */
export function getConnectionView(): ConnectionView {
  return view;
}

/** 由轮询引擎回写：真实读取成功/401/403拒绝（RO模式同样适用，无连接也可记录） */
export function markConnectionHealth(next: ConnectionHealth): void {
  if (next === 'untested') return;
  if (!proxyRo && state.connection == null) return; // 非RO无连接无读取语义
  if (health !== next) {
    health = next;
    rebuildView(true);
  }
}

/**
 * API 基址必须为 http(s) 绝对地址，且不带查询串/片段（避免身份或状态进URL）。
 * W5 安全收紧：
 * - 远程管理Bearer不得发往明文HTTP：非本机基址一律要求 https；
 *   本机隔离开发例外（127.0.0.1 / localhost）显式允许 http；
 * - 拒绝URL内嵌凭据（userinfo，如 https://user:pass@host）；
 * - 拒绝危险scheme（ws/ftp/file等，仅 http/https）。
 */
export function validateConnectionInput(input: {
  apiBaseUrl: string;
  adminToken: string;
  scope: ConnectionScope;
}): string | null {
  const { apiBaseUrl, adminToken, scope } = input;
  if (apiBaseUrl.length === 0) return 'API 基址不能为空';
  let url: URL;
  try {
    url = new URL(apiBaseUrl);
  } catch {
    return 'API 基址必须是合法的 http(s) URL';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return '拒绝危险scheme：API 基址仅支持 http(s)';
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return '基址不得内嵌用户名/密码（凭据只允许经 Authorization 头或受控配置交付）';
  }
  const isLoopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  if (url.protocol === 'http:' && !isLoopback) {
    return '远程管理 Bearer 不得发往明文 HTTP：非本机基址必须使用 https（本机隔离开发仅允许 127.0.0.1/localhost）';
  }
  if (url.search.length > 0 || url.hash.length > 0) return '基址不能包含查询串或片段';
  if (adminToken.length === 0) return '管理 token 不能为空';
  if (!/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(scope.orgId)) return 'orgId 必须是 ULID（来自受控授权映射）';
  if (!/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(scope.projectId)) return 'projectId 必须是 ULID（来自受控授权映射）';
  return null;
}

export function setRuntimeConnection(input: RuntimeConnection): string | null {
  const err = validateConnectionInput(input);
  if (err != null) return err;
  health = 'untested'; // 新连接（含换身份）重新开始健康检测
  generation += 1;
  state.connection = { ...input };
  rebuildView(false);
  notifyConnectionChange();
  return null;
}

export function clearRuntimeConnection(): void {
  if (state.connection == null && generation === 0) return;
  generation += 1;
  state.connection = null;
  rebuildView(false);
  notifyConnectionChange();
}

export function getRuntimeConnection(): RuntimeConnection | null {
  return state.connection;
}

/** 供UI展示的状态快照：**绝不回显token内容**，只给存在性/长度信息 */
export interface ConnectionSnapshot {
  configured: boolean;
  apiBaseUrl: string | null;
  scope: ConnectionScope | null;
  orgKey: string | null;
  projectKey: string | null;
  /** 仅用于“已保存”提示，不含任何可逆信息 */
  tokenFingerprintless: boolean;
}

export function describeRuntimeConnection(): ConnectionSnapshot {
  const c = state.connection;
  if (c == null) {
    return {
      configured: false,
      apiBaseUrl: null,
      scope: null,
      orgKey: null,
      projectKey: null,
      tokenFingerprintless: false,
    };
  }
  return {
    configured: true,
    apiBaseUrl: c.apiBaseUrl,
    scope: { orgId: c.scope.orgId, projectId: c.scope.projectId },
    orgKey: c.orgKey ?? null,
    projectKey: c.projectKey ?? null,
    tokenFingerprintless: c.adminToken.length > 0,
  };
}

// Code security: 显式禁用任何把连接信息打日志的工具函数挂载，防止误用
// （本模块不导入 console 日志路径；任何变更不得把 token 传入字符串模板）。
