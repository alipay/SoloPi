import type { DeviceKind, DevicePresence, DeviceSummaryDraft } from '../api/devices-draft';
import { formatClock, formatRelative } from './format';

/** 设备类型标签（草案 kind 枚举） */
const KIND_LABEL: Record<DeviceKind, string> = {
  phone: '手机',
  glasses: '眼镜',
  tablet: '平板',
  other: '其他',
};

/**
 * 设备状态徽标（草案§1.1，服务端快照+租约权威推导，页面禁自行推导）：
 * online=在线 / stale=陈旧（Client在线但快照超期）/ offline=离线（Client离线或已从快照摘除）/ unknown=未知
 */
export function DeviceStatusBadge(props: { state: DevicePresence }): React.JSX.Element {
  const label =
    props.state === 'online' ? '在线' : props.state === 'stale' ? '陈旧' : '离线';
  const cls =
    props.state === 'online' ? 'badge-online' : props.state === 'stale' ? 'badge-stale' : 'badge-offline-dim';
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function KindBadge(props: { kind: DeviceKind }): React.JSX.Element {
  return <span className="tag">{KIND_LABEL[props.kind]}</span>;
}

/**
 * 电脑下的设备列表（W13，消费v0.2.0-draft deviceSummary形状）。
 * - `wired=false`（正式页面当前态：设备合同草案未冻结、服务端未部署设备端点）
 *   → 显示诚实「尚未接入」卡，不渲染fixtures、不显示设备行。
 * - `wired=true`（未来接线态）→ 按服务端权威字段渲染行；
 *   每行带「查看屏幕/停止查看」面板（ScreenViewPanel）。
 */
export function DeviceList(props: {
  clientId: string;
  wired: boolean;
  rows: DeviceSummaryDraft[];
  screenPanel?: React.ReactNode;
}): React.JSX.Element {
  if (!props.wired) {
    return (
      <div className="card card-notwired" data-testid={`devices-unwired-${props.clientId}`}>
        <p>
          「设备列表」尚未接入：设备与媒体合同 <code>v0.2.0</code> 已冻结，但本站点尚未部署只读设备端点（/ro/devices）。
          冻结并部署后，此处显示本 Client 上报的真实连接设备（手机/眼镜），状态由服务端快照与租约权威推导。
        </p>
      </div>
    );
  }
  if (props.rows.length === 0) {
    return (
      <p className="muted" data-testid={`devices-empty-${props.clientId}`}>
        该电脑当前未上报任何连接设备（服务端确认空集）。
      </p>
    );
  }
  return (
    <table className="mini-table" data-testid={`devices-list-${props.clientId}`}>
      <thead>
        <tr>
          <th>设备</th>
          <th>类型</th>
          <th>状态</th>
          <th>最近在库</th>
          <th>快照时间</th>
        </tr>
      </thead>
      <tbody>
        {props.rows.map((device) => (
          <tr key={device.deviceId}>
            <td>{device.deviceName ?? device.deviceId}</td>
            <td>
              <KindBadge kind={device.kind} />
            </td>
            <td>
              <DeviceStatusBadge state={device.status} />
            </td>
            <td title={formatClock(device.lastSeenAt)}>{formatRelative(device.lastSeenAt)}</td>
            <td title={formatClock(device.lastSnapshotAt)}>{formatRelative(device.lastSnapshotAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
