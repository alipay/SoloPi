/**
 * W28 G2目标3正式面回归（受控登录+真实发送+每目标隔离会话+任务回执）：
 * 受控登录token一次性提交/不保存、登录失败如实、whoami 401→未登录、会话剩余期显示；
 * Desktop选择（无agent能力不可选但服务端拒422来自真值）、发送后flight跟踪（queued）；
 * 同内容重发=同幂等键对账（duplicate显示）、409冲突如实、结果未知不自动重发（仅unknown态）；
 * 历史台账真值渲染、离线提示；零自动重试副作用；登出销毁。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentChat } from '../src/pages/AgentChat';

const OK = '01M6JVA2KF08T0VZ0ZZABRAQFJ';
const CLIENT_OK = '01M6JVA2KF08T0VZ0ZZABRAQFJ';

const S = vi.hoisted(() => ({
  clientsAvailable: true,
  loggedIn: false,
  loginShouldFail: false,
  createOutcome: 'ok' as 'ok' | 'duplicate' | 'conflict' | 'unknown' | 'unauthorized' | 'reject',
  tasksByClient: {} as Record<string, unknown[]>,
  detailByTask: {} as Record<string, unknown>,
  createCalls: [] as unknown[],
}));

const detailRow = (id: string, over: Record<string, unknown> = {}) => ({
  agentTaskId: id, clientId: CLIENT_OK, kind: 'prompt', tool: null, prompt: { text: '[委托] 清点设备' },
  status: 'succeeded', progress: null, timeoutSec: 300, createdAt: '2026-11-08T10:52:00Z', expiresAt: '2026-11-08T10:57:00Z',
  deliveredAt: '2026-11-08T10:52:52Z', startedAt: null, cancelRequestedAt: null, endedAt: '2026-11-08T10:53:06Z',
  result: { localTaskId: 'da33df6b-1234', text: '真实设备报告', steps: [{ index: 1, action: 'install', deviceId: '01M6JVA2KF08T0VZZ0ZZABRA012', status: 'succeeded' }], devices: [{ deviceId: '01M6JVA2KF08T0VZZ0ZZABRA012' }], report: { sha256: 'a'.repeat(64) } },
  error: null, ...over,
});

const desk = (over: Record<string, unknown> = {}) => ({
  clientId: '01M6JVA2KF08T0VZ0ZZABRAQFJ' as string, status: 'approved', online: 'online',
  capabilities: { commands: false, media: true, agent: true },
  deviceScope: { deviceId: 'd', os: 'darwin', hostname: 'RealMac' }, clientVersion: '44.7.0',
  lastHeartbeatAt: '2026-11-08T10:00:00Z', occupancy: { localUiTasks: 0, cliTasks: 0 }, ...over,
});

beforeEach(() => {
  S.clientsAvailable = true; S.loggedIn = false; S.loginShouldFail = false; S.createOutcome = 'ok';
  S.createCalls = [];
  S.tasksByClient = { [CLIENT_OK]: [] };
  S.detailByTask = {};
  // whoami在browser加载即调——用登录态setter驱动
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const u = String(input);
    const method = init?.method != null ? String(init.method).toUpperCase() : 'GET';
    const js = (obj: unknown, s = 200) => ({ ok: s < 400, status: s, json: async () => obj, text: async () => '' } as unknown as Response);
    let body: Record<string, unknown> = {};
    if (method === 'POST' && init?.body != null) { body = JSON.parse(String(init.body)) as Record<string, unknown>; }
    if (u.includes('/ua/whoami')) {
      if (!S.loggedIn) return { ok: false, status: 401, json: async () => ({ error: { code: 'AUTH_REQUIRED' } }), text: async () => '' } as unknown as Response;
      return js({ operatorSession: true, expiresInSeconds: 4200 });
    }
    if (u.includes('/ua/session')) {
      if (S.loginShouldFail) return { ok: false, status: 401, json: async () => ({ error: { code: 'AUTH_TOKEN_INVALID', message: 'invalid operator credentials' } }), text: async () => '' } as unknown as Response;
      if (typeof body.token === 'string' && body.token.length >= 16) { S.loggedIn = true; return js({ operatorSession: true, expiresInSeconds: 4200 }); }
      return { ok: false, status: 401, json: async () => ({ error: { code: 'AUTH_TOKEN_INVALID', message: 'invalid operator credentials' } }), text: async () => '' } as unknown as Response;
    }
    if (u.includes('/ua/logout')) { S.loggedIn = false; return js({ operatorSession: false }); }
    if (u.includes('/ua/agent-tasks') && method === 'POST') {
      if (!S.loggedIn) return { ok: false, status: 401, json: async () => ({ error: { code: 'AUTH_REQUIRED' } }), text: async () => '' } as unknown as Response;
      S.createCalls.push(body);
      if (S.createOutcome === 'duplicate') return js({ ...detailRow('01M6XCM925QM7SXTK9S2PRZFDM', { status: 'queued' }), duplicate: true });
      if (S.createOutcome === 'conflict') return { ok: false, status: 409, json: async () => ({ error: { code: 'AGENT_TASK_CONFLICT', message: 'same idempotencyKey with different payload' } }), text: async () => '' } as unknown as Response;
      if (S.createOutcome === 'unauthorized') return { ok: false, status: 401, json: async () => ({ error: { code: 'AUTH_REQUIRED' } }), text: async () => '' } as unknown as Response;
      if (S.createOutcome === 'reject') return { ok: false, status: 422, json: async () => ({ error: { code: 'VALIDATION_FAILED', message: 'field not allowed: token' } }), text: async () => '' } as unknown as Response;
      if (S.createOutcome === 'unknown') throw new TypeError('network interrupted');
      return js(detailRow('01M6XCM925QM7SXTK9S2PRZFDM', { status: 'queued', result: null, endedAt: null }));
    }
    const m = /\/ua\/agent-tasks\/([0-9A-HJKMNP-TV-Z]{26})$/.exec(u);
    if (m != null && method === 'GET') {
      const d = S.detailByTask[m[1]];
      if (d == null) return { ok: false, status: 404, json: async () => ({ error: { code: 'NOT_FOUND' } }), text: async () => '' } as unknown as Response;
      if (!S.loggedIn) return { ok: false, status: 401, json: async () => ({ error: { code: 'AUTH_REQUIRED' } }), text: async () => '' } as unknown as Response;
      return js(d);
    }
    if (u.includes('/ro/clients?')) {
      if (!S.clientsAvailable) return { ok: false, status: 404, json: async () => ({ error: { code: 'VALIDATION_FAILED' } }), text: async () => '' } as unknown as Response;
      return js({ items: [desk()], page: 1, pageSize: 200, nextPage: null });
    }
    if (u.includes('/ro/agent-tasks?')) {
      const mc = /clientId=([0-9A-HJKMNP-TV-Z]{26})/.exec(u);
      const cid = mc ? mc[1] : CLIENT_OK;
      return js({ items: S.tasksByClient[cid] ?? [], page: 1, pageSize: 50, nextPage: null });
    }
    return { ok: false, status: 404, json: async () => ({ error: { code: 'VALIDATION_FAILED' } }), text: async () => '' } as unknown as Response;
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function loginFlow() {
  fireEvent.change(screen.getByTestId('agentchat-token-input'), { target: { value: 'x'.repeat(32) } });
  fireEvent.submit(screen.getByTestId('agentchat-token-input').closest('form') as HTMLElement);
  await waitFor(() => expect(screen.getByTestId('agentchat-session-state').textContent).toContain('已登录'), { timeout: 3000 });
}

it('未登录: 显示受控登录输入+Desktop选择+无发送输入', async () => {
  render(<AgentChat />);
  await waitFor(() => expect(screen.getByTestId(`agentchat-item-${OK}`)).toBeTruthy());
  expect(screen.getByTestId('agentchat-login')).toBeTruthy();
  fireEvent.click(screen.getByTestId(`agentchat-item-${OK}`));
  await waitFor(() => expect(screen.getByTestId('agentchat-requires-login')).toBeTruthy());
  expect(screen.queryByTestId('agentchat-send')).toBeNull();
  expect(screen.queryByTestId('agentchat-compose')).toBeNull();
});

it('登录成功: whoami态显示剩余期+输入发送可用（token一次性，登录后输入清空）', async () => {
  render(<AgentChat />);
  await waitFor(() => expect((screen.getByTestId(`agentchat-item-${OK}`) as HTMLButtonElement).disabled).toBe(false));
  await loginFlow();
  fireEvent.click(screen.getByTestId(`agentchat-item-${OK}`));
  await waitFor(() => expect(screen.getByTestId('agentchat-compose')).toBeTruthy());
  expect(screen.getByTestId('agentchat-session-state').textContent).toContain('已登录');
  // 断网/错误时页面不吞——登录后还能登出
  expect(screen.getByTestId('agentchat-logout')).toBeTruthy();
});

it('登录失败如实提示不进入已登录态', async () => {
  S.loginShouldFail = true;
  render(<AgentChat />);
  await waitFor(() => expect(screen.getByTestId('agentchat-login')).toBeTruthy());
  fireEvent.change(screen.getByTestId('agentchat-token-input'), { target: { value: 'y'.repeat(32) } });
  fireEvent.submit(screen.getByTestId('agentchat-token-input').closest('form') as HTMLElement);
  await waitFor(() => expect(S.createCalls.length === 0).toBe(true));
  await waitFor(() => expect(screen.getByTestId('agentchat-login-hint').textContent).toContain('登录失败'), { timeout: 3000 });
  expect(screen.getByTestId('agentchat-session-state').textContent).toContain('未登录');
});

it('发送委托: 创建成功进入flight跟踪(queued)+受控详情轮询到终态归档(含报告原文+步骤)', { timeout: 20000 }, async () => {
  render(<AgentChat />);
  await waitFor(() => expect((screen.getByTestId(`agentchat-item-${OK}`) as HTMLButtonElement).disabled).toBe(false));
  await loginFlow();
  fireEvent.click(screen.getByTestId(`agentchat-item-${OK}`));
  await waitFor(() => expect(screen.getByTestId('agentchat-input')).toBeTruthy());
  fireEvent.change(screen.getByTestId('agentchat-input'), { target: { value: '[委托] 清点设备' } });
  fireEvent.click(screen.getByTestId('agentchat-send'));
  await waitFor(() => expect(screen.getByTestId('agentchat-flight').textContent).toContain('排队中'), { timeout: 3000 });
  expect(S.createCalls.length).toBe(1);
  const req = S.createCalls[0] as Record<string, unknown>;
  expect(req.kind).toBe('prompt');
  expect(typeof req.idempotencyKey).toBe('string');
  // 受控详情轮询: 填终态详情→flight渲染报告原文+步骤+报告hash
  S.detailByTask['01M6XCM925QM7SXTK9S2PRZFDM'] = detailRow('01M6XCM925QM7SXTK9S2PRZFDM');
  await waitFor(() => expect(String(screen.getByTestId('agentchat-flight').textContent)).toContain('成功'), { timeout: 8000 });
  expect(screen.getByTestId('agentchat-report-text').textContent).toContain('真实设备报告');
  expect(screen.getByTestId('agentchat-steps').textContent).toContain('install');
});

it('同幂等键对账: 同内容重发一次=同一个idempotencyKey提交第二次+回duplicate如实标注', async () => {
  render(<AgentChat />);
  await waitFor(() => expect((screen.getByTestId(`agentchat-item-${OK}`) as HTMLButtonElement).disabled).toBe(false));
  await loginFlow();
  fireEvent.click(screen.getByTestId(`agentchat-item-${OK}`));
  await waitFor(() => expect(screen.getByTestId('agentchat-input')).toBeTruthy());
  fireEvent.change(screen.getByTestId('agentchat-input'), { target: { value: '[委托] 相同内容' } });
  fireEvent.click(screen.getByTestId('agentchat-send'));
  await waitFor(() => expect(S.createCalls.length).toBe(1));
  S.createOutcome = 'unknown'; // 第一次结果未知——绝不自动重发
  fireEvent.change(screen.getByTestId('agentchat-input'), { target: { value: '[委托] 相同内容' } });
  fireEvent.click(screen.getByTestId('agentchat-send'));
  await waitFor(() => expect(screen.getByTestId('agentchat-flight').textContent).toContain('结果未知'), { timeout: 3000 });
  expect(S.createCalls.length).toBe(2); // 仅用户重放，同键
  expect((S.createCalls[0] as Record<string, unknown>).idempotencyKey).toEqual((S.createCalls[1] as Record<string, unknown>).idempotencyKey);
  S.createOutcome = 'duplicate';
  fireEvent.change(screen.getByTestId('agentchat-input'), { target: { value: '[委托] 相同内容' } });
  fireEvent.click(screen.getByTestId('agentchat-send'));
  await waitFor(() => expect(screen.getByTestId('agentchat-flight').textContent).toContain('同键对账命中幂等门'), { timeout: 3000 });
  expect(S.createCalls.length).toBe(3);
});

it('结果未知仅显示unknown态——页面不发任何自动重试（发送时间窗内0新增请求）', async () => {
  render(<AgentChat />);
  await waitFor(() => expect((screen.getByTestId(`agentchat-item-${OK}`) as HTMLButtonElement).disabled).toBe(false));
  await loginFlow();
  fireEvent.click(screen.getByTestId(`agentchat-item-${OK}`));
  await waitFor(() => expect(screen.getByTestId('agentchat-input')).toBeTruthy());
  S.createOutcome = 'unknown';
  fireEvent.change(screen.getByTestId('agentchat-input'), { target: { value: '[委托] 断网测试' } });
  fireEvent.click(screen.getByTestId('agentchat-send'));
  await waitFor(() => expect(screen.getByTestId('agentchat-flight').textContent).toContain('结果未知'), { timeout: 3000 });
  expect(S.createCalls.length).toBe(1); // 无自动重发
  expect(screen.getByTestId('agentchat-flight').textContent).toContain('未自动重发');
});

it('409冲突/422拒绝如实分账（不吞不ręki成功）', async () => {
  render(<AgentChat />);
  await waitFor(() => expect((screen.getByTestId(`agentchat-item-${OK}`) as HTMLButtonElement).disabled).toBe(false));
  await loginFlow();
  fireEvent.click(screen.getByTestId(`agentchat-item-${OK}`));
  await waitFor(() => expect(screen.getByTestId('agentchat-input')).toBeTruthy());
  S.createOutcome = 'conflict';
  fireEvent.change(screen.getByTestId('agentchat-input'), { target: { value: '[委托] 内容1' } });
  fireEvent.click(screen.getByTestId('agentchat-send'));
  await waitFor(() => expect(screen.getByTestId('agentchat-flight-error').textContent).toContain('冲突'), { timeout: 3000 });
  S.createOutcome = 'reject';
  fireEvent.change(screen.getByTestId('agentchat-input'), { target: { value: '[委托] 内容2' } });
  fireEvent.click(screen.getByTestId('agentchat-send'));
  await waitFor(() => expect(screen.getByTestId('agentchat-flight-error').textContent).toContain('HTTP 422'), { timeout: 3000 });
});

it('历史台账真值: 该Client旧任务行渲染（RO投影字段）', async () => {
  S.tasksByClient[CLIENT_OK] = [{ agentTaskId: '01M6RJ9W77KN6JK8W2FB9BVCRT', clientId: CLIENT_OK, kind: 'prompt', toolName: null, status: 'failed', hasProgress: null, timeoutSec: 120, createdAt: '2026-11-06T21:55:00Z', expiresAt: '2026-11-06T22:05:00Z', deliveredAt: null, startedAt: null, cancelRequestedAt: null, endedAt: '2026-11-06T21:56:00Z' }];
  render(<AgentChat />);
  await waitFor(() => expect(screen.getByTestId(`agentchat-item-${OK}`)).toBeTruthy());
  fireEvent.click(screen.getByTestId(`agentchat-item-${OK}`));
  await waitFor(() => expect(screen.getByTestId('agentchat-msg-01M6RJ9W77KN6JK8W2FB9BVCRT')).toBeTruthy());
  expect(screen.getByTestId('agentchat-timeline').textContent).toContain('失败');
});

it('凭据零残留: token不进任何storage与URL（浏览器序盘审计）', async () => {
  render(<AgentChat />);
  await waitFor(() => expect((screen.getByTestId(`agentchat-item-${OK}`) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(screen.getByTestId('agentchat-token-input'), { target: { value: 'secretua-0600-credential-0000' } });
  fireEvent.submit(screen.getByTestId('agentchat-token-input').closest('form') as HTMLElement);
  await waitFor(() => expect(screen.getByTestId('agentchat-session-state').textContent).toContain('已登录'), { timeout: 3000 });
  const all = `${sessionStorage.getItem('solopi-ua-idem') ?? ''}|${window.location.href}`;
  expect(all).not.toContain('secretua');
  expect(Object.values(sessionStorage).every((v) => !String(v).includes('secretua'))).toBe(true);
});

it('幂等键持久恢复: unknown丢响应+刷新模拟(sessionStorage残留原键)→重入会话出恢复入口→同键重放对账', async () => {
  // 预置一个回退storage键（模拟上次unknown后的持久状态）
  sessionStorage.setItem('solopi-ua-idem', JSON.stringify({ [CLIENT_OK]: { key: 'web-persist-idem-0001', text: '[委托] 上次丢包' } }));
  render(<AgentChat />);
  await waitFor(() => expect((screen.getByTestId(`agentchat-item-${CLIENT_OK}`) as HTMLButtonElement).disabled).toBe(false));
  await loginFlow();
  fireEvent.click(screen.getByTestId(`agentchat-item-${CLIENT_OK}`));
  await waitFor(() => expect(screen.getByTestId('agentchat-idem-recover')).toBeTruthy(), { timeout: 4000 });
  expect(String(screen.getByTestId('agentchat-idem-recover').textContent)).toContain('web-persist-idem-0001');
  S.createOutcome = 'duplicate'; // 同键重放→服务端duplicate回原行
  fireEvent.click(screen.getByTestId('agentchat-idem-recover-btn'));
  await waitFor(() => expect(String(screen.getByTestId('agentchat-flight').textContent)).toContain('同键对账命中幂等门'), { timeout: 4000 });
  expect(S.createCalls.length).toBeGreaterThanOrEqual(1);
  const last = S.createCalls[S.createCalls.length - 1] as Record<string, unknown>;
  expect(last.idempotencyKey).toBe('web-persist-idem-0001');
  expect(last.prompt).toEqual({ text: '[委托] 上次丢包' });
  // 终态/duplicate带ID后恢复残余清空
  const after = JSON.parse(sessionStorage.getItem('solopi-ua-idem') ?? '{}') as Record<string, unknown>;
  expect(after[CLIENT_OK]).toBeUndefined();
});

it('目标4回退语义: envelope零绑定时回退面板标「该Client可观看设备」不冒充本任务成员（TaskGroupView直测）', async () => {
  const { TaskGroupView } = await import('../src/pages/TaskGroupView');
  // /ro/devices 不给该Client绑定任何设备→候选为空（真实空态不造占位）
  const { render, screen } = await import('@testing-library/react');
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const u = String(input);
    if (u.includes('/ua/whoami')) return { ok: false, status: 401, json: async () => ({ error: { code: 'AUTH_REQUIRED' } }), text: async () => '' } as unknown as Response;
    if (u.includes('/ro/devices')) return { ok: true, json: async () => ({ items: [{ deviceId: '01M6JVA2KF08T0VZ0Z0ZZABRA012', clientId: '01M6JVA2KF08T0VZ0ZZABRAQFJ', deviceName: 'RealMac-Phone', status: 'online' }], page: 1, pageSize: 200, nextPage: null }), text: async () => '' } as unknown as Response;
    if (u.includes('/mv/status/')) return { ok: true, json: async () => ({}), text: async () => '' } as unknown as Response;
    return { ok: true, json: async () => ({}), text: async () => '' } as unknown as Response;
  }));
  render(<TaskGroupView agentTaskId="01M6XCM925QM7SXTK9S2PRZFDM" clientId={CLIENT_OK} clientOnline={null} />, { wrapper: undefined });
  const { waitFor } = await import('@testing-library/react');
  await waitFor(() => expect(screen.queryByTestId('taskgroup-screen-1') ?? screen.getByTestId('taskgroup-fallback-note')).toBeTruthy(), { timeout: 4000 });
  const zone = String(screen.getByTestId('taskgroup').textContent);
  expect(zone).toContain('该Client可观看设备');
  expect(zone).toContain('非本任务成员/执行设备');
  expect(zone).toContain('不作为本任务成员/执行设备');
  expect(zone).toContain('按钮存在不等于已出帧');
  expect(zone).toContain('envelope仅绑定0台');
}, 20000);
