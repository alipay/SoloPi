import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE, type DataArea } from '../api/areas';
import { markConnectionHealth } from '../api/connection';
import { useOnlineStatus } from './useOnlineStatus';

export type AreaStatus =
  | 'not-wired' // 服务端合同未确认，页面显示未接入
  | 'loading' // 首次读取中
  | 'ready' // 有数据
  | 'empty' // 读取成功但为空
  | 'error' // 最近一次读取失败
  | 'offline'; // 保留状态契约；实际请求失败使用 error

export interface PollState<T> {
  status: AreaStatus;
  rows: T[];
  /** 最近一次成功读取的时间戳（ms）；null 表示从未成功 */
  lastUpdatedAt: number | null;
  /** 后台轮询/手动重试进行中 */
  refreshing: boolean;
  offline: boolean;
  error: string | null;
  /** 手动重试/刷新 */
  refresh: () => void;
}

/** 单次读取的默认总超时（ms）；数据区可用 requestTimeoutMs 覆盖 */
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

/**
 * 轮询读取状态的通用 hook。
 *
 * 请求生命周期约束（W2/C1 修复）：
 * - 代次校验：任何超时/取消/作用域切换都使旧请求过期，过期请求的
 *   then/catch/finally 一律不回写行数据、lastUpdatedAt 或刷新态。
 * - 占位保护：只有当前在途请求可以释放并发占位，迟返回的旧请求不清除新请求。
 * - 作用域切换：area 变化立即复位 rows/status/lastUpdatedAt，新响应到达前
 *   不显示上一作用域数据。
 * - 卸载清理：无论是否有轮询定时器，卸载时都中止在途请求。
 * - 联网事件：只触发重试，不依赖浏览器的联网标志阻断请求；
 *   每次请求带总超时，避免无界 pending。
 *
 * 轮询只是网页读取策略，不替代服务端合同要求的 Client 出站 WSS 与事件恢复能力。
 */
export function usePollingArea<T>(area: DataArea<T>): PollState<T> {
  const online = useOnlineStatus();
  const [status, setStatus] = useState<AreaStatus>(area.wired ? 'loading' : 'not-wired');
  const [rows, setRows] = useState<T[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // requestSeq 唯一标识在途/最近请求；旧请求发起后被取消时序号不回退
  const requestSeq = useRef(0);
  const inFlight = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    if (!area.wired || area.fetchers == null) return;
    if (inFlight.current != null) return; // 并发互斥：同一时刻仅一个在途请求

    const controller = new AbortController();
    inFlight.current = controller;
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    setRefreshing(true);

    // 请求总超时（W3/C6复核修复）：中止之外还必须失效该请求代次并释放占位——
    // 否则忽略 AbortSignal 的 reader 会占住占位导致永久 loading，
    // 且迟返回成功仍能回写 rows/lastUpdatedAt（代次未失效时不匹配Existing守卫拦不住）。
    const timeoutId = window.setTimeout(() => {
      controller.abort();
      if (seq !== requestSeq.current) return; // 已被卸载/切换/离线路径失效
      requestSeq.current += 1; // 代次失效：迟返回的 then/catch 一律跳过
      if (inFlight.current === controller) inFlight.current = null; // 释放占位，允许重试/下一轮轮询
      setRefreshing(false);
      setError('读取超时（或被中止），已放弃本次请求');
      setStatus('error');
      markConnectionHealth('unreachable');
    }, area.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);

    area
      .fetchers.read(API_BASE, controller.signal)
      .then((list) => {
        if (seq !== requestSeq.current) return; // 过期请求不回写
        setRows(list);
        setLastUpdatedAt(Date.now());
        setError(null);
        setStatus(Array.isArray(list) && list.length > 0 ? 'ready' : 'empty');
        markConnectionHealth('ok'); // W7：真实读取成功
      })
      .catch((err: unknown) => {
        if (seq !== requestSeq.current) return;
        setError(
          controller.signal.aborted
            ? '读取超时或被中止，已放弃本次请求'
            : err instanceof Error
              ? err.message
              : String(err),
        );
        // W6边界：授权失效（401/403）即失去数据可见性——清除已取行与时间戳，
        // 显示未知与原因；其他失败（网络/5xx/超时）保留最后成功数据并标注陈旧。
        const status = (err as { status?: unknown } | null)?.status;
        if (status === 401 || status === 403) {
          setRows((prev) => (prev.length === 0 ? prev : []));
          setLastUpdatedAt(null);
          markConnectionHealth('denied'); // 授权失败保持独立
        } else {
          markConnectionHealth('unreachable');
        }
        setStatus('error');
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        // 仅当前在途请求可释放占位；迟返回的旧请求不动新请求的占位
        if (inFlight.current === controller) inFlight.current = null;
        if (seq === requestSeq.current) setRefreshing(false);
      });
  }, [area]);

  // 挂载/area 变化：复位状态并重新读取；卸载无条件中止在途请求与定时器
  useEffect(() => {
    requestSeq.current += 1; // 使旧作用域请求过期
    inFlight.current?.abort();
    inFlight.current = null;

    setStatus(area.wired ? 'loading' : 'not-wired');
    // 引用安全的复位：已是默认值时不产生新的数组引用，
    // 防止调用方传入不稳定 area 对象时形成「effect→setState→effect」无限重渲染。
    setRows((prev) => (prev.length === 0 ? prev : []));
    setLastUpdatedAt(null);
    setError(null);
    setRefreshing(false);

    if (area.wired) refresh();

    let timer: number | undefined;
    if (area.wired && area.pollIntervalMs > 0) {
      timer = window.setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        refresh();
      }, area.pollIntervalMs);
    }

    return () => {
      if (timer !== undefined) window.clearInterval(timer);
      requestSeq.current += 1; // 卸载后使在途请求过期，禁止回调 setState
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [area, refresh]);

  // 浏览器联网事件只是重试提示，不能证明当前 Server 不可访问。
  // 不取消已有请求；即使 navigator.onLine=false，仍按实际回执和超时判断。
  const prevOnline = useRef(online);
  useEffect(() => {
    if (prevOnline.current === online) return;
    prevOnline.current = online;
    if (area.wired) refresh();
  }, [online, area, refresh]);

  return { status, rows, lastUpdatedAt, refreshing, offline: false, error, refresh };
}
