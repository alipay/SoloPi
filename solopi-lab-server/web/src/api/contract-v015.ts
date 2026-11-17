/**
 * SoloPi Lab Server 共享合同 **v0.1.5**（manifest
 * `0cde63eeffd8cf26241ce9d6b46c6ea31e53941594c5e3e4a316e8465f132dca`）
 * 只读面的 TypeScript 镜像。
 *
 * 字段以 `contracts/v0.1.5/schemas/*.schema.json` 冻结文件为准
 * （本文件仅手工镜像阶段A两列表页所需读形状，不读在途 v0.1.6）。
 * 在途 v0.1.6 半成品不作为任何输入；合同升级时同步升级本文件并保留版本注释。
 */

export const CONTRACT_VERSION = '0.1.5';

/** Server 响应头：`X-Solopi-Contract-Version`，用于运行时校验后端合同版本 */
export const CONTRACT_VERSION_HEADER = 'X-Solopi-Contract-Version';

export type IsoUtc = string;

/** 分页envelope（enrollmentsPage / clientsPage 同型） */
export interface PageEnvelope<T> {
  items: T[];
  page: number;
  pageSize: number;
  nextPage: number | null;
}

export type EnrollmentStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'revoked'
  | 'expired';

/** enrollmentRow（v0.1.5 带 status→clientId 条件约束） */
export interface EnrollmentRow15 {
  enrollmentId: string;
  installationId: string;
  status: EnrollmentStatus;
  keyFingerprint: string;
  clientVersion: string;
  scope: { orgId: string; projectId: string };
  deviceScope: { deviceId: string; os: string; hostname: string; description?: string };
  requestedAt: IsoUtc;
  /** pending/rejected 必为 null；approved/revoked/expired 必为 ULID */
  clientId: string | null;
  decidedAt?: IsoUtc | null;
}

/** clientSummary（v0.1.5） */
export type Presence15 = 'online' | 'offline' | 'unknown';

export interface ClientSummary15 {
  orgId: string;
  projectId: string;
  clientId: string;
  installationId: string;
  keyFingerprint: string;
  status: EnrollmentStatus;
  online: Presence15;
  lastHeartbeatAt: IsoUtc | null;
  leaseExpiresAt: IsoUtc | null;
  /** v0.1.5 收编1：client.client_version 可空 */
  clientVersion?: string | null;
  capabilities: { commands: boolean; media: boolean };
  occupancy: { localUiTasks: number; cliTasks: number };
  deviceScope: { deviceId: string; os: string; hostname: string; description?: string };
  grantedAt?: IsoUtc | null;
  validUntil?: IsoUtc | null;
}

/** 错误envelope（error.schema.json） */
export interface ContractError15 {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
  retryAfterSec?: number;
}

/** 阶段A两列表读取端点（相对路径，基址由运行时连接配置提供） */
export const ENDPOINTS = {
  enrollments: '/v1/enrollments',
  clients: '/v1/clients',
} as const;

/** ULID（Crockford base32，首字符 0-7） */
export const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export function isUlid(value: string): boolean {
  return ULID_PATTERN.test(value);
}
