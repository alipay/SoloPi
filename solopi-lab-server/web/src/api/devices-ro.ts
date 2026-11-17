/**
 * 同源固定scope只读设备代理（W13b，消费**冻结版** contracts/v0.2.0 deviceSummary/devicesPage）。
 *
 * 服务端本轮正在部署 `/ro/devices`（RO匿名、solopi-lab/glasses硬编码、
 * projections-only——绝不携带媒体授权）。页面probe成功才接线；probe失败
 * （端点未部署→SPA回退HTML解析失败/404）→ 设备列表保持诚实「尚未接入」。
 */
import { fetchJson } from './http';
import { AdapterError, fetchAllPages } from './adapters-v015';
import type { DevicesPageDraft, DeviceSummaryDraft } from './devices-draft';

const PAGE_SIZE_MAX = 200;
let probedDevices:{at:number;envelope:DevicesPageDraft}|null=null;

/** RO设备探测：合法分页envelope才启用（HTML回退/404→false） */
export async function probeRoDevices(): Promise<boolean> {
  probedDevices=null;
  try {
    const envelope = await fetchJson<DevicesPageDraft>('/ro/devices?page=1&pageSize=200', new AbortController().signal);
    const valid=envelope != null && Array.isArray(envelope.items) && typeof envelope.page === 'number';
    if(valid)probedDevices={at:Date.now(),envelope};return valid;
  } catch {
    return false;
  }
}

/** 全量拉取RO设备列表（分页白名单 status/page/pageSize；scope服务端固定不传） */
export function createRoDevicesRead(): (base: string, signal: AbortSignal) => Promise<DeviceSummaryDraft[]> {
  return (_base: string, signal: AbortSignal) =>
    fetchAllPages<DeviceSummaryDraft>((page, sig) => {
      if(page===1&&probedDevices&&Date.now()-probedDevices.at<2000){sig.throwIfAborted();const saved=probedDevices;probedDevices=null;return Promise.resolve(saved.envelope);}
      const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE_MAX) });
      return fetchJson<DevicesPageDraft>(`/ro/devices?${query.toString()}`, sig).then((envelope) => {
        if (envelope == null || !Array.isArray(envelope.items) || typeof envelope.page !== 'number') {
          throw new AdapterError('CONTRACT_MISMATCH', '只读设备代理响应不是合法分页envelope：/ro/devices');
        }
        return envelope;
      });
    }, signal);
}

/** 按Client分组（网页分组展示用，不做跨scope/跨Client混读） */
export function groupDevicesByClient(rows: DeviceSummaryDraft[]): Map<string, DeviceSummaryDraft[]> {
  const map = new Map<string, DeviceSummaryDraft[]>();
  for (const row of rows) {
    const list = map.get(row.clientId) ?? [];
    list.push(row);
    map.set(row.clientId, list);
  }
  return map;
}
