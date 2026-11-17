import {BackButton} from '../components/BackLink';
import { useMemo, useState } from 'react';
import type { DataArea } from '../api/areas';
import type { ClientRecord } from '../api/types';
import type { DeviceSummaryDraft } from '../api/devices-draft';
import { groupDevicesByClient } from '../api/devices-ro';
import type { RuntimeConnection } from '../api/connection';
import { createRoClientsRead } from '../api/readonly-proxy';
import { createClientsRead } from '../api/fetchers-v015';
import { useDeliveryArea } from '../hooks/useDeliveryArea';
import { usePollingArea, type PollState } from '../hooks/usePollingArea';
import { useDevicesReadView } from '../hooks/useDevicesReadView';
import { MediaViewerPanel } from '../components/MediaViewerPanel';
import { formatClock } from '../components/format';
import { isRevokedClient } from '../api/types';

type DeviceRow = DeviceSummaryDraft & { client: ClientRecord };

// W23续修增量（独立复核6911760）：Client 读取完整性与设备读取完整性同一状态模型——
// 工作台计数/设备行归属必须同时消费两资源，「部分读取」（Client 未读完/读完失败而设备已确认）
// 不得按空集推 0/0 或「没有匹配设备」；曾成功后失败的 Client 保留旧行并显式标注陈旧。
// 语义与 useDevicesReadView 对称：unknown 不冒充真零；stale-read 保留最近成功行+时间。
type ClientsRead =
  | { kind: 'unknown'; reason: 'pending' | 'error'; error?: string }
  | { kind: 'confirmed' }
  | { kind: 'stale-read'; lastUpdatedAt: number | null; error: string };

function clientsReadStateOf(area: PollState<ClientRecord>): ClientsRead {
  if (area.status === 'loading' || area.status === 'not-wired') {
    return { kind: 'unknown', reason: 'pending' };
  }
  if (area.status === 'offline') {
    return { kind: 'unknown', reason: 'error', error: '浏览器离线' };
  }
  if (area.status === 'error') {
    return area.lastUpdatedAt == null
      ? { kind: 'unknown', reason: 'error', error: area.error ?? '读取失败（原因未知）' }
      : { kind: 'stale-read', lastUpdatedAt: area.lastUpdatedAt, error: area.error ?? '读取失败（原因未知）' };
  }
  return { kind: 'confirmed' }; // ready / empty：成功读取（含确认空集）
}

/**
 * W23 设备工作台（原型 02/04 对齐）：
 * - 工具栏：名称/SN搜索 + 类型/Client/真实状态过滤 + 卡片/列表切换 + 刷新（重新真实读取，不造数据）；
 * - 主区：电脑包裹其所属设备（无明确配对不猜配）；
 * - 读取组合（W23续修增量）：Client 与设备两资源任意一方未确认成功，数量/行保持未知,
 *   不以 0 冒充；曾成功后失败保留旧值并按资源分别标注读取失败/陈旧（列表与详情共用诊断）；
 * - 工作台：暗色媒体区（真实媒体协议/状态，眼镜真实宽高比）+ 右侧设备信息/日志/任务（未接入=如实空态）。
 */
export function Workspace(props: { clientsArea: DataArea<ClientRecord> }): React.JSX.Element {
  const clientsArea = useDeliveryArea(props.clientsArea, () => createRoClientsRead(), (conn: RuntimeConnection) => createClientsRead(conn));
  const clientsAreaPolled = usePollingArea(clientsArea);
  const devicesRead = useDevicesReadView();

  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'stale' | 'offline' | 'unknown'>('all');
  const [asList, setAsList] = useState(false);
  const [selected, setSelected] = useState<{ clientId: string; deviceId: string } | null>(null);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);

  // C64缺口①③：设备读取未确认为真值（confirmed/stale-read）时，分母/分子一律未知，
  // 不与「真零」并列显示——`0 / 0 台` 只允许出现在确认空集。
  // W23续修增量：Client 读取完整性与之对称——两资源必须同时可用才成行/计数。
  const devicesKnown = devicesRead.state.kind === 'confirmed' || devicesRead.state.kind === 'stale-read';
  const clientRead = clientsReadStateOf(clientsAreaPolled);
  const clientsUsable = clientRead.kind === 'confirmed' || clientRead.kind === 'stale-read';
  const countsKnown = devicesKnown && clientsUsable;
  const deviceRows: DeviceRow[] = useMemo(() => {
    const rows: DeviceRow[] = [];
    if (!countsKnown) return rows;
    const byClient = groupDevicesByClient(devicesRead.rows);
    for (const c of clientsAreaPolled.rows) {
      if (isRevokedClient(c)) continue;
      for (const d of byClient.get(c.clientId) ?? []) rows.push({ ...d, client: c });
    }
    return rows;
  }, [clientsAreaPolled.rows, devicesRead, countsKnown]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return deviceRows.filter((d) => {
      if (typeFilter && d.kind !== typeFilter) return false;
      if (clientFilter && d.client.clientId !== clientFilter) return false;
      if (statusFilter !== 'all' && d.status !== statusFilter) return false;
      if (!q) return true;
      const needle = `${d.deviceName ?? ''} ${d.deviceId} ${d.client.displayName}`.toLowerCase();
      return needle.includes(q);
    });
  }, [deviceRows, query, typeFilter, clientFilter, statusFilter]);

  const selectedClient = selected ? clientsAreaPolled.rows.find((c) => c.clientId === selected.clientId) ?? null : null;
  // C64缺口⑤：选中设备以 (clientId, deviceId) 复合身份查找——两个 Client 可登记
  // 同一 deviceId，仅按 deviceId 会把第一台的标题/状态混给第二台。
  const selectedDevice = selected
    ? filtered.find((d) => d.client.clientId === selected.clientId && d.deviceId === selected.deviceId)
      ?? deviceRows.find((d) => d.client.clientId === selected.clientId && d.deviceId === selected.deviceId)
      ?? null
    : null;

  const typeLabel: Record<string, string> = { phone: '手机', glasses: '眼镜', other: '其他' };

  // C64缺口④：刷新必须同时对 Client 列表与设备列表发起真实重读，
  // 提示只声明「已发起」两资源重读，不提前声称完成/成功。
  const refresh = () => {
    setRefreshNote('已对 Client 列表与设备列表发起重新读取（刷新不生成模拟数据）。');
    setTimeout(() => setRefreshNote(null), 3500);
    clientsAreaPolled.refresh?.();
    devicesRead.refresh();
  };

  // W23续修增量（独立复核第4条）：读取诊断列表/详情共用——详情分支早返回不得丢失
  // 读取失败/数据陈旧提示；只有某资源真的未确认成功过才不显示行，行保留后不伪造
  // 设备离线、不停止现有媒体（媒体按既有合同自行呈现连接/数据状态）。
  const readDiagnostics = (
    <>
      {/* C64缺口③：设备读取失败但保留最近成功行——读取失败/数据陈旧/最近成功时间 */}
      {devicesRead.state.kind === 'stale-read' && (
        <p className="notice-strip" data-testid="workspace-devices-stale">
          读取失败：{devicesRead.state.error}——以下设备行为数据陈旧的最近成功行，显示时间 {formatClock(devicesRead.state.lastUpdatedAt) ?? '未知'}；最近成功之后的服务端变化未反映。
        </p>
      )}
      {/* W23续修增量：Client 读取失败但保留旧行——电脑归属/能力等元数据显式标陈旧 */}
      {clientRead.kind === 'stale-read' && (
        <p className="notice-strip" data-testid="workspace-clients-stale">
          Client 列表读取失败：{clientRead.error}——以下电脑归属/能力等信息为数据陈旧的最近成功行，显示时间 {formatClock(clientRead.lastUpdatedAt) ?? '未知'}；最近成功之后的归属/能力变化未反映，不据此伪造设备离线。
        </p>
      )}
      {/* W23续修增量：Client 从未能取得（首次 pending/失败）——归属不可用，数量未知 */}
      {clientRead.kind === 'unknown' && clientRead.reason === 'error' && (
        <p className="notice-strip" data-testid="workspace-clients-unknown">
          Client 列表读取失败：{clientRead.error ?? '原因未知'}——电脑归属未能取得，设备数量未知（不以 0 冒充）。
        </p>
      )}
    </>
  );

  if (selected && selectedClient && selectedDevice) {
    return (
      <section className="zone" aria-label="设备工作台">
        <div className="page-heading">
          <div>
            <div className="eyebrow">DEVICE / {typeLabel[selectedDevice.kind] ?? '设备'}</div>
            <h1>{selectedDevice.deviceName ?? selectedDevice.deviceId}</h1>
            <p>{selectedClient.displayName} · {typeLabel[selectedDevice.kind] ?? selectedDevice.kind}</p>
          </div>
          <BackButton onClick={() => setSelected(null)}>返回设备</BackButton>
        </div>
        <div style={{ margin: '0 0 12px' }}>{readDiagnostics}</div>
        <div className="workspace-grid">
          <div className="media-stage" data-testid="media-stage">
            <div style={{ width: '100%' }}>
            <MediaViewerPanel
              clientId={selectedClient.clientId}
              deviceId={selectedDevice.deviceId}
              deviceName={selectedDevice.deviceName}
              deviceOnline={selectedDevice.status === 'online' ? true : selectedDevice.status === 'offline' ? false : null}
              mediaCapable={selectedClient.capabilities?.media === true}
            />
            </div>
          </div>
          <div className="panel">
            <div className="tabs-row" role="tablist">
              <button type="button" className="active">设备信息</button>
              <button type="button" disabled title="日志接口未接入（不造数据）">日志</button>
              <button type="button" disabled title="任务接口未接入（不造数据）">任务</button>
            </div>
            <dl className="meta-grid">
              <dt>设备类型</dt><dd>{typeLabel[selectedDevice.kind] ?? selectedDevice.kind}</dd>
              <dt>当前状态</dt><dd>{selectedDevice.status === 'online' ? '在线' : selectedDevice.status === 'stale' ? '快照陈旧' : selectedDevice.status === 'offline' ? '离线' : '未知'}</dd>
              <dt>序列号</dt><dd className="mono">{selectedDevice.deviceId}</dd>
              <dt>最后在库快照</dt><dd>{selectedDevice.lastSnapshotAt}</dd>
              <dt>所属电脑</dt><dd>{selectedClient.displayName}</dd>
              <dt>配对关系</dt><dd>无已确认配对（不按SN/位置猜测）</dd>
            </dl>
            <details className="diagnostics">
              <summary>连接与诊断信息</summary>
              <p>固定工作空间 solopi-lab / glasses。只读权限不能通过浏览器设置更改；权限/固定 scope/协议说明收纳于此，不占首页。</p>
            </details>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="zone" aria-label="设备工作台">
      <div className="page-heading">
        <div>
          <div className="eyebrow">DEVICE WORKSPACE</div>
          <h1>设备工作台</h1>
          <p>查找设备、确认状态，按需打开屏幕。</p>
        </div>
      </div>
      <div className="toolbar">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索设备名称或序列号"
          aria-label="搜索设备"
        />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="设备类型">
          <option value="">全部类型</option>
          <option value="phone">手机</option>
          <option value="glasses">眼镜</option>
          <option value="other">其他</option>
        </select>
        <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} aria-label="按 Client 过滤">
          <option value="">全部电脑</option>
          {clientsAreaPolled.rows.filter((c) => !isRevokedClient(c)).map((c) => (
            <option key={c.clientId} value={c.clientId}>{c.displayName}</option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} aria-label="按状态过滤">
          <option value="all">全部状态</option>
          <option value="online">在线</option>
          <option value="stale">快照陈旧</option>
          <option value="offline">离线</option>
          <option value="unknown">未知</option>
        </select>
        <button type="button" onClick={() => setAsList((v) => !v)}>{asList ? '卡片视图' : '列表视图'}</button>
        <button type="button" onClick={refresh} title="重新读取服务端真实状态">↻ 刷新状态</button>
      </div>
      {refreshNote && <p className="muted" style={{ fontSize: 12 }} data-testid="workspace-refresh-note">{refreshNote}</p>}
      <div className="panel">
        <div className="panel-head">
          <h2>设备列表</h2>
          {/* C64缺口①：读取未确认时分母/分子未知，不以 0 / 0 冒充真零；
          W23续修增量：计数同时消费 Client 与设备读取完整性——部分读取同样未知 */}
          <span className="muted" style={{ fontSize: 12 }} data-testid="workspace-device-count">
            {countsKnown
              ? `${filtered.length} / ${deviceRows.length} 台（本地筛选，不改变服务端 scope${clientRead.kind === 'stale-read' ? '；电脑归属为陈旧读取' : ''}）`
              : devicesKnown
                ? '设备数量未知（电脑归属读取未确认，不以 0 冒充）'
                : '设备数量未知（读取未确认，不以 0 冒充）'}
          </span>
        </div>
        <div style={{ margin: '12px 20px 0' }}>{readDiagnostics}</div>
        {countsKnown ? (
          asList ? (
            <div className="table-scrollbox">
              <table className="mini-table" data-testid="workspace-device-table">
                <thead><tr><th>设备</th><th>类型</th><th>所属电脑</th><th>状态</th><th></th></tr></thead>
                <tbody>
                  {filtered.map((d) => (
                    <tr key={`${d.client.clientId}:${d.deviceId}`}>
                      <td><b>{d.deviceName ?? d.deviceId}</b></td>
                      <td>{typeLabel[d.kind] ?? d.kind}</td>
                      <td>{d.client.displayName}</td>
                      <td>{d.status === 'online' ? '在线' : d.status === 'stale' ? '快照陈旧' : d.status === 'offline' ? '离线' : '未知'}</td>
                      <td><button type="button" onClick={() => setSelected({ clientId: d.client.clientId, deviceId: d.deviceId })} data-testid={`workspace-open-${d.deviceId}`}>查看设备 →</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && <div className="empty-state"><h3>没有匹配设备</h3><p>调整名称或设备类型后重试。</p></div>}
            </div>
          ) : (
            <div className="device-grid" style={{ paddingTop: 16 }}>
              {filtered.map((d) => (
                <article className="device-art" key={`${d.client.clientId}:${d.deviceId}`} data-testid={`workspace-device-${d.deviceId}`}>
                  <div className="device-art-head">
                    <div className="row-head">
                      <h3>{d.deviceName ?? d.deviceId}</h3>
                      <span className={`tag ${d.status === 'stale' ? 'warn' : d.status === 'online' ? '' : 'gray'}`}>
                        {d.status === 'online' ? '在线' : d.status === 'stale' ? '快照陈旧' : d.status === 'offline' ? '离线' : '未知'}
                      </span>
                    </div>
                    <span className="muted" style={{ fontSize: 11 }}>{typeLabel[d.kind] ?? d.kind} · 连接于{d.client.displayName}</span>
                  </div>
                  <div className="device-art-body"><span aria-hidden="true">{d.kind === 'phone' ? '▣' : '∞'}</span><span className="device-kind-tag">设备示意 · 非实时画面</span></div>
                  <div className="device-art-foot">
                    <span>最后在库 {d.lastSnapshotAt}</span>
                    <button type="button" onClick={() => setSelected({ clientId: d.client.clientId, deviceId: d.deviceId })} data-testid={`workspace-open-${d.deviceId}`}>查看设备 ↗</button>
                  </div>
                </article>
              ))}
              {filtered.length === 0 && (
                <div className="empty-state" style={{ gridColumn: '1 / -1' }}><h3>没有匹配设备</h3><p>调整名称或设备类型后重试。</p></div>
              )}
            </div>
          )
        ) : (
          <div className="panel-body empty-state" data-testid="workspace-devices-unknown">
            <div className="empty-ico" aria-hidden="true">▦</div>
            <h3>设备列表不可用</h3>
            <p>{devicesRead.state.kind === 'unknown' && devicesRead.state.reason === 'endpoint-not-deployed'
              ? '设备只读端点未部署——设备数量未知'
              : devicesKnown
                ? 'Client 列表读取中/读取失败——电脑归属未确认，设备数量未知（不以 0 冒充）'
                : '设备读取中/读取失败——数量未知（不以 0 冒充）'}</p>
          </div>
        )}
      </div>
    </section>
  );
}
