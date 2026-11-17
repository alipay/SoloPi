import { useState, type ReactNode } from 'react';
import type { DataArea } from '../api/areas';
import type { ClientRecord } from '../api/types';
import { isRevokedClient } from '../api/types';
import type { DeviceSummaryDraft } from '../api/devices-draft';
import { groupDevicesByClient } from '../api/devices-ro';
import type { RuntimeConnection } from '../api/connection';
import type { DevicesReadState } from '../hooks/useDevicesReadView';
import { createClientsRead } from '../api/fetchers-v015';
import { createRoClientsRead } from '../api/readonly-proxy';
import { useDeliveryArea } from '../hooks/useDeliveryArea';
import { AreaView } from '../components/AreaView';
import { MediaViewerPanel } from '../components/MediaViewerPanel';
import { CapabilityTags, OnlineBadge, StateBadge } from '../components/StateBadge';
import { formatClock, formatRelative } from '../components/format';
import { useDevicesReadView } from '../hooks/useDevicesReadView';

/** 设备kind→用户词汇（W24R3：tablet 平板一并本地化；null/undefined/未知枚举如实「未知」，不猜类型） */
const kindText = (kind: unknown): string => {
  if (kind === 'phone') return '手机';
  if (kind === 'glasses') return '眼镜';
  if (kind === 'tablet') return '平板';
  if (kind === 'other') return '其他';
  if (kind == null || kind === '') return '未知';
  return '未知';
};

/** 单个 Client 卡（真实数据only；成功显示N/0台；失败保留最近成功设备行+时间并标注陈旧失败） */
export function ClientCard(props: {
  item: ClientRecord;
  devices: DevicesFromReadState;
}): React.JSX.Element {
  const { item, devices } = props;
  const isConfirmed = devices.kind === 'confirmed';
  const isStale = devices.kind === 'stale-read';
  const confirmedRows = devices.kind === 'confirmed' || devices.kind === 'stale-read' ? devices.rows : [];
  const meta = devices.kind === 'confirmed' && devices.lastUpdatedAt != null ? `最近读取 ${formatClock(devices.lastUpdatedAt)}` : null;
  const staleMeta = devices.kind === 'stale-read'
    ? `读取失败：${devices.error ?? '原因未知'}${devices.lastUpdatedAt != null ? `（最近成功读取 ${formatClock(devices.lastUpdatedAt)}，以下为陈旧数据）` : '（无最近成功读取）'}`
    : null;
  // W19：穷尽 unknown.reason——probe未通→端点未接入；probe已通→读取中/读取失败，数量均为未知
  const unconfirmedLabel =
    devices.kind === 'unconfirmed'
      ? devices.reason === 'endpoint-not-deployed'
        ? '设备列表尚未接入：设备只读端点未部署——设备数量未知'
        : devices.reason === 'pending'
          ? '设备读取中——数量未知'
          : '设备读取失败——数量未知'
      : null;
  return (
    <div className="client-card" data-testid={`client-card-${item.clientId}`}>
      <div className="client-head">
        <span className="client-name" title={item.clientId}>{item.displayName}</span>
        <span className="client-prop" style={{ fontSize: 10, color: 'var(--muted)' }}>心跳 <b title={formatClock(item.lastHeartbeatAt)}>{formatRelative(item.lastHeartbeatAt)}</b></span>
        <OnlineBadge presence={item.online ?? 'unknown'} />
      </div>
      <div className="client-id">{item.clientId}</div>
      {/* W24R2/P2（UX审查03：信息负担）：技术属性行/能力标签/时间明细从日常界面收进折叠诊断，
          title 悬停保留完整值——安全限制不删除 */}
      <details className="diagnostics client-meta" data-testid={`client-meta-${item.clientId}`} style={{ padding: '2px 16px 6px', borderTop: 0 }}>
        <summary style={{ fontSize: 10 }}>电脑详情（注册/版本/租约/能力）</summary>
        <div style={{ fontSize: 10, marginTop: 2 }}>
          <StateBadge status={item.registration.status} />
          <span className="client-prop">版本 <b>{item.clientVersion}</b></span>
          <span className="client-prop">租约到期 <b>{item.leaseExpiresAt ? formatClock(item.leaseExpiresAt) : '—'}</b></span>
        </div>
        <div style={{ fontSize: 10, marginTop: 2 }}><CapabilityTags capabilities={item.capabilities} /></div>
      </details>
      <details className="device-details">
        <summary>设备与投屏{isConfirmed ? `（${confirmedRows.length} 台）` : isStale ? `（${confirmedRows.length} 台·数据陈旧）` : devices.kind === 'unconfirmed' && devices.reason === 'endpoint-not-deployed' ? '（待端点部署）' : '（数量未知）'}</summary>
        {staleMeta != null && <p className="muted" style={{ fontSize: 10, margin: '2px 16px' }} data-testid={`devices-stale-note-${item.clientId}`}>{staleMeta}</p>}
        {meta != null && <p className="muted" style={{ fontSize: 10, margin: '2px 16px', display: 'none' }} data-testid={`devices-fresh-note-${item.clientId}`} title={meta}>{meta}</p>}
        {unconfirmedLabel != null && (
          <div data-testid={devices.kind === 'unconfirmed' && devices.reason === 'endpoint-not-deployed' ? `devices-unwired-${item.clientId}` : undefined}>
            <p className="muted" data-testid={`devices-unknown-note-${item.clientId}`}>{unconfirmedLabel}</p>
          </div>
        )}
        {/* W24R2（UX审查04：设备表与投屏分离、同名面板竖排不可读）：组内每设备一格横排双列，
            名称/真实类型或未知/在线状态/独立查看关闭与本格画面绑定((clientId,deviceId)复合身份key)；
            Desktop 上报的设备集合不冒充真实「设备组」，组级执行/派发合同未冻结——如实未开放，不猜SN分组 */}
        {(isConfirmed || isStale) && confirmedRows.length > 0 && (
          <div className="client-group-grid" data-testid={`client-status-panels-${item.clientId}`}>
            {confirmedRows.map((d) => (
              <article className="group-device-cell" key={`${item.clientId}:${d.deviceId}`} data-testid={`client-status-device-${d.deviceId}`}>
                <div className="cell-head">
                  <div className="row-head">
                    <strong>{d.deviceName ?? d.deviceId}</strong>
                    <span className={`tag ${d.status === 'stale' ? 'warn' : d.status === 'online' ? '' : 'gray'}`}>
                      {d.status === 'online' ? '在线' : d.status === 'stale' ? '快照陈旧' : d.status === 'offline' ? '离线' : '未知'}
                    </span>
                  </div>
                  <span className="muted" style={{ fontSize: 11 }}>{kindText(d.kind)}</span>
                </div>
                <MediaViewerPanel
                  clientId={item.clientId}
                  deviceId={d.deviceId}
                  deviceName={d.deviceName}
                  deviceOnline={d.status === 'online' ? true : d.status === 'offline' ? false : null}
                  mediaCapable={item.capabilities?.media === true}
                />
              </article>
            ))}
          </div>
        )}
        {(isConfirmed || isStale) && confirmedRows.length === 0 && (
          <p className="muted">该电脑当前未上报任何连接设备（服务端确认空集）——未上报设备前无从指定查看目标，媒体授权不因只读列表自动获得。</p>
        )}
        <details className="diagnostics" data-testid={`group-contract-note-${item.clientId}`}>
          <summary>设备组说明（如实）</summary>
          <p>上方为该 Desktop 上报的设备集合快照，不是已定义的「真实设备组」负载；组级执行/派发合同未冻结，组选择与执行入口在合同就绪前保持未开放，本页不做 SN 推测分组。</p>
        </details>
        {/* 媒体授权不因RO列表自动获得：查看面板按设备行挂载，授权/传输由服务端会话驱动（r5.1 已部署）*/}
      </details>
    </div>
  );
}

/**
 * 卡片消费的三态——从共享 DevicesReadState 归并映射：
 *
 * unconfirmed: 未知 ——probe/上游决定（未部署 or pending or 离线），不报 0 台，显示「待端点部署/读取中」。
 *
 * confirmed: 实际设备读取成功（ready/empty）——显示 N台/0台。
 *
 * stale-read: 读取失败但保留最近成功设备行与时间——卡片保
 * 留旧行+时间并明确标「读取失败/数据陈旧」（与服务端设备status区分）。
 */
export type DevicesFromReadState =
  | { kind: 'unconfirmed'; reason: 'endpoint-not-deployed' | 'pending' | 'error' }
  | { kind: 'confirmed'; rows: DeviceSummaryDraft[]; lastUpdatedAt: number | null }
  | { kind: 'stale-read'; rows: DeviceSummaryDraft[]; lastUpdatedAt: number | null; error: string };

// 兼容导出（旧测试路径复用 ClientCards* 命名）——将共享读取视图映射为三态卡片。
export function ClientCards(stateProps: {
  rows: ClientRecord[];
  devicesByClient?: Map<string, DeviceSummaryDraft[]> | null;
  devicesAvailable?: boolean;
}): ReactNode {
  const available = stateProps.devicesAvailable ?? false; // 缺省false=未确认（不报0台）
  const devicesByClient = stateProps.devicesByClient ?? null;
  return (
    <div className="client-list">
      {stateProps.rows.map((item) => {
        const rows = devicesByClient?.get(item.clientId);
        const devices: DevicesFromReadState = available
          ? { kind: 'confirmed', rows: rows ?? [], lastUpdatedAt: null }
          : { kind: 'unconfirmed', reason: 'endpoint-not-deployed' };
        return <ClientCard key={item.clientId} item={item} devices={devices} />;
      })}
    </div>
  );
}

/**
 * 卡片墙消费——将共享 DevicesReadState 映射到卡片级三态（不重复probe推断）。
 */
export function ClientCardsFromReadState(props: {
  rows: ClientRecord[];
  deviceRead: { state: DevicesReadState };
}): ReactNode {
  // 统一从实际读取视图构造卡片设备状态——排陋试图从 hook rows 反推。
  const state = props.deviceRead.state;
  return (
    <div className="client-list">
      {props.rows.map((item) => {
        let devices: DevicesFromReadState;
        switch (state.kind) {
          case 'confirmed':
            devices = {
              kind: 'confirmed',
              rows: groupDevicesByClient(state.rows).get(item.clientId) ?? [],
              lastUpdatedAt: state.lastUpdatedAt,
            };
            break;
          case 'stale-read':
            devices = {
              kind: 'stale-read',
              rows: groupDevicesByClient(state.rows).get(item.clientId) ?? [],
              lastUpdatedAt: state.lastUpdatedAt,
              error: state.error,
            };
            break;
          default:
            devices = { kind: 'unconfirmed', reason: state.reason };
        }
        return <ClientCard key={item.clientId} item={item} devices={devices} />;
      })}
    </div>
  );
}

/**
 * 设备 / Client 页（W14 改版，W18使用共享读取视图）：
 * 卡片墙＋文本/状态筛选；设备为真数据或诚实未知；失败保留旧行并标注陈旧。
 */
export function ClientStatus(props: {
  clientsArea: DataArea<ClientRecord>;
}): React.JSX.Element {
  const clientsArea = useDeliveryArea(
    props.clientsArea,
    () => createRoClientsRead(),
    (conn: RuntimeConnection) => createClientsRead(conn),
  );
  // W18: 统一共享读取视图模型（不再重复创建 area/poll 与 probe 推断）。
  const deviceRead = useDevicesReadView();
  const deviceRows = deviceRead.state.kind === 'confirmed' || deviceRead.state.kind === 'stale-read' ? deviceRead.rows : [];
  const devicesByClient = groupDevicesByClient(deviceRows);

  // 筛选（仅对已获取的真实数据做本地过滤；不产生假数据）
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline' | 'unknown'>('all');

  return (
    <section className="zone" aria-label="Client 状态">
      <div className="zone-title-row">
        <h3 style={{ margin: 0 }}>Client 与设备</h3>
        <span className="muted">
          在线/离线/未知按服务端权威字段显示；设备取自服务端快照面（probe门控）。
        </span>
      </div>

      <div className="filter-bar">
        <label htmlFor="client-filter" className="muted">查找</label>
        <input
          id="client-filter"
          type="text"
          placeholder="主机名 / clientId / 设备名"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <select
          aria-label="按在线状态筛选"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
        >
          <option value="all">全部状态</option>
          <option value="online">在线</option>
          <option value="offline">离线</option>
          <option value="unknown">未知</option>
        </select>
      </div>

      <AreaView<ClientRecord>
        area={clientsArea}
        emptyHint="服务端确认空集：当前作用域内已注册 0 台 Client。"
        renderRows={(rows) => {
          // W22：已吊销 Client 前端隐藏——展示层过滤，服务端历史保留（注册记录页 intentionally 留档）。
          const activeRows = rows.filter((r) => !isRevokedClient(r));
          const filtered = activeRows.filter((r) => {
            const presence = r.online ?? 'unknown';
            if (statusFilter !== 'all' && presence !== statusFilter) return false;
            if (filter.length === 0) return true;
            const haystack = [r.displayName, r.clientId].join(' ').toLowerCase();
            const deviceNames = (devicesByClient?.get(r.clientId) ?? [])
              .map((d) => d.deviceName ?? d.deviceId).join(' ').toLowerCase();
            const q = filter.toLowerCase();
            return haystack.includes(q) || deviceNames.includes(q);
          });
          return (
            <>
              <p className="muted" style={{ margin: '0 0 8px' }} data-testid="client-filter-count">
                {filtered.length} / {activeRows.length} 台 Client（本地筛选，不改变服务端 scope；已吊销不展示）
              </p>
              <ClientCardsFromReadState
                rows={filtered}
                deviceRead={{ state: deviceRead.state }}
              />
            </>
          );
        }}
      />
    </section>
  );
}
