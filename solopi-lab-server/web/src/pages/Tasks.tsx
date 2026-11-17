import {TaskEntryPoints} from '../components/TaskEntryPoints';
import {BackButton} from '../components/BackLink';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DataArea } from '../api/areas';
import { fetchAgentTaskDetail, fetchAgentTasksPage, probeAgentTasksRo, type AgentTaskDetail, type AgentTaskRow, type AgentTaskStatus } from '../api/agent-tasks-ro';
import { TaskGroupView } from './TaskGroupView';
import { formatClock } from '../components/format';

/** P2：长内部ID可复制（拖选即全选）；时间统一用户本地时区、原文留 title 悬停 */
const ID_CELL_STYLE = { userSelect: 'all' as const, WebkitUserSelect: 'all' as const, MozUserSelect: 'all' as const };

/**
 * W25R3 任务中心（Agent任务——工具调用 / prompt 委托；v0.3.3 RO 只读投影，Tasks-only 候选）。
 *
 * 真实状态语义（非作者 R1–R11/N1–N2 反例逐项闭合）：
 * - 列表/详情各自请求代次隔离：迟到旧响应不得覆盖新筛选或新选中详情（R7/R8）；
 * - 坏封套/非法行/身份失配按读取失败拒绝（api 层校验），页面保旧行标陈旧——不冒充确认空集（R1–R4/R11）；
 * - probe 仅 404=no route 判未部署；首次 500 作读取失败显示并可刷新恢复（R5）；
 * - 筛选器常驻（空筛选结果不清失控件）（R6）；
 * - 取消已受理（cancelRequestedAt）与执行器实际停止「未确认」明确分开；lateArchivedResult 仅迟到事实（R10）；
 * - 缺失/非法结果字段如实「未知」，不伪 false/不伪未首写/不伪成功（N1/N2）；
 * - 创建/取消为受控写面未开放：通过配置的任务入口创建，不用禁用按钮冒充完成；
 * - 页面零写请求。自动化用例执行明确标注未开放。
 */

const STATUS_ORDER: AgentTaskStatus[] = ['queued', 'delivered', 'running', 'succeeded', 'failed', 'cancelled', 'expired'];

const statusLabel: Record<AgentTaskStatus, string> = {
  queued: '排队中',
  delivered: '已派发',
  running: '执行中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消（记录）',
  expired: '已过期',
};

const kindLabel: Record<string, string> = { 'tool-call': '工具调用', prompt: 'Prompt 委托' };

/** 三值展示：true/false/未知（缺失/非法不伪 false） */
const tristate = (v: boolean | null | undefined, t: string, f: string): string =>
  v === true ? t : v === false ? f : '未知';

export function Tasks(_props?: unknown): React.JSX.Element {
  const [probe, setProbe] = useState<'unknown' | 'available' | 'not-deployed'>('unknown');
  const [rows, setRows] = useState<AgentTaskRow[] | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | AgentTaskStatus>('');
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<AgentTaskDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // P5（复核者缺口）：翻页——较旧任务可达；nextPage=null 时禁用下一页；筛选切换重置回第1页
  const [pageNum, setPageNum] = useState(1);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const mounted = useRef(true);
  const filterRef = useRef(statusFilter);
  filterRef.current = statusFilter;
  const pageRef = useRef(pageNum);
  pageRef.current = pageNum;

  // R8：列表请求代次——迟到的旧列表响应（含旧筛选请求）按失配丢弃，不覆盖新状态
  const listSeqRef = useRef(0);
  // R7：详情请求代次——迟到的旧详情响应按失配丢弃，不覆盖新选中详情
  const detailSeqRef = useRef(0);

  const load = useCallback(async (seq?: number, reqPage?: number) => {
    const controller = new AbortController();
    const useSeq = seq ?? (listSeqRef.current += 1);
    try {
      setRefreshing(true);
      const filter = filterRef.current;
      const wantPage = reqPage ?? pageRef.current;
      const req = filter === '' ? fetchAgentTasksPage({ page: wantPage }, controller.signal)
        : fetchAgentTasksPage({ status: filter, page: wantPage }, controller.signal);
      const page = await req;
      if (!mounted.current || useSeq !== listSeqRef.current) return; // 代次失配：迟到丢弃（迟页响应同样隔离）
      setRows(page.items);
      setNextPage(page.nextPage);
      setReadError(null);
      setLastUpdatedAt(Date.now());
    } catch (err) {
      if (!mounted.current || useSeq !== listSeqRef.current) return;
      // R11：坏封套/非法行也是读取失败——旧行保留由陈旧提示标注，不冒充确认空集
      setReadError((err as Error).message || '读取失败（原因未知）');
    } finally {
      if (mounted.current && useSeq === listSeqRef.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    void (async () => {
      const ok = await probeAgentTasksRo(new AbortController().signal);
      if (!mounted.current) return;
      setProbe(ok ? 'available' : 'not-deployed');
      if (ok) {
        await load();
        timer = setInterval(() => { if (mounted.current) void load(); }, 10_000);
      }
    })();
    return () => { mounted.current = false; if (timer != null) clearInterval(timer); };
  }, [load]);

  useEffect(() => {
    if (probe !== 'available') return;
    if (pageNum !== 1) { // 筛选切换重置回第1页（旧页号 任务集不适用新筛选）
      setPageNum(1);
      return; // 由 pageNum effect 触发新代次请求
    }
    void load(); // 切换筛选即新代次请求——旧在飞响应自然失配（R8）
  }, [statusFilter, probe, load]);

  useEffect(() => {
    if (probe !== 'available') return;
    void load(undefined, pageNum); // 翻页/重置后按当前页号取——旧响应按代次丢弃
  }, [pageNum, probe, load]); // eslint-disable-line react-hooks/exhaustive-deps

  const openDetail = async (id: string) => {
    setSelected(id);
    setDetail(null);
    setDetailError(null);
    const seq = (detailSeqRef.current += 1);
    try {
      const d = await fetchAgentTaskDetail(id, new AbortController().signal);
      if (!mounted.current || seq !== detailSeqRef.current) return; // R7：迟到详情按代次丢弃
      setDetail(d);
    } catch (err) {
      if (!mounted.current || seq !== detailSeqRef.current) return;
      setDetailError((err as Error).message || '详情读取失败');
    }
  };

  useEffect(() => {
    const openLinkedTask = () => {
      const id = location.hash.match(/^#\/task\/([0-9A-HJKMNP-TV-Z]{26})$/)?.[1];
      if (id) void openDetail(id);
    };
    openLinkedTask();window.addEventListener('hashchange', openLinkedTask);
    return () => window.removeEventListener('hashchange', openLinkedTask);
  }, []);

  useEffect(() => {
    if (!selected || (detail && ['succeeded','failed','cancelled','expired'].includes(detail.status))) return;
    const timer = setInterval(() => {
      const seq = ++detailSeqRef.current;
      void fetchAgentTaskDetail(selected, new AbortController().signal).then(d => {
        if (mounted.current && seq === detailSeqRef.current) { setDetail(d); setDetailError(null); }
      }).catch(err => {
        if (mounted.current && seq === detailSeqRef.current) setDetailError((err as Error).message);
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [selected, detail?.status]);

  const backToList = () => {
    detailSeqRef.current += 1; // 在飞详情失配
    setSelected(null); setDetail(null); setDetailError(null);
  };

  const stale = readError != null && rows != null;

  return (
    <section className="zone" aria-label="测试任务">
      <div className="page-heading">
        <div>
          <div className="eyebrow">AGENT TASKS</div>
          <h1>Agent 任务（工具调用 / Prompt 委托）</h1>
          <p>读取真实 Agent 任务（Server→Client 工具调用与 Prompt 委托）。自动化用例执行尚未开放，本页不冒充。</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={probe !== 'available' || refreshing} title="重新读取服务端真实状态" data-testid="tasks-refresh">↻ 刷新状态</button>
      </div>
      <div className="panel" data-testid="tasks-panel">
        <div className="panel-head">
          <h2>任务列表</h2>
          <span className="muted" style={{ fontSize: 12 }} data-testid="tasks-count">
            {probe === 'available'
              ? rows != null ? `${rows.length} 条（真实读取${lastUpdatedAt != null ? ` · ${formatClock(lastUpdatedAt)}` : ''}）` : '读取中…'
              : probe === 'unknown' ? '探测读面中…' : '读面未部署——数量未知'}
          </span>
        </div>
        {probe === 'not-deployed' && (
          <div className="empty-state" data-testid="tasks-readface-absent">
            <div className="empty-ico" aria-hidden="true">≡</div>
            <h3>任务读面尚未部署</h3>
            <p>服务端 /ro/agent-tasks 只读投影未上线（并非没有任务）——这里不显示模拟任务，也不以空列表冒充。</p>
          </div>
        )}
        {probe === 'unknown' && <div className="empty-state"><p className="muted">正在探测任务读面…</p></div>}
        {readError != null && probe === 'available' && (
          <p className="notice-strip" data-testid="tasks-read-error">
            {stale
              ? `读取失败：${readError}——以下为最近成功读取的陈旧行（${lastUpdatedAt != null ? formatClock(lastUpdatedAt) : '时间未知'}），其后服务端变化未反映。`
              : `读取失败：${readError}——任务数量未知（不以 0 冒充）。`}
          </p>
        )}
        {probe === 'available' && (
          <>
            {/* R6：筛选器常驻——空筛选结果不清失控件（可切回全部） */}
            <div className="toolbar" style={{ margin: '12px 20px' }}>
              <select aria-label="按状态筛选" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} data-testid="tasks-status-filter">
                <option value="">全部状态</option>
                {STATUS_ORDER.map((s) => <option key={s} value={s}>{statusLabel[s]}</option>)}
              </select>
              <button type="button" disabled={refreshing || pageNum <= 1} onClick={() => setPageNum((n) => Math.max(1, n - 1))} title="上一页" data-testid="tasks-prev-page">上一页</button>
              <span className="muted" style={{ fontSize: 12 }} data-testid="tasks-page-indicator">第 {pageNum} 页</span>
              <button type="button" disabled={refreshing || nextPage == null} onClick={() => setPageNum((n) => n + 1)} title="下一页（较旧任务）" data-testid="tasks-next-page">下一页</button>
            </div>
            {(rows ?? []).length > 0 && (
              <div className="table-scrollbox" data-testid="tasks-table">
                <table className="mini-table">
                  <thead><tr><th>任务</th><th>类型</th><th>工具</th><th>状态</th><th>进度</th><th>创建时间</th><th></th></tr></thead>
                  <tbody>
                    {(rows ?? []).map((t) => (
                      <tr key={t.agentTaskId} data-testid={`tasks-row-${t.agentTaskId}`}>
                        <td className="mono" title="拖选可复制完整 ID" style={ID_CELL_STYLE}>{t.agentTaskId}</td>
                        <td>{kindLabel[t.kind] ?? t.kind}</td>
                        <td className="mono">{t.toolName ?? '—'}</td>
                        <td><span className={`tag ${t.status === 'succeeded' ? '' : t.status === 'failed' ? 'gray' : 'warn'}`}>{statusLabel[t.status] ?? t.status}</span></td>
                        <td>{tristate(t.hasProgress, '有记录', '—')}</td>
                        <td title={t.createdAt}>{formatClock(t.createdAt)}</td>
                        <td><button type="button" onClick={() => void openDetail(t.agentTaskId)} data-testid={`tasks-open-${t.agentTaskId}`}>详情</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {rows != null && rows.length === 0 && readError == null && (
              <div className="empty-state" data-testid="tasks-empty-real">
                <h3>{statusFilter !== '' ? `没有 ${statusLabel[statusFilter]} 状态的任务（服务端确认）` : '服务端确认当前作用域内无 Agent 任务'}</h3>
              </div>
            )}
          </>
        )}
        {selected != null && (
          <div className="panel" style={{ margin: '16px 20px' }} data-testid="tasks-detail-panel">
            <div className="panel-head">
              <h2>{selected}</h2><a href={`#/task/${selected}`}>任务直达链接</a>
              <BackButton onClick={backToList} data-testid="tasks-detail-back">返回列表</BackButton>
            </div>
            {detailError != null && <div className="card-body"><p className="notice-strip" data-testid="tasks-detail-error">详情读取失败：{detailError}</p></div>}
            {detail == null && detailError == null && <div className="card-body"><p className="muted">读取详情中…</p></div>}
            {detail != null && (
              <div className="card-body" data-testid="tasks-detail">
                <dl className="meta-grid">
                  <dt>类型</dt><dd>{kindLabel[detail.kind] ?? detail.kind}</dd>
                  <dt>工具</dt><dd className="mono">{detail.toolName ?? '—'}</dd>
                  <dt>状态</dt><dd>{statusLabel[detail.status] ?? detail.status}</dd>
                  <dt>进度</dt><dd>{tristate(detail.hasProgress, '有记录（原文不下发）', '无')}</dd>
                  <dt>超时</dt><dd>{detail.timeoutSec}s</dd>
                  <dt>创建 / 过期</dt><dd title={`${detail.createdAt} / ${detail.expiresAt}`}>{formatClock(detail.createdAt)} / {formatClock(detail.expiresAt)}</dd>
                  {detail.deliveredAt != null && <><dt>派发</dt><dd title={detail.deliveredAt}>{formatClock(detail.deliveredAt)}</dd></>}
                  {detail.startedAt != null && <><dt>开始</dt><dd title={detail.startedAt}>{formatClock(detail.startedAt)}</dd></>}
                  {detail.cancelRequestedAt != null && <><dt>取消请求已受理</dt><dd title={detail.cancelRequestedAt}>{formatClock(detail.cancelRequestedAt)}</dd></>}
                  {detail.endedAt != null && <><dt>结束（记录）</dt><dd title={detail.endedAt}>{formatClock(detail.endedAt)}</dd></>}
                </dl>
                <p style={{ fontSize: 12 }} data-testid="tasks-result">
                  归档结果：{tristate(detail.resultArchived, '有归档载荷（原文不下发）', '无')}
                  {' · '}首写结果：{
                    detail.resultOutcome === 'succeeded' || detail.resultOutcome === 'failed' ? detail.resultOutcome
                      : detail.resultOutcome === null
                        ? '—（非成败终态，不伪成功）'
                        : '未知'
                  }
                  {detail.lateArchivedResult === true ? ' · 迟到存档（仅迟到事实，不证明执行器停止）' : ''}
                  {' · '}错误：{detail.hasResultError === true ? (detail.resultErrorCode ?? '非枚举文本不投影') : tristate(detail.hasResultError, '', '无')}
                </p>
                <p className="muted" style={{ fontSize: 11 }} data-testid="tasks-cancel-semantics">
                  「已取消（记录）/结束记录」为 Server 取消终态记录；迟到存档仅迟到事实、不证明执行器实际停止。执行器实际停止未确认——以设备端收尾证据为准，未确认前不伪作本机资源已释放；取消须经受控写面（未开放），取消已受理与执行器实际停止为两件事。
                </p>
              </div>
            )}
            <TaskGroupView agentTaskId={selected} clientId={detail?.clientId ?? ''} clientOnline={null} />
          </div>
        )}
        <TaskEntryPoints />
        <details className="diagnostics" data-testid="tasks-writeface-note">
          <summary>能力说明：本页只读；网站直接创建/取消（受控写面）未开放</summary>
          <p>Agent 任务（当前已实能力：Server→Client 工具调用与受限 prompt，如 list_devices）经入口代理由受控运行时持凭据派发；自动化测试用例执行与网站直接写面均未开放——禁用入口不冒充完成，写面就绪后本页接入。</p>
        </details>
      </div>
    </section>
  );
}
void ({} as DataArea<unknown>);
