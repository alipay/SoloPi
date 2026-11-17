import { useMemo, useSyncExternalStore } from 'react';
import type { DataArea } from '../api/areas';
import {
  getRuntimeConnection,
  subscribeConnection,
  type RuntimeConnection,
} from '../api/connection';

/** 非加密用途的短指纹（仅用于让scope/token变化时触发数据区复位） */
function shortFingerprint(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * 连接反应式数据区（W6真实只读接线）：
 * - 无连接 → 返回原未接线数据区（wired:false，页面显示尚未接入）；
 * - 有连接 → wired:true，fetchers 由受控工厂按当前连接构建；
 *   key 追加 scope+token指纹，切换scope或换token时自动复位轮询状态
 *   （沿用W2的area复位语义：旧数据立即清除，不残留前一连接的行）。
 * 真实读取的服务端前提见 README：C10放行候选 + 受控授权映射交付。
 */
export function useLiveArea<T>(
  base: DataArea<T>,
  build: (conn: RuntimeConnection) => (baseUrl: string, signal: AbortSignal) => Promise<T[]>,
): DataArea<T> {
  const conn = useSyncExternalStore(subscribeConnection, getRuntimeConnection);
  return useMemo(() => {
    if (conn == null) return base;
    return {
      ...base,
      key: `${base.key}:${conn.scope.orgId}:${conn.scope.projectId}:${shortFingerprint(conn.adminToken)}`,
      wired: true,
      fetchers: { read: build(conn) },
    };
  }, [base, conn]);
}
