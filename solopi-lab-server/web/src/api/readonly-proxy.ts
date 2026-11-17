/**
 * 同源固定scope只读代理（W11，服务端部署 d31f570）：
 * `GET /ro/clients`、`GET /ro/enrollments`——服务端进程内代理鉴权与固定
 * scope（solopi-lab/glasses 硬编码，浏览器传 orgId/projectId 即422），
 * 无需token；浏览器端只发送 status/page/pageSize 白名单查询参数。
 *
 * 安全边界：
 * - 同源相对路径请求，无 Authorization 头、无 token、浏览器配置不可改变 scope；
 * - 服务端白名单外的参数一律不带（由服务端422兜底校验）；
 * - 分页envelope与 contracts v0.1.6 clientsPage/enrollmentsPage 同型。
 */
import { fetchJson } from './http';
import { AdapterError, fetchAllPages, mapClientSummary, mapEnrollmentRow } from './adapters-v015';
import type { PageEnvelope, EnrollmentRow15, ClientSummary15, EnrollmentStatus } from './contract-v015';
import type { ClientRecord, EnrollmentRequest } from './types';

/** 服务端固定scope的展示标签（非秘密，硬编码于服务端代理合同） */
export const RO_SCOPE_LABELS = { orgKey: 'solopi-lab', projectKey: 'glasses' };

const PAGE_SIZE_MAX = 200;
let probedClients:{at:number;envelope:PageEnvelope<ClientSummary15>}|null=null;

async function fetchRoPage<T>(
  path: '/ro/clients' | '/ro/enrollments',
  params: Record<string, string>,
  page: number,
  signal: AbortSignal,
): Promise<PageEnvelope<T>> {
  if(path==='/ro/clients'&&page===1&&Object.keys(params).length===0&&probedClients&&Date.now()-probedClients.at<2000){signal.throwIfAborted();const saved=probedClients;probedClients=null;return saved.envelope as PageEnvelope<T>;}
  const query = new URLSearchParams({ ...params, page: String(page), pageSize: String(PAGE_SIZE_MAX) });
  const envelope = await fetchJson<PageEnvelope<T>>(`${path}?${query.toString()}`, signal);
  if (envelope == null || !Array.isArray(envelope.items) || typeof envelope.page !== 'number') {
    throw new AdapterError('CONTRACT_MISMATCH', `只读代理响应不是合法分页envelope：${path}`);
  }
  return envelope;
}

/** Client 状态列表（通过服务端 /ro 代理，无token，固定scope） */
export function createRoClientsRead(): (base: string, signal: AbortSignal) => Promise<ClientRecord[]> {
  return (_base: string, signal: AbortSignal) =>
    fetchAllPages<ClientSummary15>(
      (page, sig) => fetchRoPage<ClientSummary15>('/ro/clients', {}, page, sig),
      signal,
    ).then((rows) => rows.map((row) => mapClientSummary(row, RO_SCOPE_LABELS)));
}

/** 待审批/按状态的注册申请列表（通过服务端 /ro 代理） */
export function createRoEnrollmentsRead(
  options: { status?: EnrollmentStatus } = {},
): (base: string, signal: AbortSignal) => Promise<EnrollmentRequest[]> {
  const params: Record<string, string> = { status: options.status ?? 'pending' };
  return (_base: string, signal: AbortSignal) =>
    fetchAllPages<EnrollmentRow15>(
      (page, sig) => fetchRoPage<EnrollmentRow15>('/ro/enrollments', params, page, sig),
      signal,
    ).then((rows) => rows.map((row) => mapEnrollmentRow(row, RO_SCOPE_LABELS)));
}

/**
 * 同源只读代理探测：最小分页GET（HEAD亦可用但GET取真实envelope可校验items形态）。
 * 探测不携带任何身份；404/401/错误envelope → false（保持原未接线/手工路径）。
 */
export async function probeReadonlyProxy(): Promise<boolean> {
  probedClients=null;
  try {
    const envelope = await fetchJson<PageEnvelope<ClientSummary15>>('/ro/clients?page=1&pageSize=200', new AbortController().signal);
    const valid=envelope != null && Array.isArray(envelope.items) && typeof envelope.page === 'number';
    if(valid)probedClients={at:Date.now(),envelope};return valid;
  } catch {
    return false;
  }
}
