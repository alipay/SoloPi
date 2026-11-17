/**
 * 目标3（网站选择 Client Agent 对话）**最小 web 候选**的 Desktop/Agent 选择读面。
 * 浏览器零凭据：同 /ro/clients 固定 scope 只读代理；运行时校验同站内既有纪律
 * （agent-tasks-ro / group-levels-ro）：坏封套/坏行按读取失败上抛，调用方保旧行标陈旧、
 * 绝不以坏响应冒充确认空集；probe 仅 404 判读面未部署。
 * 会话语义如实：Server 现无对话/会话实体（上游 DeepSeek dsh-superagent 8c32a9dc 已核无远程
 * Client-agent 桥，本面为最小自建 agent-task 合同）——本页"会话"=按 clientId 关联的真实任务台账，
 * 查询发送面当前无 Web 受支持 API（核心 POST /v1/agent-tasks 为 admin 面，未代理到网站），
 * 明确禁用并向 Server 交精确合同缺口，不伪造会话/回执/可发送。
 */
import { fetchJson, ApiError } from './http';

export type DesktopPresence = 'online' | 'offline' | 'unknown';

export interface AgentChatDesktop {
  clientId: string;
  clientStatus: string;
  online: DesktopPresence;
  /** 登记能力真值（agent=false 即如实不可发起——选择器不给假入口） */
  agentCapable: boolean;
  hostname: string | null;
  clientVersion: string;
  lastHeartbeatAt: string | null;
  /** 任务面占用真值（0/0 是占位凭据吗否——是服务端投影真值，页面如实显示） */
  occupancy: { localUiTasks: number | null; cliTasks: number | null };
}

function badShape(what: string): never {
  throw new ApiError(-1, `Agent桌面读面响应不符合合同形态（${what}）——按读取失败处理，不冒充空集`, null);
}

const PRESENCE_SET = new Set<DesktopPresence>(['online', 'offline', 'unknown']);

function validateDesktop(raw: unknown): AgentChatDesktop {
  if (typeof raw !== 'object' || raw == null) badShape('item 非对象');
  const c = raw as Record<string, unknown>;
  if (typeof c.clientId !== 'string' || c.clientId.length === 0) badShape('clientId');
  if (typeof c.status !== 'string') badShape('status');
  if (typeof c.online !== 'string' || !PRESENCE_SET.has(c.online as DesktopPresence)) badShape('online 非法枚举');
  if (typeof c.capabilities !== 'object' || c.capabilities == null) badShape('capabilities');
  const caps = c.capabilities as Record<string, unknown>;
  // 真实库中存在历史注册未声明agent能力的Client（capabilities缺agent键）——RO面如实透出，
  // 缺键视为未声明能力（registration真值），不视为坏封套；仅显式非布尔（如字符串）仍拒。
  if (typeof caps.agent !== 'boolean' && typeof caps.agent !== 'undefined') badShape('capabilities.agent 非布尔');
  if (c.deviceScope != null && typeof c.deviceScope !== 'object') badShape('deviceScope');
  const scope = c.deviceScope == null ? null : c.deviceScope as Record<string, unknown>;
  if (scope != null && scope.hostname != null && typeof scope.hostname !== 'string') badShape('deviceScope.hostname');
  if (typeof c.clientVersion !== 'string') badShape('clientVersion');
  const occupancy = (c.occupancy ?? null) as Record<string, unknown> | null;
  if (occupancy != null && (occupancy.localUiTasks == null || occupancy.cliTasks == null)) badShape('occupancy');
  return {
    clientId: c.clientId,
    clientStatus: c.status,
    online: c.online as DesktopPresence,
    agentCapable: caps.agent === true, // 缺键=未声明能力（false）；不做推断
    hostname: scope == null ? null : (scope.hostname as string | null) ?? null,
    clientVersion: c.clientVersion,
    lastHeartbeatAt: c.lastHeartbeatAt == null ? null : String(c.lastHeartbeatAt),
    occupancy: occupancy == null ? { localUiTasks: null, cliTasks: null } : { localUiTasks: occupancy.localUiTasks as number, cliTasks: occupancy.cliTasks as number },
  };
}

export function fetchAgentChatDesktops(signal: AbortSignal): Promise<AgentChatDesktop[]> {
  return fetchJson<unknown>('/ro/clients?page=1&pageSize=200', signal).then((raw: unknown) => {
    if (typeof raw !== 'object' || raw == null) badShape('响应非对象');
    const p = raw as Record<string, unknown>;
    if (!Array.isArray(p.items)) badShape('items 非数组');
    if (typeof p.page !== 'number' || !Number.isInteger(p.page) || p.page < 1) badShape('page 非法');
    if (!('nextPage' in p)) badShape('缺 nextPage');
    // 本页目标选择器只取第1页上界200（Web scope 内真实Desktop可见量按现役实测≤103），多页如实提示
    return (p.items as unknown[]).map(validateDesktop);
  });
}

/** 读面存在性：只把 404（no route）判未部署；其余失败由 load() 如实报读取错误 */
export async function probeAgentChatReadface(signal: AbortSignal): Promise<boolean> {
  try {
    await fetchJson<unknown>('/ro/clients?page=1&pageSize=1', signal); // 只探到达性：404=no route
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return false; // 500/坏形状→面在，失败由 load() 如实报读取错误
    return true;
  }
}
