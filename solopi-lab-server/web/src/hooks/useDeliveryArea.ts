import { useMemo, useSyncExternalStore } from 'react';
import type { DataArea } from '../api/areas';
import { getConnectionView, subscribeConnection } from '../api/connection';
import { useLiveArea } from './useLiveArea';
import type { RuntimeConnection } from '../api/connection';

/**
 * 交付数据区（W11）：
 * - 同源只读代理可用（proxyRo=true）→ **固定scope只读模式接管**：
 *   数据区装配 /ro fetchers（无token），浏览器连接配置/旧token不得改变代理scope。
 * - proxyRo=false → 原 useLiveArea 路径（未接线展示 / HTTPS手工连接）完整保留。
 * hook调用顺序恒定（先useLiveArea再useSyncExternalStore/memo），符合React规范。
 */
export function useDeliveryArea<T>(
  base: DataArea<T>,
  buildRo: () => (baseUrl: string, signal: AbortSignal) => Promise<T[]>,
  buildLive: (conn: RuntimeConnection) => (baseUrl: string, signal: AbortSignal) => Promise<T[]>,
): DataArea<T> {
  const liveArea = useLiveArea(base, buildLive);
  const view = useSyncExternalStore(subscribeConnection, getConnectionView);
  const roArea = useMemo<DataArea<T>>(
    () => ({
      ...base,
      key: `${base.key}:ro:${'solopi-lab'}/${'glasses'}`,
      wired: true,
      fetchers: { read: buildRo() },
    }),
    [base],
  );
  if (view.proxyRo) return roArea; // RO接管：连接配置无法改变只读代理的scope
  return liveArea;
}
