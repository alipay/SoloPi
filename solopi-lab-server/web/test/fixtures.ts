import type { ClientRecord, EnrollmentRequest } from '../src/api/types';
import type { DataArea } from '../src/api/areas';

/**
 * 测试专用 fixture：只在隔离组件测试中使用，
 * 不会被打进任何运行时页面（生产页面使用 src/api/areas.ts 的未接线数据区）。
 */

export const fxEnrollments: EnrollmentRequest[] = [
  {
    enrollmentId: 'enr-0001',
    installationId: 'inst-alpha-0001',
    publicKeyFingerprint: 'SHA256:9f2c…e81a',
    scope: { org: 'orgA', project: 'paybox' },
    clientVersion: '0.1.143',
    createdAt: '2026-11-03T15:40:00+08:00',
  },
  {
    enrollmentId: 'enr-0002',
    installationId: 'inst-beta-0002',
    publicKeyFingerprint: 'SHA256:71bd…04cc',
    scope: { org: 'orgB', project: 'glasses' },
    clientVersion: '0.1.142',
    createdAt: '2026-11-03T15:55:00+08:00',
  },
];

export const fxClients: ClientRecord[] = [
  {
    clientId: 'dev-orgA-0001',
    displayName: 'PayBox 台架 01',
    installationId: 'inst-alpha-0001',
    scope: { org: 'orgA', project: 'paybox' },
    registration: { status: 'approved', approvedAt: '2026-11-03T10:00:00+08:00' },
    clientVersion: '0.1.143',
    capabilities: { media: true, command: true },
    online: 'online',
    lastHeartbeatAt: '2026-11-03T16:05:00+08:00',
    leaseExpiresAt: '2026-11-03T16:35:00+08:00',
  },
  {
    clientId: 'dev-orgA-0002',
    displayName: 'PayBox 台架 02',
    installationId: 'inst-alpha-0002',
    scope: { org: 'orgA', project: 'paybox' },
    registration: { status: 'pending', approvedAt: null },
    clientVersion: '0.1.143',
    capabilities: { media: true, command: false },
    // online 未提供：页面必须显示「未知」，不凭「从未心跳」推导离线
    lastHeartbeatAt: null,
    leaseExpiresAt: null,
  },
  {
    clientId: 'dev-orgB-0001',
    displayName: 'Glasses 工位 01',
    installationId: 'inst-beta-0002',
    scope: { org: 'orgB', project: 'glasses' },
    registration: { status: 'approved', approvedAt: '2026-11-03T09:00:00+08:00' },
    clientVersion: '0.1.142',
    capabilities: { media: false, command: true },
    online: 'offline',
    lastHeartbeatAt: '2026-11-03T15:50:00+08:00',
    leaseExpiresAt: '2026-11-03T16:20:00+08:00',
  },
];

/** 接线型测试数据区：fetcher 由测试注入（fixture 只经 fetcher 进入组件） */
export function wiredTestArea<T>(
  read: (base: string, signal: AbortSignal) => Promise<T[]>,
): DataArea<T> {
  return {
    key: `test-${Math.random().toString(36).slice(2)}`,
    title: '测试数据区',
    wired: true,
    pendingReason: [],
    draftEndpoints: [],
    fetchers: { read },
    pollIntervalMs: 1_200_000, // 单测不依赖间隔轮询，取大值避免干扰
  };
}
