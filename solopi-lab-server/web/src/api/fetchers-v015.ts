/**
 * v0.1.5 只读取数工厂（W4 准备件——**未接线**）。
 *
 * 工厂从运行时连接配置（内存）构建 `DataArea.fetchers.read` 形状的函数，
 * 但**不注册到 src/api/areas.ts**：三数据区 wired:false 维持不变。
 * 启用条件（全部满足）：服务端候选通过独立复核 → 部署地址就绪 →
 * 受控 token+scope 映射交付 → 合同版本核对通过。
 *
 * 安全约束：
 * - 管理token只放 Authorization 头，**不进URL**；
 * - 查询串只含 orgId/projectId（ULID）、status、online、page/pageSize；
 * - 不读取、不缓存、不打日志任何身份内容（connection 模块保证内存生命周期）。
 */
import type { ClientRecord, EnrollmentRequest } from './types';
import { fetchJson } from './http';
import { connectionGeneration, getRuntimeConnection, type RuntimeConnection } from './connection';
import {
  ENDPOINTS,
  type ClientSummary15,
  type EnrollmentRow15,
  type EnrollmentStatus,
  type PageEnvelope,
} from './contract-v015';
import { AdapterError, fetchAllPages, mapClientSummary, mapEnrollmentRow } from './adapters-v015';

/**
 * W8/C13① 连接准入：fetcher 真正发出请求前核对当前身份。
 * clear/换身份后，持有的旧fetcher闭包直接调用也**不得把旧token送上网络**——
 * 挂载轮询取消不能替代本检查。核对项：连接代次 + base/scope/token 与创建时一致。
 */
/** 准入失败返回rejected Promise（不抛同步异常），成功返回null */
function admitConnection(capturedGeneration: number, conn: RuntimeConnection): Promise<never | null> | null {
  const current = getRuntimeConnection();
  if (
    current == null ||
    connectionGeneration() !== capturedGeneration ||
    current.adminToken !== conn.adminToken ||
    current.apiBaseUrl !== conn.apiBaseUrl ||
    current.scope.orgId !== conn.scope.orgId ||
    current.scope.projectId !== conn.scope.projectId
  ) {
    return Promise.reject(
      new AdapterError(
        'CONNECTION_STALE',
        '连接已清除或已更换身份：请求在发出前被拒绝（旧token不出网）',
      ),
    );
  }
  return null;
}

const PAGE_SIZE_MAX = 200;

function authHeaders(token: string): HeadersInit {
  // Code security: token仅进Authorization头，绝不拼接进URL或查询串
  return { Authorization: `Bearer ${token}` };
}

function scopeParams(
  scope: RuntimeConnection['scope'],
  extra: Record<string, string> = {},
): Record<string, string> {
  return { orgId: scope.orgId, projectId: scope.projectId, ...extra };
}

async function fetchPage<T>(
  conn: RuntimeConnection,
  path: string,
  params: Record<string, string>,
  page: number,
  signal: AbortSignal,
): Promise<PageEnvelope<T>> {
  const query = new URLSearchParams({ ...params, page: String(page), pageSize: String(PAGE_SIZE_MAX) });
  const url = `${conn.apiBaseUrl}${path}?${query.toString()}`;
  const envelope = await fetchJson<PageEnvelope<T>>(url, signal, undefined, authHeaders(conn.adminToken));
  if (envelope == null || !Array.isArray(envelope.items) || typeof envelope.page !== 'number') {
    throw new AdapterError('CONTRACT_MISMATCH', `响应不是合法分页envelope：${path}`);
  }
  return envelope;
}

/** 待审批/按状态的注册申请列表（只读） */
export function createEnrollmentsRead(
  conn: RuntimeConnection,
  options: { status?: EnrollmentStatus } = {},
): (base: string, signal: AbortSignal) => Promise<EnrollmentRequest[]> {
  const params = scopeParams(conn.scope, { status: options.status ?? 'pending' });
  const labels = { orgKey: conn.orgKey, projectKey: conn.projectKey };
  const gen = connectionGeneration();
  return (_base: string, signal: AbortSignal) => {
    const denied = admitConnection(gen, conn); // 发请求前准入（fetch零调用）
    if (denied != null) return denied as Promise<never>;
    return fetchAllPages<EnrollmentRow15>((page, sig) => {
      const admit = admitConnection(gen, conn); // 分页间复核（身份中途变更亦不出网）
      if (admit != null) return admit as Promise<never>;
      return fetchPage<EnrollmentRow15>(conn, ENDPOINTS.enrollments, params, page, sig);
    }, signal).then((rows) => rows.map((row) => mapEnrollmentRow(row, labels)));
  };
}

/** Client 状态列表（只读，权威 presence） */
export function createClientsRead(
  conn: RuntimeConnection,
): (base: string, signal: AbortSignal) => Promise<ClientRecord[]> {
  const params = scopeParams(conn.scope);
  const labels = { orgKey: conn.orgKey, projectKey: conn.projectKey };
  const gen = connectionGeneration();
  return (_base: string, signal: AbortSignal) => {
    const denied = admitConnection(gen, conn); // 发请求前准入（fetch零调用）
    if (denied != null) return denied as Promise<never>;
    return fetchAllPages<ClientSummary15>((page, sig) => {
      const admit = admitConnection(gen, conn);
      if (admit != null) return admit as Promise<never>;
      return fetchPage<ClientSummary15>(conn, ENDPOINTS.clients, params, page, sig);
    }, signal).then((rows) => rows.map((row) => mapClientSummary(row, labels)));
  };
}

export { authHeaders };
