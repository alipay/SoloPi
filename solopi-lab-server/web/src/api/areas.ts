import type { ClientRecord, EnrollmentRequest } from './types';

/**
 * 数据区接线清单（W1 单一事实来源）。
 *
 * `wired: false` 是字面量类型：服务端合同确认、字段/路径定稿之前，
 * 页面一律显示「未接入」，不发起请求、不渲染编造数据、不显示成功结果。
 * 接线时把对应数据区改为 `wired: true` 并提供 fetcher，
 * loading/空/失败/离线/最后更新时间状态由 usePollingArea 自动激活。
 */

export interface DraftEndpoint {
  method: string;
  /** 草案的相对路径，仅用于向读者说明缺口；最终路径以服务端合同为准 */
  path: string;
  purpose: string;
  /** 写操作：合同确认前必须保持不可提交 */
  write: boolean;
}

export interface DataArea<T> {
  key: string;
  title: string;
  wired: boolean;
  /** 未接入时的合同缺口说明，wait 指向服务端合同草案责任人 */
  pendingReason: string[];
  draftEndpoints: DraftEndpoint[];
  /** 接线后生效的读取函数 */
  fetchers?: {
    read: (base: string, signal: AbortSignal) => Promise<T[]>;
  };
  pollIntervalMs: number;
  /** 单次读取总超时（ms）；缺省 15s，避免无界 pending */
  requestTimeoutMs?: number;
}

/** API 基址从环境注入；W1 未接线状态下不使用 */
export const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';

export const ENROLLMENTS_AREA: DataArea<EnrollmentRequest> = {
  key: 'enrollments',
  title: '注册审批',
  wired: false,
  pendingReason: [
    '服务端注册/审批合同尚未定稿（schema 提案由服务端负责人单独负责）',
    '页面不猜测接口路径与字段，不编造待审批数据',
  ],
  draftEndpoints: [
    {
      method: 'GET',
      path: 'GET /enrollments?status=pending（草案）',
      purpose: '读取待审批的 Client 注册申请',
      write: false,
    },
    {
      method: 'POST',
      path: '批准 / 拒绝（草案）',
      purpose: '审批注册申请（状态变更）',
      write: true,
    },
  ],
  pollIntervalMs: 10_000,
};

export const CLIENTS_AREA: DataArea<ClientRecord> = {
  key: 'clients',
  title: 'Client 状态',
  wired: false,
  pendingReason: [
    '服务端 Client 身份/心跳/租约字段尚未定稿',
    '在线判定由服务端心跳/租约合同给出，页面不自行猜测设备状态',
  ],
  draftEndpoints: [
    {
      method: 'GET',
      path: 'GET /clients（草案）',
      purpose: '读取当前作用域内注册 Client 的状态/心跳/租约',
      write: false,
    },
    {
      method: 'POST',
      path: '吊销 / 续期（草案）',
      purpose: '吊销注册或续期短租约（状态变更）',
      write: true,
    },
  ],
  pollIntervalMs: 10_000,
};

export const BOOTSTRAP_AREA: DataArea<unknown> = {
  key: 'enrollment-bootstrap',
  title: '注册引导配置',
  wired: false,
  pendingReason: [
    '注册引导值（服务端地址、注册端点、一次性令牌下发方式）必须由服务端真实下发',
    '页面不显示模板命令或示例值冒充可用配置',
  ],
  draftEndpoints: [
    {
      method: 'GET',
      path: 'GET /enrollment/bootstrap（草案）',
      purpose: '读取本站点的真实注册引导配置',
      write: false,
    },
  ],
  pollIntervalMs: 0,
};
