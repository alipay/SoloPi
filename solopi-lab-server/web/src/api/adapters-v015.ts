/**
 * v0.1.5 合同行 → 页面视图模型 的只读适配层（W4）。
 *
 * 原则：
 * - **权威 presence**：on线上性只取 `clientSummary.online`（服务端唯一裁决），
 *   绝不由 lastHeartbeatAt/租约推导；非法值一律降级 unknown。
 * - **防御式映射**：合同行缺关键字段或自相矛盾（如 pending 带 clientId）时，
 *   抛出 AdapterError 进入错误态，不渲染可疑数据、不冒充成功。
 * - **scope 显示**：运行时接口只收 ULID；人类可读 orgKey/projectKey
 *   来自受控授权映射（连接配置），仅作展示标签。
 */
import type { ClientRecord, ClientRegStatus, EnrollmentRequest } from './types';
import type {
  ClientSummary15,
  EnrollmentRow15,
  PageEnvelope,
  Presence15,
} from './contract-v015';

export class AdapterError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AdapterError';
    this.code = code;
  }
}

const PRESENCE_SET: ReadonlySet<Presence15> = new Set(['online', 'offline', 'unknown']);
const REG_STATUS_SET: ReadonlySet<ClientRegStatus> = new Set([
  'pending',
  'approved',
  'revoked',
  'expired',
  'rejected',
]);

/** v0.1.5 条件规则：pending/rejected 必为 null；approved/revoked/expired 必为 ULID */
function validateEnrollmentRow(row: EnrollmentRow15): void {
  if (row.clientId == null && (row.status === 'approved' || row.status === 'revoked' || row.status === 'expired')) {
    throw new AdapterError(
      'CONTRACT_MISMATCH',
      `enrollment ${row.enrollmentId} 状态为 ${row.status} 但缺 clientId（违反v0.1.5条件规则）`,
    );
  }
  if (row.clientId != null && (row.status === 'pending' || row.status === 'rejected')) {
    throw new AdapterError(
      'CONTRACT_MISMATCH',
      `enrollment ${row.enrollmentId} 状态为 ${row.status} 却携带 clientId（违反v0.1.5条件规则）`,
    );
  }
}

/** enrollmentRow → 审批页行视图（W1 视图类型保持稳定，映射集中在适配层） */
export function mapEnrollmentRow(
  row: EnrollmentRow15,
  labels?: { orgKey?: string; projectKey?: string },
): EnrollmentRequest {
  validateEnrollmentRow(row);
  return {
    enrollmentId: row.enrollmentId,
    installationId: row.installationId,
    status: row.status,
    publicKeyFingerprint: row.keyFingerprint,
    scope: {
      org: labels?.orgKey ?? row.scope.orgId,
      project: labels?.projectKey ?? row.scope.projectId,
    },
    clientVersion: row.clientVersion,
    createdAt: row.requestedAt,
  };
}

/** clientSummary → Client 状态页行视图；presence 权威直取 */
export function mapClientSummary(
  s: ClientSummary15,
  labels?: { orgKey?: string; projectKey?: string },
): ClientRecord {
  if (!REG_STATUS_SET.has(s.status)) {
    throw new AdapterError('CONTRACT_MISMATCH', `client ${s.clientId} 注册状态非法：${String(s.status)}`);
  }
  // 权威 presence：只信服务端字段，非法值降级 unknown（不推导）
  const presence: Presence15 = PRESENCE_SET.has(s.online) ? s.online : 'unknown';
  return {
    clientId: s.clientId,
    displayName: s.deviceScope.hostname,
    installationId: s.installationId,
    scope: {
      org: labels?.orgKey ?? s.orgId,
      project: labels?.projectKey ?? s.projectId,
    },
    registration: { status: s.status, approvedAt: s.grantedAt ?? null },
    clientVersion: s.clientVersion ?? '—',
    capabilities: { media: s.capabilities.media, command: s.capabilities.commands },
    online: presence,
    lastHeartbeatAt: s.lastHeartbeatAt,
    leaseExpiresAt: s.leaseExpiresAt,
  };
}

/**
 * 按合同分页envelope聚合全页（只读取数策略）：
 * `nextPage` 为 null 停止；超过 maxPages 显式报错，不静默截断。
 */
export async function fetchAllPages<T>(
  fetchPage: (page: number, signal: AbortSignal) => Promise<PageEnvelope<T>>,
  signal: AbortSignal,
  maxPages = 50,
): Promise<T[]> {
  const all: T[] = [];
  let page = 1;
  for (let i = 0; i < maxPages; i += 1) {
    const env = await fetchPage(page, signal);
    if (!Array.isArray(env.items) || typeof env.page !== 'number' || typeof env.pageSize !== 'number') {
      throw new AdapterError('CONTRACT_MISMATCH', '分页envelope缺少必需字段（items/page/pageSize）');
    }
    all.push(...env.items);
    if (env.nextPage == null) return all;
    if (env.nextPage <= env.page) {
      throw new AdapterError('CONTRACT_MISMATCH', '分页envelope的nextPage未前进，拒绝死循环');
    }
    page = env.nextPage;
  }
  throw new AdapterError(
    'PAGE_LIMIT',
    `分页超过 ${maxPages} 页上限，请缩小查询范围（status/online过滤）后重试`,
  );
}
