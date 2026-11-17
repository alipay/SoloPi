/**
 * 前端预期的数据字段草稿（DRAFT）。
 *
 * 这些字段名只是网页侧的展示预期，最终版本以服务端共享合同草案为准；
 * 在服务端合同确认前，所有接口保持未接线（见 src/api/areas.ts），
 * 页面不得凭这些草稿编造数据或渲染成功结果。
 */

/** Client 注册状态（对应合同 v0.1.0 ClientSummary.status 枚举；确认前页面只作展示草案） */
export type ClientRegStatus = 'pending' | 'approved' | 'revoked' | 'expired' | 'rejected';

/**
 * Client 在线性（DRAFT→合同 §2.3/§3 的权威字段 `online`：online|offline|unknown）。
 * 在线性由服务端唯一裁决；字段未提供或未接线时页面一律显示「未知」，
 * 禁止由 lastHeartbeatAt/租约自行推导。
 */
export type ClientPresence = 'online' | 'offline' | 'unknown';

/** 注册审批待审条目（草稿字段） */
export interface EnrollmentRequest {
  /** 注册状态（W22：RO 合同 EnrollmentRow15.status 真实携带——页面只读展示，不做任何写） */
  status?: 'pending' | 'approved' | 'rejected' | 'revoked' | 'expired';
  /** 审批单标识，由服务端生成 */
  enrollmentId: string;
  /** 客户端安装身份（预期为稳定 installationId，具体字段名待合同） */
  installationId: string;
  /** 客户端注册公钥指纹（预期服务端已归一化展示，页面不做推导） */
  publicKeyFingerprint: string;
  /** 申请的作用域：组织/项目必须显式展示，禁止跨作用域混读 */
  scope: { org: string; project: string };
  /** 客户端申报版本与能力，字段名待合同 */
  clientVersion: string;
  /** 申请时间（ISO 8601） */
  createdAt: string;
}

/** Client 状态条目（草稿字段） */
export interface ClientRecord {
  /** 服务端作用域内 deviceId（方案要求非裸 SN），字段名待合同 */
  clientId: string;
  displayName: string;
  installationId: string;
  scope: { org: string; project: string };
  registration: { status: ClientRegStatus; approvedAt: string | null };
  clientVersion: string;
  /** 能力声明：媒体/命令执行，具体能力集字段待合同 */
  capabilities: { media: boolean; command: boolean };
  /** 服务端权威在线性（合同 §2.3）：缺省即未知，页面不推导 */
  online?: ClientPresence;
  /** 最近一次心跳时间（ISO 8601；仅作展示，不用于推导在线） */
  lastHeartbeatAt: string | null;
  /** 短租约到期时间（ISO 8601；仅作展示，不用于推导在线） */
  leaseExpiresAt: string | null;
}

/**
 * W22（用户决定）：已吊销 Client 前端隐藏——仅展示层的派生过滤，不触服务端历史/合同/数据。
 * 吊销是注册状态（ClientRegStatus==='revoked'）的**权威终态**；与连接在线三态
 * （online/stale/offline）、读取陈旧（stale-read）、未知（unknown/pending）完全不同轴——
 * 后者用于读取完整性语义，绝不能混作吊销判定。共享单一函数防各页内联漂移。
 */
export function isRevokedClient(c: { registration: { status: ClientRegStatus } }): boolean {
  return c.registration.status === 'revoked';
}
