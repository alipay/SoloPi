import { useMemo, useSyncExternalStore } from 'react';
import type { DataArea } from '../api/areas';
import type { DeviceSummaryDraft } from '../api/devices-draft';
import { createRoDevicesRead } from '../api/devices-ro';
import { getConnectionView, subscribeConnection } from '../api/connection';
import { usePollingArea } from './usePollingArea';

/**
 * 共享设备读取视图（W18）：总览 stat/摘要与 Client 卡片统一消费的
 * 明确状态模型——替代各处 probe/成功布尔推断（W17复核反例的根因修复）。
 *
 * `readState.value` 为「未知」时绝不报 0 台；失败保留最近成功设备行
 * 与读取时间并显式标注「读取失败（数据陈旧）」——与服务端设备
 * 自身的 status（online/stale/offline）严格区分：前者是网页读取层
 * 的传输状态，后者是服务端对设备三态的权威裁决。
 */
export type DevicesReadState =
  | { kind: 'unknown'; reason: 'endpoint-not-deployed' | 'pending' | 'error'; error?: string }
  | {
      kind: 'confirmed';
      rows: DeviceSummaryDraft[];
      lastUpdatedAt: number | null;
      reading: boolean;
    }
  // 读取失败但保留最近成功数据：旧行+时间保留并要求明确标注
  | { kind: 'stale-read'; rows: DeviceSummaryDraft[]; lastUpdatedAt: number | null; error: string };

export interface DevicesReadView {
  state: DevicesReadState;
  /** 语义化便捷字段：仅 confirmed 时为 true（成功空集也含0台真值） */
  confirmed: boolean;
  /** 错误信息（pending/endpoint 部署情况下为空） */
  error: string | null;
  /** 最近成功读取时间戳（ready/empty/失败保留时有效；其余 null） */
  lastUpdatedAt: number | null;
  reading: boolean;
  /** 最终DOM成形设备行（confirmed/stale-read 均可展示） */
  rows: DeviceSummaryDraft[];
  /** 手动刷新（仅在 confirmed/stale-read 有意义） */
  refresh: () => void;
}

export function useDevicesReadView(): DevicesReadView {
  const view = useSyncExternalStore(subscribeConnection, getConnectionView);

  const devicesArea = useMemo<DataArea<DeviceSummaryDraft>>(
    () => ({
      key: 'devices:ro:solopi-lab/glasses',
      title: '连接设备',
      wired: view.proxyRo && view.roDevices,
      pendingReason: [],
      draftEndpoints: [],
      pollIntervalMs: 10_000,
      fetchers: view.roDevices ? { read: createRoDevicesRead() } : undefined,
    }),
    [view.proxyRo, view.roDevices],
  );
  const devices = usePollingArea(devicesArea);

  if (!view.roDevices) {
    return {
      state: { kind: 'unknown', reason: 'endpoint-not-deployed' },
      confirmed: false,
      error: null,
      lastUpdatedAt: null,
      reading: false,
      rows: [],
      refresh: () => undefined,
    };
  }

  if (devices.status === 'loading' || devices.status === 'not-wired') {
    return {
      state: { kind: 'unknown', reason: 'pending' },
      confirmed: false,
      error: null,
      lastUpdatedAt: null,
      reading: true,
      rows: [],
      refresh: () => devices.refresh(),
    };
  }

  if (devices.status === 'error') {
    // W19复核修复：错误分支必须区分两种形态——
    // - 从未成功（lastUpdatedAt==null）→ type unknown{reason:'error'}，数量未知不报0台，不冒充有陈旧数据；
    // - 曾成功（lastUpdatedAt!=null）→
    // stale-read，保留最近成功设备行+时间并明确标注读取失败/数据陈旧。
    if (devices.lastUpdatedAt == null) {
      return {
        state: { kind: 'unknown', reason: 'error', error: devices.error ?? '读取失败（原因未知）' },
        confirmed: false,
        error: devices.error,
        lastUpdatedAt: null,
        reading: false,
        rows: [],
        refresh: () => devices.refresh(),
      };
    }
    return {
      state: {
        kind: 'stale-read',
        rows: devices.rows,
        lastUpdatedAt: devices.lastUpdatedAt,
        error: devices.error ?? '读取失败（原因未知）',
      },
      confirmed: false,
      error: devices.error,
      lastUpdatedAt: devices.lastUpdatedAt,
      reading: false,
      rows: devices.rows,
      refresh: () => devices.refresh(),
    };
  }

  if (devices.status === 'offline') {
    return {
      state: { kind: 'unknown', reason: 'error', error: '浏览器离线' },
      confirmed: false,
      error: '浏览器离线',
      lastUpdatedAt: null,
      rows: [],
      reading: false,
      refresh: () => devices.refresh(),
    };
  }

  return {
    state: {
      kind: 'confirmed',
      rows: devices.rows,
      lastUpdatedAt: devices.lastUpdatedAt,
      reading: devices.refreshing,
    },
    confirmed: true,
    error: null,
    lastUpdatedAt: devices.lastUpdatedAt,
    reading: devices.refreshing,
    rows: devices.rows,
    refresh: () => devices.refresh(),
  };
}
