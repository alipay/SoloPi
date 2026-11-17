import {PageHeaderActions} from '../components/PageHeaderActions';
import {WorkingOverview} from './WorkingOverview';
import {fetchGroupLevelsPage,type GroupLevel} from '../api/group-levels-ro';
import { MediaViewerPanel } from '../components/MediaViewerPanel';
import { useEffect, useMemo, useState } from 'react';
import type { DataArea } from '../api/areas';
import type { ClientRecord, EnrollmentRequest } from '../api/types';
import { isRevokedClient } from '../api/types';
import type { DeviceSummaryDraft } from '../api/devices-draft';
import { createRoClientsRead, createRoEnrollmentsRead } from '../api/readonly-proxy';
import { createClientsRead, createEnrollmentsRead } from '../api/fetchers-v015';
import { groupDevicesByClient } from '../api/devices-ro';
import { useDevicesReadView } from '../hooks/useDevicesReadView';
import type { RuntimeConnection } from '../api/connection';
import { useDeliveryArea } from '../hooks/useDeliveryArea';
import { usePollingArea } from '../hooks/usePollingArea';
import { OnlineBadge, StateBadge } from '../components/StateBadge';
import { DeviceStatusBadge } from '../components/DeviceList';
import { formatClock, formatRelative } from '../components/format';

/**
 * 实验室总览（W14）：一屏回答"我有哪些可用环境、哪里异常、正在跑什么"。
 * 全部数字来自真实/RO轮询——未接线或读取失败显示「未知」，不以0冒充。
 */
function DeviceOverview(props: { deviceHub?: boolean; onGoto?: (page: 'workspace' | 'clients' | 'records' | 'guide') => void }): React.JSX.Element {
  const [levels,setLevels]=useState<GroupLevel[]|null>(null),[groupError,setGroupError]=useState('');
  useEffect(()=>{if(!props.deviceHub)return;const ctl=new AbortController();let active=true;const load=async()=>{try{const all:GroupLevel[]=[];let page:number|null=1;while(page!==null){const r=await fetchGroupLevelsPage(page,ctl.signal);all.push(...r.items);page=r.nextPage;}if(active){setLevels(all);setGroupError('');}}catch(e){if(active)setGroupError((e as Error).message);}};void load();const timer=setInterval(()=>void load(),10000);return()=>{active=false;ctl.abort();clearInterval(timer);};},[props.deviceHub]);
  const [screens, setScreens] = useState<Set<string>>(() => new Set());
  const toggleScreens = (ids: string[], show: boolean) => setScreens(old => {
    const next = new Set(old);
    for (const id of ids) { if (show) next.add(id); else next.delete(id); }
    return next;
  });
  const screenKey = (clientId: string, deviceId: string) => `${clientId}:${deviceId}`;
  const screenIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8M12 16v5"/></svg>;
  const clientsBase = useMemo<DataArea<ClientRecord>>(
    () => ({ key: 'clients', title: 'Client', wired: false, pendingReason: [], draftEndpoints: [], pollIntervalMs: 10_000 }),
    [],
  );
  const clientsArea = useDeliveryArea(
    clientsBase,
    () => createRoClientsRead(),
    (conn: RuntimeConnection) => createClientsRead(conn),
  );
  const clients = usePollingArea(clientsArea);

  const enrollmentsBase = useMemo<DataArea<EnrollmentRequest>>(
    () => ({ key: 'enrollments', title: '注册记录', wired: false, pendingReason: [], draftEndpoints: [], pollIntervalMs: 10_000 }),
    [],
  );
  const enrollmentsArea = useDeliveryArea(
    enrollmentsBase,
    () => createRoEnrollmentsRead(),
    (conn: RuntimeConnection) => createEnrollmentsRead(conn),
  );
  const enrollments = usePollingArea(enrollmentsArea); // W23：新摘要不再陈列注册数，仅保留只读巡检活性
  void enrollments;

  // W16a复核修复：完整area（含wired+fetchers）进useMemo——仅probe翻转时重建，
  // 其余render保持引用稳定，杜绝启用设备端点后的轮询取消/重发风暴。
  // W18：共享读取视图——stat/摘要统一从实际读取状态映射，不再重复probe/成功布尔推断
  const devicesRead = useDevicesReadView();

  const rows = clients.rows;
  // W22：已吊销 Client 前端隐藏（用户决定）——仅展示层过滤；服务端历史不动。
  // 与 online/stale/offline/unknown 不混轴：吊销只看权威 registration.status。
  const visibleRows = rows.filter((r) => !isRevokedClient(r));
  const onlineCount = visibleRows.filter((r) => r.online === 'online').length;
  const isReady = clients.status === 'ready' || clients.status === 'empty';
  // Losing the computer connection ends this page's viewers. Reconnection requires a new click.
  useEffect(() => {
    const onlineIds = new Set(clients.rows.filter(c => !isRevokedClient(c) && c.online === 'online').map(c => c.clientId));
    setScreens(old => {
      const next = new Set([...old].filter(key => [...onlineIds].some(id => key.startsWith(`${id}:`))));
      return next.size === old.size ? old : next;
    });
  }, [clients.rows]);




  // C64缺口②：设备归属过滤依赖 Client 列表真值——Client 读取未确认（pending/error）
  // 时归属集合尚未取得，不能按空 visibleRows 把设备快照/在线/需要关注推成 0，一律「未知」。
  const deviceRows = devicesRead.state.kind === 'confirmed' || devicesRead.state.kind === 'stale-read' ? devicesRead.rows : null;
  const devicesUnderVisible = deviceRows != null && isReady
    ? deviceRows.filter((d) => visibleRows.some((c) => c.clientId === d.clientId))
    : null;
  // W23：需要关注=设备快照陈旧数（warn，真实数据驱动，非固定值）；Client 在线≠设备在线
  const attentionCount = devicesUnderVisible != null
    ? devicesUnderVisible.filter((d) => d.status === 'stale' || d.status === 'offline').length
    : null;

  return (
    <div className={props.deviceHub?'device-hub':undefined}>
      <PageHeaderActions>{props.onGoto&&<button type="button" className="primary" onClick={()=>props.onGoto?.('guide')}>＋ 接入电脑</button>}</PageHeaderActions>
      {!props.deviceHub && <div className="stats-row" data-testid="overview-stats">
        <div className="stat">
          <span className="sub">在线电脑</span>
          <span className="num">{isReady ? onlineCount : '未知'}<small>{isReady ? ` / ${visibleRows.length} 台` : ''}</small></span>
          <small className="hint-line">电脑连接与设备状态分别展示</small>
        </div>
        <div className="stat" data-testid="ov-device-snapshot-stat">
          <span className="sub">设备快照</span>
          <span className="num">{devicesUnderVisible != null ? devicesUnderVisible.length : <span data-testid="devices-stat-unknown" style={{ fontSize: 23, color: '#899396' }}>未知</span>}<small>{devicesUnderVisible != null ? ' 台（权威过滤范围）' : '（权威过滤范围——设备或电脑归属读取未确认）'}</small></span>
          <small className="hint-line">{devicesUnderVisible != null ? `其中在线 ${devicesUnderVisible.filter((d) => d.status === 'online').length} 台` : '读取未完成仍如实标注'}</small>
        </div>
        <div className="stat">
          <span className="sub">需要关注</span>
          <span className="num" style={{ color: 'var(--warn)' }}>{attentionCount != null ? attentionCount : <span style={{ fontSize: 23, color: '#899396' }}>未知</span>}<small>{attentionCount != null ? '台' : ''}</small></span>
          <small className="hint-line">陈旧/离线设备 · 等待快照更新</small>
        </div>
        <div className="stat">
          <span className="sub">运行任务</span>
          <span className="num" style={{ fontSize: 23, color: '#899396' }}>未接入</span>
          <small className="hint-line">暂未提供任务接口（如实空态）</small>
        </div>
      </div>
      }
      <section className="zone" aria-label="Client与设备摘要">
        <div className="zone-title-row">
          <h3 style={{ margin: 0 }}>已接入环境</h3>
          {props.onGoto && !props.deviceHub && (
            <button type="button" className="link-btn" onClick={() => props.onGoto?.('clients')}>
              全部电脑 ↗
            </button>
          )}
        </div>

        {isReady && visibleRows.length === 0 && (
          <p className="muted" style={{ margin: '4px 0' }}>
            服务端确认空集：当前作用域内已注册 0 台 Client。{' '}
            {props.onGoto && (
              <button type="button" className="link-btn" onClick={() => props.onGoto?.('guide')}>
                查看接入指引
              </button>
            )}
          </p>
        )}

        <div className="client-list">
          {visibleRows.map((c) => {
            // W19: only consume shared state Differentiate proven/stale/unknown — remove probe shortcut
            const dc = devicesRead.state;
            const devicesForClient:
              | { kind: 'confirmed'; rows: DeviceSummaryDraft[]; lastUpdatedAt: number | null }
              | { kind: 'stale'; rows: DeviceSummaryDraft[]; lastUpdatedAt: number | null; error: string }
              | { kind: 'unconfirmed' } = dc.kind === 'confirmed'
              ? { kind: 'confirmed', rows: groupDevicesByClient(dc.rows).get(c.clientId) ?? [], lastUpdatedAt: dc.lastUpdatedAt }
              : dc.kind === 'stale-read' ? { kind: 'stale', rows: groupDevicesByClient(dc.rows).get(c.clientId) ?? [], lastUpdatedAt: dc.lastUpdatedAt, error: dc.error } : { kind: 'unconfirmed' };
            const confirmedRows = devicesForClient.kind === 'confirmed' ? devicesForClient.rows : devicesForClient.kind === 'stale' ? devicesForClient.rows : [];
            const groups=levels===null?undefined:(levels.find(l=>l.clientId===c.clientId)?.groups.filter(g=>!g.deleted)??[]);
            const clientOnline = c.online === 'online';
            const screenUnavailable = !clientOnline ? '电脑未连接，暂不可查看屏幕' : c.capabilities?.media !== true ? '此电脑不支持投屏' : '';
            const viewableRows = confirmedRows.filter(d => d.status !== 'offline');
            const renderDevice=(d: DeviceSummaryDraft) => (
                      <article className="device-art" key={d.deviceId}>
                        <div className="device-art-head">
                          <div className="row-head">
                            <h4>{d.deviceName ?? d.deviceId}</h4>
                            <DeviceStatusBadge state={d.status} />
                            <button type="button" className="screen-toggle" aria-label={`${screens.has(screenKey(c.clientId,d.deviceId)) ? '关闭' : '展示'}屏幕：${d.deviceName ?? d.deviceId}`} title={screenUnavailable || (d.status === 'offline' ? '设备离线，暂不可查看屏幕' : '在此处查看设备屏幕')}
                              disabled={!clientOnline || c.capabilities?.media !== true || d.status === 'offline'} aria-pressed={screens.has(screenKey(c.clientId,d.deviceId))}
                              onClick={() => toggleScreens([screenKey(c.clientId,d.deviceId)], !screens.has(screenKey(c.clientId,d.deviceId)))}>{screenIcon}</button>
                          </div>
                          <span className="muted" style={{ fontSize: 11 }}>{d.kind === 'phone' ? '手机' : d.kind === 'glasses' ? '眼镜' : '其他'} · 连接于此电脑</span>
                        </div>
                        {clientOnline && screens.has(screenKey(c.clientId,d.deviceId)) ? <div className="inline-device-screen"><MediaViewerPanel clientId={c.clientId} deviceId={d.deviceId} deviceName={d.deviceName} deviceOnline={d.status === 'online' ? true : d.status === 'offline' ? false : null} mediaCapable={c.capabilities?.media === true} autoStart /></div> : <div className="device-art-body"><span aria-hidden="true">{d.kind === 'phone' ? '▣' : '∞'}</span><span className="device-kind-tag">{clientOnline ? '点击屏幕图标查看' : '电脑未连接，暂不可查看屏幕'}</span></div>}
                        <div className="device-art-foot">
                          <span>最后在库 {formatRelative(d.lastSnapshotAt)}</span>
                        </div>
                      </article>
                    );
            return (
              <div className={`client-card${clientOnline ? ' is-online' : ' is-offline'}`} key={c.clientId} data-testid={`ov-client-${c.clientId}`}>
                {/* W23续修：电脑卡头部对齐原型——机型图标+名称/属性副行+在线徽标；
                    设备卡（device-art）收进电脑卡内，电脑包裹设备卡，层级/间距按 prototype.html */}
                <div className="computer-row">
                  <div className="machine-ico" aria-hidden="true">▰</div>
                  <div className="computer-main">
                    <div className="computer-title"><h3 title={c.clientId}>{c.displayName}</h3><OnlineBadge presence={c.online ?? 'unknown'} /></div>
                    <div className="computer-sub">
                      <span>Client <b>{c.clientVersion}</b></span>
                      <span>心跳 <b>{formatRelative(c.lastHeartbeatAt)}</b></span>
                      <StateBadge status={c.registration.status} />
                    </div>
                  </div>
                  <div className="computer-side">
                    <button type="button" className="screen-toggle" disabled={!clientOnline || !viewableRows.length || c.capabilities?.media !== true}
                      aria-label={`${viewableRows.length > 0 && viewableRows.every(d => screens.has(screenKey(c.clientId,d.deviceId))) ? '关闭' : '展示'}全部设备屏幕：${c.displayName}`}
                      title={screenUnavailable || "展示或关闭这台电脑下全部设备的屏幕"}
                      aria-pressed={confirmedRows.length > 0 && viewableRows.length > 0 && viewableRows.every(d => screens.has(screenKey(c.clientId,d.deviceId)))}
                      onClick={() => toggleScreens(viewableRows.map(d => screenKey(c.clientId,d.deviceId)), !viewableRows.every(d => screens.has(screenKey(c.clientId,d.deviceId))))}>{screenIcon}<span>全部屏幕</span></button>

                    {props.onGoto && !props.deviceHub && (
                      <button type="button" className="link-btn" onClick={() => props.onGoto?.('clients')}>查看电脑 →</button>
                    )}
                  </div>
                </div>
                {!clientOnline && <p className="computer-offline-note" role="status">{c.online === 'offline' ? '电脑已离线' : '电脑连接状态未知'} · 暂不可查看设备屏幕，请先在电脑上启动 Client 并连接实验室。</p>}
                {devicesForClient.kind === 'stale' && (
                  <p className="muted" style={{ margin: '0 20px 10px' }}>读取失败：{devicesForClient.error}（最近成功读取 {devicesForClient.lastUpdatedAt != null ? formatClock(devicesForClient.lastUpdatedAt) : '未知'}，以下为陈旧数据）</p>
                )}
                {devicesForClient.kind === 'unconfirmed' ? (
                  <div className="device-empty">
                    {dc.kind === 'unknown' && dc.reason === 'endpoint-not-deployed'
                      ? '设备只读端点未部署——设备数量未知'
                      : dc.kind === 'unknown' && dc.reason === 'error'
                        ? `设备读取失败——数量未知：${dc.error ?? '原因未知'}`
                        : '设备读取中——数量未知'}
                  </div>
                ) : confirmedRows.length > 0 ? (
                  <div className="desktop-devices">
                    {props.deviceHub && <div className="device-groups">
                      {groupError && <p role="alert">设备组读取失败：{groupError}</p>}
                      {groups?.map(g=><section className="device-group" key={g.groupId} aria-label={g.name}><header><h4>⧉ {g.name}</h4><small title={g.groupId}>{g.members.length} 台设备</small><button className="screen-toggle" disabled={!clientOnline || c.capabilities?.media !== true || !g.members.some(m=>viewableRows.some(d=>d.deviceId===m.deviceId))} title={screenUnavailable || "查看此组可用设备的屏幕"} onClick={()=>toggleScreens(g.members.flatMap(m=>viewableRows.some(d=>d.deviceId===m.deviceId)?[screenKey(c.clientId,m.deviceId!)]:[]),true)}>查看整组屏幕</button></header><div className={`device-grid${confirmedRows.some(d=>screens.has(screenKey(c.clientId,d.deviceId)))?' screen-grid':''}`}>{g.members.map(m=>{const d=confirmedRows.find(d=>d.deviceId===m.deviceId);return d?renderDevice(d):<p key={m.deviceId}>{m.deviceName||m.deviceId||'成员设备'} · 暂无设备快照</p>;})}</div></section>)}
                      {levels!==null && groups?.length===0 && <p className="muted">此电脑尚未建立设备组</p>}
                    </div>}
                    <div className={`device-grid${confirmedRows.some(d=>screens.has(screenKey(c.clientId,d.deviceId)))?' screen-grid':''}`}>{confirmedRows.filter(d=>!props.deviceHub||!groups?.some(g=>g.members.some(m=>m.deviceId===d.deviceId))).map(renderDevice)}</div>
                  </div>
                ) : devicesForClient.kind === 'stale' ? (
                  <div className="device-empty">
                    读取失败：{devicesForClient.error}（实际成功读取 {devicesForClient.lastUpdatedAt != null ? formatClock(devicesForClient.lastUpdatedAt) : ''}，近期无设备数据）
                  </div>
                ) : (
                  <div className="device-empty">该电脑尚未上报连接设备（真实空集：0 台）</div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export function Overview(props: Parameters<typeof DeviceOverview>[0]) {
  return props.deviceHub ? <DeviceOverview {...props}/> : <WorkingOverview onGoto={props.onGoto}/>;
}
