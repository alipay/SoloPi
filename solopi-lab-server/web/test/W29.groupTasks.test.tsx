/**
 * W29 回归（AMAW-21 组任务列表/详情）：对齐 2026-11-08 已上线 Server 面的前端消费语义。
 *
 * 断言不放宽：所有 DOM 数据均来自 fetch 替身的响应，不造数据。替身按 /ro/group-levels
 * （已上线）与 /ua/group-dispatch-detail（已上线受控详情）真实合同应答——字段与
 * server/src/group-levels-ro.mjs、app.mjs /v1/group-dispatch-detail 响应体逐字一致。
 * 生产真值状态由 404/401 断言如实覆盖（缺口/登录），页面零写请求（全部 GET）。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GroupTasks } from '../src/pages/GroupTasks';

const S = vi.hoisted(() => ({
  levelsBody: null as unknown,
  detailStatus: 200 as number,
  detailBody: null as unknown,
  calls: [] as string[],
}));

const REQ = 'b6e46e52-8f2e-4d1a-9a7c-2f3d4a5b6c7d'; // 组执行 request（UUIDv4）——非 agentTaskId
const REQ_NO_DISPATCH = '9be80c0f-a23b-4c18-8a11-43e7c71e98f9';
const CLIENT = '01M6JVA2KF08T0VZ0ZZABRAQFJ'; // Desktop ULID（26字符）
const CLIENT_OTHER = '01M6JVA2KF08T0VZ0ZZABRAQF2';
const GROUP = 'grp-a1b2c3d4';
const GROUP_OTHER = 'grp-zzz';

const member = (deviceId: string | null, name: string | null = null) => ({
  deviceId, deviceName: name, deviceStatus: null, role: null, deviceKind: null,
});

const levelPage = (over: Record<string, unknown> = {}) => ({
  items: [
    {
      clientId: CLIENT, clientStatus: 'approved', deviceScope: { hostname: 'Desk-A' },
      groups: [
        {
          groupId: GROUP, name: '组A', revision: 3, deleted: false, updatedAtMs: Date.parse('2026-11-08T20:00:00Z'),
          members: [
            { deviceId: '01M6JVA2KF08T0VZ0ZZABRAQF3', role: 'glasses', deviceKind: 'glasses', deviceName: '眼镜B', deviceStatus: 'online' },
            { deviceId: '01M6JVA2KF08T0VZ0ZZABRAQF4', role: 'phone', deviceKind: 'phone', deviceName: '手机C', deviceStatus: 'offline' },
            { deviceId: null, role: 'phone', deviceName: null, deviceStatus: null }, // 无deviceId成员不参与画面
          ],
          executions: [
            {
              groupExecutionId: 'ge-1', requestId: REQ, taskId: 'task-g1', phase: 'dispatching',
              updatedAtMs: Date.parse('2026-11-08T20:05:00Z'),
            },
            {
              groupExecutionId: 'ge-2', requestId: null, taskId: 'task-g2', phase: 'done',
              updatedAtMs: Date.parse('2026-11-08T20:06:00Z'),
            },
            {
              groupExecutionId: 'ge-3', requestId: REQ_NO_DISPATCH, taskId: 'task-g3', phase: 'done',
              updatedAtMs: Date.parse('2026-11-08T20:07:00Z'),
              receipt: { taskId: 'task-g3', terminal: true, resourcesReleased: true, outcome: 'succeeded', reportRef: 'local-report://w29/t3' },
            },
          ],
        },
        { groupId: GROUP_OTHER, name: '组Z', revision: 1, deleted: false, updatedAtMs: 1, members: [member(null)], executions: [] },
      ],
    },
    {
      clientId: CLIENT_OTHER, clientStatus: 'approved', deviceScope: { hostname: 'Desk-B' },
      groups: [{ groupId: 'grp-bbb', name: '组B', revision: 1, deleted: false, updatedAtMs: 1, members: [], executions: [] }],
    },
  ],
  page: 1, pageSize: 50, nextPage: null,
  ...over,
});

/** /v1/group-dispatch-detail 核心响应合同逐字（账本投影+镜像+reportRef） */
const detailBody = (over: Record<string, unknown> = {}) => ({
  requestId: REQ, dispatchId: 'dp-1', clientId: CLIENT, groupId: GROUP, expectedRevision: 3,
  dispatchPlanSha256: 'sha-plan', payloadSha256: 'sha-payload', payloadBytes: 128, memberSha256: 'sha-member',
  status: 'dispatching', cancelRequestedAt: null, taskUid: null, confirmedAt: '2026-11-08T20:01:00Z',
  terminalAt: null, terminalOutcome: null,
  execution: {
    groupExecutionId: 'ge-1', taskId: 'task-g1', phase: 'dispatching',
    receipt: { taskId: 'task-g1', terminal: false, resourcesReleased: false, outcome: null, reportRef: null },
    eventSeq: 7,
  },
  steps: null,
  reportRef: null,
  reportRefParsed: null,
  ...over,
});

const JSON_404 = { json: async () => ({ error: { code: 'VALIDATION_FAILED', message: 'no such route', retryable: false } }), text: async () => '' };
const JSON_401 = { json: async () => ({ error: { code: 'AUTH_REQUIRED', message: 'operator session required', retryable: false } }), text: async () => '' };

beforeEach(() => {
  S.levelsBody = levelPage();
  S.detailStatus = 200;
  S.detailBody = detailBody();
  S.calls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const u = String(input);
    S.calls.push(`${(init?.method ?? 'GET').toUpperCase()} ${u}`);
    if (init?.method != null && init.method.toUpperCase() !== 'GET') {
      throw new Error('组任务页不得产生写请求: ' + u);
    }
    if (u.includes('/ua/group-dispatch-detail/')) {
      if (S.detailStatus !== 200) return { ok: false, status: S.detailStatus, ...(S.detailStatus === 401 ? JSON_401 : JSON_404) } as unknown as Response;
      if (S.detailBody == null) return { ok: true, json: async () => ({}) } as unknown as Response; // 坏封套
      return { ok: true, json: async () => S.detailBody } as unknown as Response;
    }
    if (u.includes('/ro/group-levels')) {
      if (S.levelsBody == null) return { ok: false, status: 404, ...JSON_404 } as unknown as Response;
      return { ok: true, json: async () => S.levelsBody } as unknown as Response;
    }
    if (u.includes('/mv/status/')) return { ok: false, status: 401, ...JSON_401 } as unknown as Response; // 媒体面板登录探测（匿名真值）
    return { ok: false, status: 404, ...JSON_404 } as unknown as Response;
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('列表来自真实层级投影：组执行request行按组展平，无request行详情入口如实禁用', async () => {
  render(<GroupTasks />);
  await waitFor(() => expect(screen.getByTestId('grouptasks-table')).toBeTruthy());
  expect(screen.getByTestId('grouptasks-count').textContent).toContain('3 条');
  // 有 request 行：requestId 可见；无 request 行：如实标注且按钮禁用
  expect(screen.getByTestId('grouptasks-row-0').textContent).toContain(REQ);
  expect(screen.getByTestId('grouptasks-row-0').textContent).toContain('组A');
  expect(screen.getByTestId('grouptasks-row-1').textContent).toContain('无派发 request');
  expect((screen.getByTestId('grouptasks-open-1') as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByTestId('grouptasks-open-0') as HTMLButtonElement).disabled).toBe(false);
  // 回执终态合取展示（登记与接收分账），多列不冒充
  expect(screen.getByTestId('grouptasks-row-2').textContent).toContain('终态：succeeded');
  expect(screen.getByTestId('grouptasks-row-0').textContent).toContain('派发中');
  expect(S.calls.every((c) => !c.startsWith('POST'))).toBe(true); // 零写请求
  expect(S.calls.some((c) => c.includes('/ua/agent-tasks'))).toBe(false); // 不碰 agent-task 面
});

it('读面缺失（/ro/group-levels 404）→如实缺口态，无任何模拟列表', async () => {
  S.levelsBody = null;
  render(<GroupTasks />);
  await waitFor(() => expect(screen.getByTestId('grouptasks-readface-absent')).toBeTruthy());
  expect(screen.queryByTestId('grouptasks-table')).toBeNull();
});

it('部署侧401报连接故障，不让用户登录，不保留详情原文', async () => {
  S.detailStatus = 401;
  render(<GroupTasks />);
  await waitFor(() => expect(screen.getByTestId('grouptasks-table')).toBeTruthy());
  fireEvent.click(screen.getByTestId('grouptasks-open-2')); // 有回执的 done 行（受控详情仍需会话）
  await waitFor(() => expect(screen.getByTestId('grouptasks-detail-login')).toBeTruthy());
  expect(screen.getByTestId('grouptasks-detail-login').textContent).toContain('本站无需登录');
  expect(screen.queryByTestId('grouptask-detail')).toBeNull(); // 不泄露任何详情字段
  expect(S.calls.some((c) => c.includes('/ua/group-dispatch-detail/' + REQ_NO_DISPATCH))).toBe(true);
});

it('详情真值：账本/镜像/reportRef按核心合同渲染；步骤缺失如实不假填', async () => {
  render(<GroupTasks />);
  await waitFor(() => expect(screen.getByTestId('grouptasks-table')).toBeTruthy());
  fireEvent.click(screen.getByTestId('grouptasks-open-0'));
  await waitFor(() => expect(screen.getByTestId('grouptask-detail')).toBeTruthy());
  expect(screen.getByTestId('grouptask-steps-col').textContent).toContain('派发中');
  expect(screen.getByTestId('grouptask-steps-col').textContent).toContain('组A');
  expect(screen.getByTestId('grouptask-steps-absent').textContent).toContain('不假填');
  expect(screen.getByTestId('grouptask-receipt').textContent).toContain('terminal=false');
  // 步骤真值行（Client 投影到位时）
  expect(screen.getByTestId('grouptask-screen-1-origin').textContent).toContain('成员设备');
  expect(screen.getByTestId('grouptask-screen-2-origin').textContent).toContain('成员设备');
  expect(screen.queryByTestId('grouptask-screen-3')).toBeNull(); // 上下两路=首两台；无deviceId成员不造第3路
});

it('reportRef为参考标识：fetchable恒false，不构链接+正式读取缺口注记', async () => {
  S.detailBody = detailBody({
    execution: { groupExecutionId: 'ge-3', taskId: 'task-g3', phase: 'done', eventSeq: 9,
      receipt: { taskId: 'task-g3', terminal: true, resourcesReleased: true, outcome: 'succeeded', reportRef: 'local-report://w29/t3' } },
    reportRef: 'local-report://w29/t3',
    reportRefParsed: { scheme: 'local-report', path: 'w29/t3', fetchable: false },
  });
  render(<GroupTasks />);
  await waitFor(() => expect(screen.getByTestId('grouptasks-table')).toBeTruthy());
  fireEvent.click(screen.getByTestId('grouptasks-open-0'));
  await waitFor(() => expect(screen.getByTestId('grouptask-reportref')).toBeTruthy());
  expect(screen.getByTestId('grouptask-reportref').textContent).toContain('local-report://w29/t3');
  expect(screen.getByTestId('grouptask-reportref').textContent).toContain('解析 local-report');
  expect(screen.getByTestId('grouptask-reportref-gap').textContent).toContain('不构成可访问报告');
});

it('步骤真实投影到位→真值行渲染（缺失字段如实未知）', async () => {
  S.detailBody = detailBody({
    status: 'done', terminalAt: '2026-11-08T20:10:00Z', terminalOutcome: 'succeeded',
    steps: [{ index: 1, action: '打开页面', deviceId: '01M6JVA2KF08T0VZ0ZZABRAQF3', status: 'succeeded' }],
  });
  render(<GroupTasks />);
  await waitFor(() => expect(screen.getByTestId('grouptasks-table')).toBeTruthy());
  fireEvent.click(screen.getByTestId('grouptasks-open-0'));
  await waitFor(() => expect(screen.getByTestId('grouptask-step-1')).toBeTruthy());
  expect(screen.getByTestId('grouptask-step-1').textContent).toContain('打开页面');
  expect(screen.queryByTestId('grouptask-steps-absent')).toBeNull();
  expect(screen.getByTestId('grouptask-steps-col').textContent).toContain('已结束');
});

it('成员优先detail.members（Client投影，真实设备标识非ULID如23117RK66C不拒）', async () => {
  S.detailBody = detailBody({ members: [{ deviceId: '23117RK66C', deviceName: '真实眼镜RG_glasses2' }] });
  render(<GroupTasks />);
  await waitFor(() => expect(screen.getByTestId('grouptasks-table')).toBeTruthy());
  fireEvent.click(screen.getByTestId('grouptasks-open-0'));
  await waitFor(() => expect(screen.getByTestId('grouptask-screen-1')).toBeTruthy());
  expect(screen.getByTestId('grouptask-screen-1-origin').textContent).toContain('23117RK66C'); // 真实设备标识原样呈现（非ULID标识不拒不造）
  expect(screen.getByTestId('grouptask-screen-1-origin').textContent).toContain('执行投影成员');
  expect(screen.queryByTestId('grouptask-screen-2')).toBeNull(); // 有投影成员即不再回退层级列表
});

it('详情身份失配（响应clientId≠行属主/clientId）→拒绝渲染', async () => {
  S.detailBody = detailBody({ clientId: CLIENT_OTHER });
  render(<GroupTasks />);
  await waitFor(() => expect(screen.getByTestId('grouptasks-table')).toBeTruthy());
  fireEvent.click(screen.getByTestId('grouptasks-open-0'));
  await waitFor(() => expect(screen.getByTestId('grouptasks-detail-error')).toBeTruthy());
  expect(screen.getByTestId('grouptasks-detail-error').textContent).toMatch(/身份失配|读取失败/);
  expect(screen.queryByTestId('grouptask-detail')).toBeNull();
});

it('会话中途失效401→详情原文不残留并转登录指引', { timeout: 15000 }, async () => {
  render(<GroupTasks />);
  await waitFor(() => expect(screen.getByTestId('grouptasks-table')).toBeTruthy());
  fireEvent.click(screen.getByTestId('grouptasks-open-0'));
  await waitFor(() => expect(screen.getByTestId('grouptask-detail')).toBeTruthy());
  const original = global.fetch;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const u = String(input);
    if (u.includes('/ua/group-dispatch-detail/')) return { ok: false, status: 401, ...JSON_401 } as unknown as Response;
    return (original(input) as unknown as Promise<Response>);
  }));
  await waitFor(() => expect(screen.getByTestId('grouptasks-detail-login')).toBeTruthy(), { timeout: 9000 }); // 非终态5s轮询触发401
  expect(screen.queryByTestId('grouptask-detail')).toBeNull(); // 受控详情原文已清（不残留）
});

it('坏封套拒绝：详情缺required字段→按失败拒绝（不冒充可用详情）', async () => {
  S.detailBody = null;
  render(<GroupTasks />);
  await waitFor(() => expect(screen.getByTestId('grouptasks-table')).toBeTruthy());
  fireEvent.click(screen.getByTestId('grouptasks-open-0'));
  await waitFor(() => expect(screen.getByTestId('grouptasks-detail-error')).toBeTruthy());
  expect(screen.getByTestId('grouptasks-detail-error').textContent).toMatch(/不符合合同形态|读取失败/);
});

it('列表坏封套：/ro/group-levels返回缺nextPage→读取失败不冒充空集，旧行保留标陈旧', async () => {
  render(<GroupTasks />);
  await waitFor(() => expect(screen.getByTestId('grouptasks-table')).toBeTruthy());
  const original = global.fetch;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const u = String(input);
    if (u.includes('/ro/group-levels')) return { ok: true, json: async () => ({ items: [], page: 1, pageSize: 50 }) } as unknown as Response; // 坏封套（缺nextPage）
    return (original(input) as unknown as Promise<Response>);
  }));
  fireEvent.click(screen.getByTestId('grouptasks-refresh'));
  await waitFor(() => expect(screen.getByTestId('grouptasks-read-error')).toBeTruthy());
  expect(screen.getByTestId('grouptasks-row-0')).toBeTruthy(); // 旧行保留
});
