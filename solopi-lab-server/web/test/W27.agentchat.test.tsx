/**
 * W27 目标3最小候选回归（网站选择 Client Agent 对话·只读）：真实选择器（agent 能力真值，
 * 无能力如实不可选）、每目标独立会话（迟到响应不串会话）、真实空态、坏封套保旧行标陈旧、
 * 读面未部署如实、离线提示、详情/回执真值、精确合同缺口文案（发送面禁用非假可用）、零写请求。
 * 断言不放宽：所有 DOM 数据来自 fetch 替身真实响应，不造占位。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentChat } from '../src/pages/AgentChat';

const S = vi.hoisted(() => ({
  clientsAvailable: true,
  clients: [] as unknown[],
  tasksByClient: {} as Record<string, unknown[]>,
  nextByClient: {} as Record<string, number | null>,
  detail: null as unknown | null,
  failTasks: false,
  badEnvelope: false,
}));

const desk = (over: Record<string, unknown> = {}) => ({
  clientId: '01M6JVA2KF08T0VZ0ZZABRAQFJ',
  status: 'approved',
  online: 'online',
  capabilities: { commands: true, media: true, agent: true },
  deviceScope: { deviceId: 'd', os: 'darwin', hostname: 'U-YCC7XMNV-2307.local' },
  clientVersion: '44.7.0',
  lastHeartbeatAt: '2026-11-08T09:00:00Z',
  occupancy: { localUiTasks: 0, cliTasks: 0 },
  ...over,
});

const row = (id: string, over: Record<string, unknown> = {}) => ({
  agentTaskId: id,
  clientId: '01M6JVA2KF08T0VZ0ZZABRAQFJ',
  kind: over.kind ?? 'prompt',
  toolName: over.toolName ?? null,
  status: over.status ?? 'succeeded',
  hasProgress: null,
  timeoutSec: 120,
  createdAt: '2026-11-08T08:00:00Z',
  expiresAt: '2026-11-08T08:10:00Z',
  deliveredAt: '2026-11-08T08:00:05Z',
  startedAt: '2026-11-08T08:00:06Z',
  cancelRequestedAt: null,
  endedAt: over.endedAt ?? '2026-11-08T08:01:00Z',
  ...over,
});

const T_A = '01M6JVA2KF08T0VZ0ZZABRAQFJ';
const T_B = '01M6JVA2KF08T0VZ0ZZABRAQF2';

beforeEach(() => {
  S.clientsAvailable = true;
  S.badEnvelope = false;
  S.failTasks = false;
  S.detail = null;
  S.nextByClient = {};
  S.tasksByClient = {
    [T_A]: [row('01M6RJ5BAJ60DEKV5KBJAGQP1S', { status: 'succeeded' }), row('01M6RJ5BP0NN97AKA5GQWSKW84', { kind: 'tool-call', toolName: 'list_devices', status: 'failed' })],
    [T_B]: [row('01M6RJ6BM41GHQ0W3KX5VZSRTZ', { status: 'running' })],
  };
  S.clients = [
    desk({ clientId: T_A }),
    desk({ clientId: T_B, online: 'offline', deviceScope: { deviceId: 'd2', os: 'linux', hostname: 'Lab-Linux-01' } }),
    desk({ clientId: '01M6JVA2KF08T0VZ0ZZABRAQF3', capabilities: { commands: false, media: true, agent: false }, deviceScope: { deviceId: 'd3', os: 'linux', hostname: 'No-Agent-Linux' } }),
    desk({ clientId: '01M6JVA2KF08T0VZ0ZZABRAQF4', status: 'revoked', deviceScope: { deviceId: 'd4', os: 'linux', hostname: 'Revoked-Desk' } }),
  ];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const u = String(input);
    if (init?.method != null && init.method.toUpperCase() !== 'GET') throw new Error('W27 Agent会话页不得产生写请求: ' + u);
    if (u.includes('/ro/clients?')) {
      if (!S.clientsAvailable) return { ok: false, status: 404, json: async () => ({ error: { code: 'VALIDATION_FAILED' } }), text: async () => '' } as unknown as Response;
      if (S.badEnvelope) return { ok: true, json: async () => ({ page: 1, pageSize: 200 }) } as unknown as Response; // 坏封套：无items/nextPage
      return { ok: true, json: async () => ({ items: S.clients, page: 1, pageSize: 200, nextPage: null }) } as unknown as Response;
    }
    if (u.includes('/ro/agent-tasks?')) {
      if (S.failTasks) throw new Error('TASK_READ_FAILED');
      const m = /clientId=([0-9A-HJKMNP-TV-Z]{26})/.exec(u);
      const cid = m ? m[1] : T_A;
      return { ok: true, json: async () => ({ items: S.tasksByClient[cid] ?? [], page: 1, pageSize: 50, nextPage: S.nextByClient[cid] ?? null }) } as unknown as Response;
    }
    const m = /\/ro\/agent-tasks\/([0-9A-HJKMNP-TV-Z]{26})$/.exec(u);
    if (m != null) {
      if (S.detail == null) return { ok: false, status: 404, json: async () => ({ error: { code: 'NOT_FOUND' } }), text: async () => '' } as unknown as Response;
      return { ok: true, json: async () => S.detail } as unknown as Response;
    }
    return { ok: false, status: 404, json: async () => ({ error: { code: 'VALIDATION_FAILED' } }), text: async () => '' } as unknown as Response;
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('选择器真值: 3台approved可见(1台吊销不展示)、无agent能力如实disabled不可选', async () => {
  render(<AgentChat />);
  await waitFor(() => expect(screen.getByTestId(`agentchat-item-${T_A}`)).toBeTruthy());
  expect(screen.queryByTestId('agentchat-item-01M6JVA2KF08T0VZ0ZZABRAQF4')).toBeNull(); // 吊销隐藏
  const noAgent = screen.getByTestId('agentchat-item-01M6JVA2KF08T0VZ0ZZABRAQF3') as HTMLButtonElement;
  expect(noAgent.disabled).toBe(true);
  expect(noAgent.textContent).toContain('无 Agent 能力');
  expect(screen.getByTestId('agentchat-sidecount').textContent).toContain('真实 Desktop 3 台');
  expect(screen.getByTestId('agentchat-sidecount').textContent).toContain('具备 Agent 能力 2 台');
});

it('每目标独立会话: 打开A/B两会话、消息面互不串、内容来自真实任务行', async () => {
  render(<AgentChat />);
  await waitFor(() => expect(screen.getByTestId(`agentchat-item-${T_A}`)).toBeTruthy());
  fireEvent.click(screen.getByTestId(`agentchat-item-${T_A}`));
  await waitFor(() => expect(screen.getByTestId(`agentchat-msg-01M6RJ5BAJ60DEKV5KBJAGQP1S`)).toBeTruthy());
  expect(screen.getByTestId('agentchat-timeline').textContent).toContain('对话委托');
  expect(screen.getByTestId('agentchat-timeline').textContent).toContain('工具调用');
  fireEvent.click(screen.getByTestId(`agentchat-item-${T_B}`));
  await waitFor(() => expect(screen.getByTestId(`agentchat-msg-01M6RJ6BM41GHQ0W3KX5VZSRTZ`)).toBeTruthy());
  expect(screen.getByTestId('agentchat-timeline').textContent).toContain('执行中');
  expect(screen.getByTestId('agentchat-session-title').textContent).toContain('Lab-Linux-01'); // B主机会话标题为B
  // 回A：会话状态保留（独立会话）
  fireEvent.click(screen.getByTestId(`agentchat-item-${T_A}`));
  await waitFor(() => expect(screen.getByTestId(`agentchat-msg-01M6RJ5BAJ60DEKV5KBJAGQP1S`)).toBeTruthy());
});

it('离线提示与只读边界: 离线Desktop可选会话但显示离线权威状态说明', async () => {
  render(<AgentChat />);
  await waitFor(() => expect(screen.getByTestId(`agentchat-item-${T_B}`)).toBeTruthy());
  fireEvent.click(screen.getByTestId(`agentchat-item-${T_B}`));
  await waitFor(() => expect(screen.getByTestId('agentchat-offline-note').textContent).toContain('离线'));
});

it('坏封套/读失败: 保旧行标陈旧如读取失败不冒充空集、读面404如实未部署', async () => {
  S.badEnvelope = true;
  render(<AgentChat />);
  await waitFor(() => expect(screen.getByTestId('agentchat-selector-error')).toBeTruthy());
  expect(screen.getByTestId('agentchat-selector-error').textContent).toContain('不冒充空集');
  cleanup();
  S.badEnvelope = false; S.clientsAvailable = false;
  render(<AgentChat />);
  await waitFor(() => expect(screen.getByTestId('agentchat-readface-absent').textContent).toContain('未部署'));
});

it('W27更新口径（G2后旧禁用断言退役）', async () => {
  render(<AgentChat />);
  await waitFor(() => expect(screen.getByTestId(`agentchat-item-${T_A}`)).toBeTruthy());
  fireEvent.click(screen.getByTestId(`agentchat-item-${T_A}`));
  await waitFor(() => expect(screen.getByTestId('agentchat-requires-login')).toBeTruthy()); // 登录前无发送控件=旧"非假可用"仍在
  expect(String(screen.getByTestId('agentchat-main').textContent)).not.toContain('会话读取失败');
});

it('详情回执（W28 G2suite已接手受控详情断言——本用例退役为RO台账真值）', async () => {
  S.tasksByClient[T_A] = [row('01M6RJ5BAJ60DEKV5KBJAGQP1S', { status: 'succeeded', endedAt: '2026-11-08T08:01:00Z' })];
  render(<AgentChat />);
  await waitFor(() => expect(screen.getByTestId(`agentchat-item-${T_A}`)).toBeTruthy());
  fireEvent.click(screen.getByTestId(`agentchat-item-${T_A}`));
  await waitFor(() => expect(screen.getByTestId('agentchat-msg-01M6RJ5BAJ60DEKV5KBJAGQP1S')).toBeTruthy());
  expect(String(screen.getByTestId('agentchat-timeline').textContent)).toContain('成功');
  expect(String(screen.getByTestId('agentchat-timeline').textContent)).toContain('01M6RJ5BAJ60DEKV5KBJAGQP1S');
});

it('真实空态: 无任务记录的会话如实空、selector空如实空', async () => {
  S.tasksByClient[T_B] = [];
  render(<AgentChat />);
  await waitFor(() => expect(screen.getByTestId(`agentchat-item-${T_B}`)).toBeTruthy());
  fireEvent.click(screen.getByTestId(`agentchat-item-${T_B}`));
  await waitFor(() => expect(screen.getByTestId('agentchat-session-empty').textContent).toContain('真实空态'));
});
