/**
 * 设备与媒体合同 **v0.2.0（commit 519be67 冻结候选）** 形状镜像（W13/W13b/W15）。
 *
 * 来源：`contracts/v0.2.0/schemas/device.schema.json`、`media.schema.json`。
 * 本文件仅消费服务端合同的字段名做组件形状——不定义字段、不写API/部署配置。
 *
 * W15对齐（519be67）：deviceSummary 使用**唯一权威状态字段 `status`**
 * （online|stale|offline，服务端快照+租约双因子裁决）——冗余 `online` 字段废除；
 * RO最小投影不含 adbSerial/discoveryFingerprint；RO设备面无媒体端点、无写方法。
 * 诚实边界不变：合同冻结但部署等非作者复核通过（/ro/devices probe门控），
 * 未接通前渲染「未接入」，不展示fixtures、不假报画面；媒体授权不因RO匿名列表自动获得。
 */

export const DEVICES_CONTRACT_VERSION = 'v0.2.0';

export type DeviceKind = 'phone' | 'glasses' | 'tablet' | 'other';

/** 服务端唯一权威设备三态（v0.2.0唯一状态字段status的枚举） */
export type DevicePresence = 'online' | 'stale' | 'offline';

/**
 * 设备快照行（v0.2.0冻结版 deviceSummary / RO最小投影）：
 * 唯一状态字段 `status`；不含 adbSerial / discoveryFingerprint（不出RO面）。
 */
export interface DeviceSummaryDraft {
  orgId: string;
  projectId: string;
  clientId: string;
  deviceId: string;
  deviceName?: string | null;
  kind: DeviceKind;
  /** 服务端唯一权威三态——页面禁止自行推导，不猜配对 */
  status: DevicePresence;
  lastSeenAt: string | null;
  lastSnapshotAt: string;
  lastSnapshotId?: string | null;
  discoveredAt: string;
}

export interface DevicesPageDraft {
  items: DeviceSummaryDraft[];
  page: number;
  pageSize: number;
  nextPage: number | null;
}

/**
 * 媒体会话状态机视图（草案§2.1）：
 * authorized → negotiating → active(需四层证据) → stopping → stopped|failed|abandoned；
 * 证据缺席+租约到期→unknown，不任意复活。
 */
export type MediaSessionStatus =
  | 'authorized'
  | 'negotiating'
  | 'active'
  | 'stopping'
  | 'stopped'
  | 'failed'
  | 'abandoned'
  | 'unknown';

/** 页面可见的投屏面板状态：面板由服务端会话状态驱动，不本地造帧 */
export interface ScreenPanelState {
  /** 媒体合同与传输是否实际接入（冻结+部署后为true） */
  wired: boolean;
  sessionStatus?: MediaSessionStatus;
  /** 最近四层证据（active态由服务端证据持续归档，页面只展示已上报值） */
  evidenceLayers?: { packetReceived: number | null; decodedFrames: number | null; rendered: number | null; audioPlayed: number | null };
  lastEvidenceAt?: string | null;
  error?: string | null;
}
