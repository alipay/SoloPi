import {BackButton} from '../components/BackLink';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchGroupDispatchDetail, flattenGroupDispatchRows, GROUP_DISPATCH_NON_TERMINAL,
  type GroupDispatchDetail, type GroupDispatchListRow, type GroupDispatchStatus,
} from '../api/group-dispatches-ua';
import {
  fetchGroupLevelsPage, probeGroupLevelsRo, type GroupLevelsMember,
} from '../api/group-levels-ro';
import { formatClock } from '../components/format';
import { MediaViewerPanel } from '../components/MediaViewerPanel';

/** P2：长内部ID可复制（拖选即全选），与任务页同型 */
const ID_CELL_STYLE = { userSelect: 'all' as const, WebkitUserSelect: 'all' as const, MozUserSelect: 'all' as const };

/**
 * AMAW-21 组任务列表/详情——目标4功能接线（对齐 2026-11-08 已上线 Server 面）。
 *
 * 真实语义（不冒充）：
 * - **列表**：/ro/group-levels 已上线只读投影（零凭据、固定scope）——展平真实的组执行
 *   request 行（requestId/groupId/clientId/taskId/phase/receipt 全部来自服务端投影真值）；
 *   requestId 缺失=纯组执行无派发 request，详情入口如实禁用（列表面不造 request）；
 * - **详情**：GET /ua/group-dispatch-detail/{requestId}?clientId=（操作者/管理面受控读——
 *   会话门401、核心 adminSubject/checkAdminScope、浏览器零 Client Bearer/零 token 输入面）；
 *   401=未登录（受控登录在「Agent 会话」页——详情原文随会话失效一并清除不残留，
 *   沿 AMAW-20 鉴权清理成果）；
 * - **标识分账**：requestId 为组执行 request（UUIDv4），与 Agent 任务 ID（ULID）分账——
 *   本页不调 agent-task 详情接口，不把 group request 当 agentTaskId；
 * - **左侧步骤**：detail.steps 为 Client 真实投影——null=合同未冻结/未到（如实缺失不假填）；
 *   数组=真值逐行渲染（缺失字段如实未知）；
 * - **右侧画面**：绑定该 request 的组（groupId）成员 deviceId——优先 detail.members
 *   （Client 投影位）；缺失回退列表行同组的 /ro/group-levels 成员真值（标注来源），
 *   **不回退 Client 设备表冒充任务成员**；上下两路画面=首两台绑定成员；观看走既有
 *   /mv 真实授权+WSS（按钮存在≠已出帧）；
 * - **reportRef**：仅为参考标识（核心 reportRefParsed.fetchable 恒 false）——正式授权
 *   读取/下载接口未上线前不构造链接，单独摘要不叫可访问报告；
 * - 列表/详情请求代次隔离（迟到旧响应按 seq 失配丢弃）；坏封套按读取失败保旧行标陈旧；
 * - 详情轮询只在非终态（requested/confirmed/dispatching/unknown）进行，终态即停；
 * - 页面零写请求（组派发创建/取消在 Client /cp 面，浏览器不经手 Client 会话）。
 */

const STATUS_LABEL: Record<GroupDispatchStatus, string> = {
  requested: '已受理',
  confirmed: '已确认',
  dispatching: '派发中',
  unknown: '结果未知',
  done: '已结束',
  cancelled: '已取消（记录）',
};

const isTerminal = (s: GroupDispatchStatus): boolean => !GROUP_DISPATCH_NON_TERMINAL.has(s);

/** 详情终态/结果三值分账：终态记录在但 outcome 缺失=「未知」，不虚构成功/失败 */
function detailOutcomeText(d: GroupDispatchDetail): string {
  if (d.terminalOutcome != null) return d.terminalOutcome;
  if (d.status === 'cancelled') return 'cancelled';
  if (d.terminalAt != null) return '未知（终态在、outcome 缺失不虚构）';
  return '未知';
}

/** 组成员设备画面绑定来源：projection=detail.members Client 实投影；levels=/ro/group-levels 该组真值 */
interface ScreenMember { deviceId: string; deviceName: string | null; bound: 'projection' | 'levels' }

/** 详情在飞/呈现状态：401 分账给登录指引、非鉴权失败如实报错 */
type DetailPhase =
  | { kind: 'loading'; requestId: string }
  | { kind: 'need-login' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; detail: GroupDispatchDetail };

export function GroupTasks(_props?: unknown): React.JSX.Element {
  const [probe, setProbe] = useState<'unknown' | 'available' | 'not-deployed'>('unknown');
  const [readError, setReadError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pageNum, setPageNum] = useState(1);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [rows, setRows] = useState<GroupDispatchListRow[] | null>(null);
  /** 组成员真值（groupId → members）；列表展平时一并存下——详情屏绑定用同一只读投影 */
  const [membersByGroup, setMembersByGroup] = useState<Map<string, GroupLevelsMember[]> | null>(null);
  const [selected, setSelected] = useState<GroupDispatchListRow | null>(null); // 选中行（含 requestId+ clientId）
  const [detailPhase, setDetailPhase] = useState<DetailPhase | null>(null);

  const mounted = useRef(true);
  const listSeqRef = useRef(0);
  const detailSeqRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopDetailPolling = useCallback(() => {
    if (pollTimerRef.current != null) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
  }, []);

  const load = useCallback(async (reqPage?: number) => {
    const controller = new AbortController();
    const seq = (listSeqRef.current += 1);
    try {
      setRefreshing(true);
      const page = await fetchGroupLevelsPage(reqPage ?? pageNum, controller.signal);
      if (!mounted.current || seq !== listSeqRef.current) return; // 迟到代次丢弃
      const flat = flattenGroupDispatchRows(page);
      const members = new Map<string, GroupLevelsMember[]>();
      for (const level of page.items) for (const g of level.groups) members.set(g.groupId, g.members);
      setRows(flat);
      setMembersByGroup(members);
      setNextPage(page.nextPage);
      setReadError(null);
      setLastUpdatedAt(Date.now());
    } catch (err) {
      if (!mounted.current || seq !== listSeqRef.current) return;
      setReadError((err as Error).message || '读取失败（原因未知）'); // 旧行保留标陈旧
    } finally {
      if (mounted.current && seq === listSeqRef.current) setRefreshing(false);
    }
  }, [pageNum]);

  const pollDetailOnce = useCallback(async (rowSel: GroupDispatchListRow, seq: number): Promise<GroupDispatchDetail | null> => {
    try {
      const d = await fetchGroupDispatchDetail(rowSel.requestId, rowSel.clientId, new AbortController().signal);
      if (!mounted.current || seq !== detailSeqRef.current) return null;
      setDetailPhase({ kind: 'ready', detail: d });
      return d;
    } catch (err) {
      if (!mounted.current || seq !== detailSeqRef.current) return null;
      const apiErr = err as { status?: number };
      if (apiErr != null && typeof apiErr.status === 'number' && apiErr.status === 401) {
        stopDetailPolling();
        detailSeqRef.current += 1; // 在飞隔离：后续迟到响应全部失配
        setDetailPhase({ kind: 'need-login' }); // 会话失效：受控详情原文不残留
        return null;
      }
      setDetailPhase({ kind: 'error', message: (err as Error).message || '详情读取失败' });
      return null;
    }
  }, [stopDetailPolling]);

  const startDetailPolling = useCallback((rowSel: GroupDispatchListRow, seq: number) => {
    stopDetailPolling();
    pollTimerRef.current = setInterval(() => {
      if (!mounted.current) { stopDetailPolling(); return; }
      void (async () => {
        const d = await pollDetailOnce(rowSel, seq);
        if (d != null && isTerminal(d.status)) stopDetailPolling(); // 终态即停
      })();
    }, 5_000);
  }, [pollDetailOnce, stopDetailPolling]);

  const openDetail = useCallback((rowSel: GroupDispatchListRow) => {
    stopDetailPolling();
    detailSeqRef.current += 1;
    const seq = detailSeqRef.current;
    setSelected(rowSel);
    setDetailPhase({ kind: 'loading', requestId: rowSel.requestId });
    void (async () => {
      const first = await pollDetailOnce(rowSel, seq);
      if (first != null && !isTerminal(first.status)) startDetailPolling(rowSel, seq);
    })();
  }, [pollDetailOnce, startDetailPolling, stopDetailPolling]);

  useEffect(() => {
    const linked = () => {
      if (!location.hash.startsWith('#/group-task?')) return;
      const q = new URLSearchParams(location.hash.split('?')[1]);
      const requestId = q.get('requestId') ?? '', clientId = q.get('clientId') ?? '';
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId) || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(clientId)) return;
      // Only route identity comes from the URL. Group, membership and results
      // are always loaded from the authorized server detail, never the link.
      openDetail({requestId,clientId,groupId:'',groupName:'',groupExecutionId:null,taskId:null,phase:'unknown',updatedAtMs:0});
    };
    linked();window.addEventListener('hashchange', linked);
    return () => window.removeEventListener('hashchange', linked);
  }, [openDetail]);

  const backToList = useCallback(() => {
    stopDetailPolling();
    detailSeqRef.current += 1; // 在飞详情失配
    setSelected(null);
    setDetailPhase(null);
  }, [stopDetailPolling]);

  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    void (async () => {
      const ok = await probeGroupLevelsRo(new AbortController().signal);
      if (!mounted.current) return;
      setProbe(ok ? 'available' : 'not-deployed');
      if (ok) {
        await load(1);
        timer = setInterval(() => { if (mounted.current && selected == null && detailPhase == null) void load(); }, 10_000);
      }
    })();
    return () => { mounted.current = false; if (timer != null) clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stale = readError != null && rows != null;

  return (
    <section className="zone" aria-label="任务">
      <div className="page-heading">
        <div>
          <div className="eyebrow">TASKS</div>
          <h1>任务</h1>
          <p>查看设备组任务的执行步骤、进度和设备屏幕。</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={refreshing || probe !== 'available'} title="重新读取服务端真实状态" data-testid="grouptasks-refresh">↻ 刷新状态</button>
      </div>

      {probe === 'unknown' && <p className="muted" data-testid="grouptasks-probing">正在探测组任务读面…</p>}

      {probe === 'not-deployed' && (
        <div className="empty-state" data-testid="grouptasks-readface-absent">
          <div className="empty-ico" aria-hidden="true">⧉</div>
          <h3>组任务读面未部署（/ro/group-levels 404）</h3>
          <p>组执行 request 列表依赖服务端已上线的 /ro/group-levels 只读投影——当前入口探测 404，不显示任何模拟组任务。</p>
        </div>
      )}

      {probe === 'available' && (
        <div className="panel" data-testid="grouptasks-panel">
          <div className="panel-head">
            <h2>执行任务</h2>
            <span className="muted" style={{ fontSize: 12 }} data-testid="grouptasks-count">
              {rows != null
                ? `${rows.length} 条（真实读取${lastUpdatedAt != null ? ` · ${formatClock(lastUpdatedAt)}` : ''}${stale ? ' · 陈旧' : ''}）`
                : refreshing ? '读取中…' : '未读取'}
            </span>
          </div>
          {readError != null && (
            <p className="notice-strip" data-testid="grouptasks-read-error">
              {stale
                ? `读取失败：${readError}——以下为最近成功读取的陈旧行，其后服务端变化未反映。`
                : `读取失败：${readError}——数量未知（不以 0 冒充）。`}
            </p>
          )}
          {(rows ?? []).length > 0 && (
            <div className="table-scrollbox" data-testid="grouptasks-table">
              <table className="mini-table">
                <thead><tr><th>组任务 request</th><th>组</th><th>Desktop</th><th>执行登记</th><th>回执</th><th>更新时间</th><th></th></tr></thead>
                <tbody>
                  {(rows ?? []).map((r, i) => (
                    <tr key={`${r.clientId}-${r.groupId}-${r.groupExecutionId ?? r.requestId ?? i}`} data-testid={`grouptasks-row-${i}`}>
                      <td className="mono" title={r.requestId !== '' ? '组执行 request（UUIDv4）——非 agentTaskId；拖选可复制完整 ID' : '该执行无派发 request（登记投影真值缺失）'} style={ID_CELL_STYLE}>
                        {r.requestId !== '' ? r.requestId : '（无派发 request——如实缺失）'}
                      </td>
                      <td title={r.groupId}>{r.groupName}<span className="muted" style={{ fontSize: 10 }}>{' '}{r.groupId.slice(0, 8)}…</span></td>
                      <td className="mono" title={r.clientId} style={ID_CELL_STYLE}>…{r.clientId.slice(-6)}</td>
                      <td>
                        <span className={`tag ${r.phase === 'done' ? (r.receiptOutcome === 'succeeded' ? '' : 'warn') : 'gray'}`}>
                          {r.phase === 'prepared' ? '已登记·未执行' : r.phase === 'dispatching' ? '派发中' : r.phase === 'unknown' ? '结果未知' : r.phase === 'done' ? '已结束' : r.phase}
                        </span>
                        {r.taskId != null && <span className="muted" style={{ fontSize: 10 }}> 任务 …{r.taskId.slice(-6)}</span>}
                      </td>
                      <td>{r.receiptTerminal === true ? `终态：${r.receiptOutcome ?? '未知'}` : r.receiptOutcome != null ? `${r.receiptOutcome}（非终态合取，不冒充）` : '—'}</td>
                      <td>{formatClock(r.updatedAtMs)}</td>
                      <td>
                        <button type="button" disabled={r.requestId === ''} onClick={() => openDetail(r)} data-testid={`grouptasks-open-${i}`} title={r.requestId === '' ? '纯组执行无派发request——无受控详情可读（如实禁用）' : '打开任务详情'}>详情</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows != null && rows.length === 0 && readError == null && (
            <div className="empty-state" data-testid="grouptasks-empty-real">
              <h3>暂无执行任务</h3>
            </div>
          )}
          <div className="toolbar" style={{ margin: '12px 20px' }}>
            <button type="button" disabled={refreshing || pageNum <= 1} onClick={() => { const n = Math.max(1, pageNum - 1); setPageNum(n); void load(n); }} data-testid="grouptasks-prev-page">上一页</button>
            <span className="muted" style={{ fontSize: 12 }} data-testid="grouptasks-page-indicator">第 {pageNum} 页</span>
            <button type="button" disabled={refreshing || nextPage == null} onClick={() => { const n = nextPage ?? pageNum; setPageNum(n); void load(n); }} data-testid="grouptasks-next-page">下一页</button>
          </div>

          {selected != null && (
            <div className="panel" style={{ margin: '16px 20px' }} data-testid="grouptasks-detail-panel">
              <div className="panel-head">
                <a href={`#/group-task?requestId=${selected.requestId}&clientId=${selected.clientId}`}>任务直达链接</a><h2>组任务 request <code className="mono" style={{ userSelect: 'all' }}>{selected.requestId}</code></h2>
                <BackButton onClick={backToList} data-testid="grouptasks-detail-back">返回列表</BackButton>
              </div>
              {detailPhase != null && detailPhase.kind === 'loading' && <div className="card-body"><p className="muted" data-testid="grouptasks-detail-loading">正在读取任务详情…</p></div>}
              {detailPhase != null && detailPhase.kind === 'need-login' && (
                <div className="card-body">
                  <p className="notice-strip" data-testid="grouptasks-detail-login">
                    任务服务暂不可用，部署侧连接需要修复。
                    本站无需登录。请稍后重新打开详情。
                  </p>
                </div>
              )}
              {detailPhase != null && detailPhase.kind === 'error' && (
                <div className="card-body">
                  <p className="notice-strip" data-testid="grouptasks-detail-error">
                    详情读取失败：{detailPhase.message}
                    <span className="muted">——该 request 可能无派发账本行（纯组执行）或归属不符；错误如实显示，不猜成功。</span>
                  </p>
                </div>
              )}
              {detailPhase != null && detailPhase.kind === 'ready' && (
                <GroupDispatchDetailBody detail={detailPhase.detail} row={selected} membersByGroup={membersByGroup} />
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** 详情主体：左步骤×右设备画面（成员绑定）——真实语义见页头注释 */
function GroupDispatchDetailBody(props: {
  detail: GroupDispatchDetail;
  row: GroupDispatchListRow;
  membersByGroup: Map<string, GroupLevelsMember[]> | null;
}): React.JSX.Element {
  const { detail: d, row, membersByGroup } = props;
  const steps = d.steps;
  const receipt = d.execution == null ? null : d.execution.receipt;

  // 画面成员：优先 detail.members（Client 真实投影位）；缺失回退同列表行已取的该组 /ro 真值成员。
  // 组任务页不回退 Client 设备表——那只是「该Client可观看设备」，不能冒充本request任务成员
  const screenMembers: ScreenMember[] = [];
  const seen = new Set<string>();
  for (const m of d.members ?? []) {
    if (m.deviceId == null || seen.has(m.deviceId)) continue;
    seen.add(m.deviceId);
    screenMembers.push({ deviceId: m.deviceId, deviceName: m.deviceName, bound: 'projection' });
  }
  if (screenMembers.length === 0) {
    for (const m of membersByGroup?.get(d.groupId) ?? []) {
      if (m.deviceId == null || seen.has(m.deviceId)) continue;
      seen.add(m.deviceId);
      screenMembers.push({ deviceId: m.deviceId, deviceName: m.deviceName, bound: 'levels' });
    }
  }
  const screens = screenMembers.slice(0, 2); // 上下两路画面=首两台绑定成员
  const hiddenCount = Math.max(0, screenMembers.length - screens.length);

  return (
    <div className="taskgroup-layout" data-testid="grouptask-detail">
      {/* 左：步骤 + 账本/回执 */}
      <div className="taskgroup-left" data-testid="grouptask-steps-col">
        <h4>步骤（组任务 request {d.requestId}）</h4>
        <dl className="meta-grid">
          <dt>组</dt><dd>{row.groupName} <code className="mono" style={ID_CELL_STYLE}>{d.groupId}</code></dd>
          <dt>账本状态</dt><dd>{STATUS_LABEL[d.status]}</dd>
          <dt>创建</dt><dd>{formatClock(row.updatedAtMs)}</dd>
          {d.confirmedAt != null && <><dt>确认</dt><dd>{formatClock(d.confirmedAt)}</dd></>}
          {d.terminalAt != null && <><dt>终态</dt><dd>{formatClock(d.terminalAt)} · {detailOutcomeText(d)}</dd></>}
          {d.cancelRequestedAt != null && <><dt>取消请求已受理</dt><dd>{formatClock(d.cancelRequestedAt)}</dd></>}
          {d.execution?.taskId != null && <><dt>组执行任务</dt><dd className="mono" style={ID_CELL_STYLE}>{d.execution.taskId}</dd></>}
          {d.execution?.phase != null && <><dt>执行阶段</dt><dd>{String(d.execution.phase)}</dd></>}
          <dt>载荷摘要</dt><dd className="mono" style={{ fontSize: 10 }}>{d.payloadSha256 != null ? `${d.payloadSha256.slice(0, 12)}…` : '缺失如实'} · {d.payloadBytes ?? '—'} bytes · 成员摘要 {d.memberSha256 != null ? `${d.memberSha256.slice(0, 12)}…` : '缺失如实'}</dd>
        </dl>
        {steps == null && (
          <p className="muted" data-testid="grouptask-steps-absent">
            真实步骤投影未到（Client 步骤上报合同未冻结/未到达）——不假填步骤；投影到端后本页渲染 Client 实际 case/step 进度。
          </p>
        )}
        {steps != null && steps.length === 0 && (
          <p className="muted" data-testid="grouptask-steps-empty">该组任务请求无步骤归档（服务端确认的真实空态）。</p>
        )}
        {steps != null && steps.map((s, i) => (
          <div className="taskgroup-step" key={i} data-testid={`grouptask-step-${i + 1}`}>
            <b>步骤 {s.index ?? i + 1}</b>
            <span className="muted"> {s.action ?? '动作未投影'} · {s.deviceId ?? '未绑定设备'} · [{s.status ?? '未知'}]</span>
            {s.note != null && <p className="muted" style={{ fontSize: 11, margin: 0 }}>{s.note}</p>}
            {s.at != null && <p className="muted" style={{ fontSize: 10, margin: 0 }}>{formatClock(s.at)}</p>}
          </div>
        ))}
        {receipt != null && (
          <p className="muted mono" style={{ fontSize: 10, margin: '8px 0 0' }} data-testid="grouptask-receipt">
            回执：terminal={String(receipt.terminal)} · resourcesReleased={String(receipt.resourcesReleased)} · outcome={receipt.outcome ?? '未知'}
          </p>
        )}
        {/* reportRef 参考标识原样（fetchable 恒 false——不构链接不下载） */}
        {d.reportRef != null && (
          <p className="muted mono" style={{ fontSize: 10, margin: '8px 0 0' }} data-testid="grouptask-reportref">
            reportRef（参考标识）<code className="mono" style={ID_CELL_STYLE}>{d.reportRef}</code>
            {d.reportRefParsed != null && d.reportRefParsed.scheme != null ? <> · 解析 {d.reportRefParsed.scheme}:…（路径 {d.reportRefParsed.path?.slice(0, 24) ?? '—'}…）</> : ''}
          </p>
        )}
        {d.reportRef != null && (
          <p className="notice-strip" style={{ fontSize: 10 }} data-testid="grouptask-reportref-gap">
            该 reportRef 仅为参考标识（fetchable=false）——正式授权报告读取/下载接口未上线（联调缺口），本页不构造报告链接；单独摘要不构成可访问报告。
          </p>
        )}
      </div>
      {/* 右：该 request 组成员设备画面（既有 /mv 真实授权 + WSS） */}
      <div className="taskgroup-right" data-testid="grouptask-screens-col">
        <h4>组设备画面（绑定该 request 组成员）</h4>
        {screens.length === 0 && (
          <p className="muted" data-testid="grouptask-screens-empty">
            该 request 无成员投影可绑定（组登记无成员 deviceId、或该组不在当前投影页）——不造画面占位，也不以 Client 设备表冒充任务成员。
          </p>
        )}
        {screens.map((m, i) => (
          <div className="taskgroup-screen" key={m.deviceId} data-testid={`grouptask-screen-${i + 1}`}>
            <p className="muted" style={{ fontSize: 10, margin: '4px 0 0' }} data-testid={`grouptask-screen-${i + 1}-origin`}>
              {m.bound === 'projection'
                ? `本request执行投影成员设备 ${m.deviceId}`
                : `该request绑定组（groupId 真值）的成员设备 ${m.deviceId}——来自 /ro/group-levels 服务端层级投影`}
            </p>
            <MediaViewerPanel
              clientId={d.clientId}
              deviceId={m.deviceId}
              deviceName={m.deviceName}
              deviceOnline={null}
              mediaCapable
            />
          </div>
        ))}
        {hiddenCount > 0 && <p className="muted" style={{ fontSize: 10 }}>另有 {hiddenCount} 台绑定成员未在本屏显示（上下两路画面按首两台呈现）。</p>}
        <p className="muted" style={{ fontSize: 10 }}>
          观看走既有真实媒体授权链；按钮存在不等于已出帧——真实画面以浏览器已呈现解码帧（投屏中）为唯一依据，离线/无能力如实禁用。
        </p>
      </div>
    </div>
  );
}
