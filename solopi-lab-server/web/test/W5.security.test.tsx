/**
 * W5 安全回归：连接入口收紧 + 部署状态标注。
 *
 * 责任包要求：远程管理Bearer不得发往明文HTTP（本机隔离开发例外须明确）、
 * 拒URL内凭据与危险scheme、断开后旧数据语义、跨scope取数绑定、内存token生命周期，
 * 未连接页面显著标注未知注册数量。
 */
import { cleanup, render, screen, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  clearRuntimeConnection,
  describeRuntimeConnection,
  setRuntimeConnection,
} from '../src/api/connection';
import { createClientsRead } from '../src/api/fetchers-v015';
import { UnconnectedNotice } from '../src/components/UnconnectedNotice';
import { usePollingArea } from '../src/hooks/usePollingArea';
import { CLIENTS_AREA } from '../src/api/areas';
import type { DataArea } from '../src/api/areas';

const U = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const U_A2 = '02' + U.slice(2);

afterEach(() => {
  cleanup();
  clearRuntimeConnection();
});

describe('W5 连接入口安全收紧', () => {
  const tried = (apiBaseUrl: string): string | null =>
    setRuntimeConnection({
      apiBaseUrl,
      adminToken: 't',
      scope: { orgId: U, projectId: U },
    });

  it('远程 http 基址被拒绝且不落存储（管理Bearer不得发往明文HTTP）', () => {
    expect(tried('http://lab.example:18999')).toMatch(/明文 HTTP/);
    expect(tried('http://203.0.113.5:18999')).toMatch(/明文 HTTP/);
    expect(describeRuntimeConnection().configured).toBe(false); // 拒绝的输入未被保存
  });

  it('本机隔离开发例外：127.0.0.1/localhost 的 http 允许并成功保存', () => {
    expect(tried('http://127.0.0.1:18999')).toBeNull();
    expect(describeRuntimeConnection().configured).toBe(true);
    clearRuntimeConnection();
    expect(tried('http://localhost:18999')).toBeNull();
    expect(describeRuntimeConnection().configured).toBe(true);
  });

  it('受控 https 允许', () => {
    expect(tried('https://lab.example:18999')).toBeNull();
  });

  it('URL内嵌凭据（userinfo）被拒绝', () => {
    expect(tried('https://user:pass@lab.example:18999')).toMatch(/用户名\/密码/);
    expect(tried('https://token@lab.example')).toMatch(/用户名\/密码/);
  });

  it('危险scheme一律拒绝（仅http/https）', () => {
    expect(tried('ws://lab.example:18999')).toMatch(/scheme/);
    expect(tried('ftp://lab.example')).toMatch(/scheme/);
    expect(tried('file:///etc/passwd')).toMatch(/scheme/);
  });
});

describe('W5 跨scope/断开语义', () => {
  it('fetcher与创建时的scope绑定（跨scope取数必须显式新建连接，不互渗）', async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return {
        ok: true,
        json: async () => ({ items: [], page: 1, pageSize: 200, nextPage: null }),
      } as Response;
    });
    try {
      const connA = { apiBaseUrl: 'https://lab.example', adminToken: 'tok', scope: { orgId: U, projectId: U } };
      const connB = { ...connA, scope: { orgId: U_A2, projectId: U } };
      // W8准入门槛：发起前设置当前身份，调用后再切换（旧fetcher此时应被拒）
      expect(setRuntimeConnection(connA)).toBeNull();
      await createClientsRead(connA)('', new AbortController().signal);
      expect(setRuntimeConnection(connB)).toBeNull();
      await createClientsRead(connB)('', new AbortController().signal);
      await expect(createClientsRead(connA)('', new AbortController().signal)).rejects.toThrow(
        /连接已清除或已更换身份/,
      );
      expect(calls[0].includes(`orgId=${U}`)).toBe(true);
      expect(calls[1].includes(`orgId=${U_A2}`)).toBe(true);
      expect(calls[0]).not.toContain(U_A2);
      expect(calls[1]).not.toContain(`orgId=${U}&`);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('断开（读取失败）后旧数据保留并显式标注陈旧——W2既定语义回归', async () => {
    const area: DataArea<unknown> = {
      ...CLIENTS_AREA,
      key: 'w5-stale',
      wired: true,
      fetchers: {
        read: vi
          .fn<() => Promise<unknown[]>>()
          .mockResolvedValueOnce(['row-1'])
          .mockRejectedValueOnce(new Error('HTTP 503：后端未就绪')),
      },
      pollIntervalMs: 10_000,
    };
    const h = renderHook(() => usePollingArea(area));
    await waitFor(() => expect(h.result.current.status).toBe('ready'));
    h.result.current.refresh();
    await waitFor(() => expect(h.result.current.status).toBe('error'));
    expect(h.result.current.rows).toEqual(['row-1']); // 保留最后成功数据（陈旧由AreaView显式标注）
    expect(h.result.current.lastUpdatedAt).not.toBeNull();
    expect(h.result.current.error).toMatch(/503/);
  });

  it('切换scope后新响应前旧数据清空（W2回归语义复列断言）', async () => {
    const hang = () => new Promise<unknown[]>(() => undefined);
    const areaA: DataArea<unknown> = {
      ...CLIENTS_AREA, key: 'w5-a', wired: true, fetchers: { read: () => Promise.resolve(['a1']) }, pollIntervalMs: 10_000,
    };
    const areaB: DataArea<unknown> = {
      ...CLIENTS_AREA, key: 'w5-b', wired: true, fetchers: { read: () => hang() }, pollIntervalMs: 10_000,
    };
    const h = renderHook(({ value }) => usePollingArea(value), { initialProps: { value: areaA } });
    await waitFor(() => expect(h.result.current.status).toBe('ready'));
    h.rerender({ value: areaB });
    expect(h.result.current.rows).toEqual([]);
    expect(h.result.current.lastUpdatedAt).toBe(null);
  });
});

describe('W5 部署状态标注', () => {
  it('未连接横幅显著标注未知注册数量', () => {
    render(<UnconnectedNotice />);
    const text = screen.getByTestId('unconnected-notice').textContent ?? '';
    expect(text).toMatch(/未连接/);
    expect(text).toMatch(/已注册电脑数量：未知/);
    expect(text).toMatch(/尚未接入/);
  });
});
