import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchGroupLevelsPage, probeGroupLevelsRo,
  type GroupLevelsExecution, type GroupLevelsGroup, type GroupLevel, type MemberRole,
} from '../api/group-levels-ro';
import { formatClock } from '../components/format';
import { StateBadge } from '../components/StateBadge';

/** P2：长内部ID可复制（拖选即全选），与任务页同型 */
const ID_CELL_STYLE = { userSelect: 'all' as const, WebkitUserSelect: 'all' as const, MozUserSelect: 'all' as const };

const roleText: Record<MemberRole, string> = { phone: '手机', glasses: '眼镜' };
const kindText = (k: string | null): string | null =>
  k == null ? null
  : k === 'phone' ? '手机'
  : k === 'glasses' ? '眼镜'
  : k === 'tablet' ? '平板'
  : k === 'other' ? '未确认角色（other）'
  : k === 'unknown' || k === '' ? '未知种类'
  : k;

/**
 * DG142 前端：真实 Desktop → 设备组 → 设备 只读层级页（候选，未部署）。
 *
 * 真实状态语义（冻结合同 v0.4.2 §语义边界逐字对齐）：
 * - 登记≠执行：`phase: prepared/unknown` 只是登记/投影原值，任何位置都不显示为执行成功；
 * - 终态判定 = `receipt.terminal===true && receipt.resourcesReleased===true` 的合取；
 *   `resourcesReleased` 只证明资源收尾，单独不推出终态/成功；
 * - 成功 = 上述合取 + `outcome==='succeeded'`；outcome 缺失/非法（null）= 结果未知，不虚构；
 * - 停止请求（stopRequestedAt）= 停止意图事实，与取消终态（outcome=cancelled）分开表达；
 * - 角色/设备种类取真值：登记 role 缺失=null（登记无角色声明）；deviceKind=null 设备库无记录；
 *   `other` 是真相值，不按名字/型号推断；deleted:true = 墓碑真值照常展示；
 * - 已吊销 Desktop 按原用户决定默认隐藏（历史保留在服务端），本页提供明确「显示已吊销历史」入口；
 * - 无组/空执行/空库均为真实空态，不造占位数据；任务/报告标识仅原样展示（读面无按这些
 *   ID 的既有详情端点，不构造假链接）；
 * - 读取纪律同任务页：请求代次隔离防迟覆盖、坏封套按读取失败保旧行标陈旧、probe 仅 404
 *   判未部署；页面零写请求、零口令输入。
 */
export function GroupLevels(_props?: unknown): React.JSX.Element {
  const [probe, setProbe] = useState<'unknown' | 'available' | 'not-deployed'>('unknown');
  const [levels, setLevels] = useState<GroupLevel[] | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pageNum, setPageNum] = useState(1);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);
  const mounted = useRef(true);
  const pageRef = useRef(pageNum);
  pageRef.current = pageNum;
  const listSeqRef = useRef(0);

  const load = useCallback(async (seq?: number, reqPage?: number) => {
    const controller = new AbortController();
    const useSeq = seq ?? (listSeqRef.current += 1);
    try {
      setRefreshing(true);
      const wantPage = reqPage ?? pageRef.current;
      const page = await fetchGroupLevelsPage(wantPage, controller.signal);
      if (!mounted.current || useSeq !== listSeqRef.current) return; // 迟到代次丢弃
      setLevels(page.items);
      setNextPage(page.nextPage);
      setReadError(null);
      setLastUpdatedAt(Date.now());
    } catch (err) {
      if (!mounted.current || useSeq !== listSeqRef.current) return;
      setReadError((err as Error).message || '读取失败（原因未知）'); // 旧行保留由陈旧提示标注
    } finally {
      if (mounted.current && useSeq === listSeqRef.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    void (async () => {
      const ok = await probeGroupLevelsRo(new AbortController().signal);
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
    if (pageNum !== 1) setPageNum(1); // 约束：本页保持第1页起步，翻页走 load(undefined, n)
  }, [probe, pageNum]);

  const visible = (levels ?? []).filter((l) => showRevoked || l.clientStatus !== 'revoked');
  const revokedCount = (levels ?? []).length - visible.length;
  const stale = readError != null && levels != null;

  return (
    <section className="zone" aria-label="设备组层级">
      <div className="page-heading">
        <div>
          <div className="eyebrow">GROUP LEVELS</div>
          <h1>设备组层级</h1>
          <p>Desktop → 设备组 → 设备与执行登记，全部为服务端投影真值（只读）。</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => void load()}
            disabled={refreshing || probe !== 'available'}
            data-testid="levels-refresh"
            title="向服务端只读端点重新读取当前页"
          >
            {refreshing ? '读取中…' : '手动刷新'}
          </button>
          <button
            type="button"
            className={showRevoked ? 'primary' : ''}
            aria-pressed={showRevoked}
            onClick={() => setShowRevoked((v) => !v)}
            data-testid="levels-toggle-revoked"
            title="已吊销 Desktop 默认隐藏（历史保留在服务端）；打开即如实显示其历史登记并标注「已吊销」"
          >
            {showRevoked ? '隐藏已吊销历史' : `显示已吊销历史${levels != null ? `（${revokedCount} 台）` : ''}`}
          </button>
        </div>
      </div>

      {probe === 'not-deployed' && (
        <p className="muted" data-testid="levels-readface-absent">
          组层级读面未部署（HTTP 404）——本页不构造假数据；需部署侧上线 /ro/group-levels 只读面后可用。
        </p>
      )}
      {probe === 'unknown' && <p className="muted" data-testid="levels-probing">正在探测组层级读面…</p>}

      {stale && (
        <div className="alert-strip" role="alert" data-testid="levels-stale-note">
          读取失败（保留上次成功数据并标注陈旧，不冒充最新）：{readError}
        </div>
      )}
      {readError != null && levels == null && (
        <div className="flash-box" role="alert" data-testid="levels-read-error">
          组层级读取失败：{readError}——本页不冒充空集；可稍后重试。
        </div>
      )}

      {probe === 'available' && (
        <>
          <p className="muted" style={{ margin: '0 0 8px' }} data-testid="levels-count">
            {levels == null
              ? '读取中…'
              : `${visible.length} 台 Desktop 有组登记（服务端真实读取${lastUpdatedAt != null ? ` · ${formatClock(lastUpdatedAt)}` : ''}${revokedCount > 0 ? ` · 本地默认隐藏已吊销 ${revokedCount} 台` : ''}）；组 ${visible.reduce((n, l) => n + l.groups.length, 0)} 个。`}
          </p>

          {levels != null && visible.length === 0 && (
            <div className="panel card-notwired" style={{ padding: '18px 20px' }} data-testid="levels-empty-real">
              <p style={{ margin: 0 }}>
                {revokedCount > 0
                  ? `服务端确认：未隐藏的 Desktop 当前无设备组登记（已吊销 ${revokedCount} 台默认隐藏，可切换显示其历史）。`
                  : '服务端确认：当前 scope 内没有任何设备组登记（真实空集，无组不造占位）。'}
              </p>
            </div>
          )}

          <div className="levels-list">
            {visible.map((l) => (
              <div className="client-card" key={l.clientId} data-testid={`levels-desktop-${l.clientId}`}>
                <div className="levels-desktop-head">
                  <strong className="client-name" title={l.clientId}>{l.deviceScope ? l.deviceScope.hostname : '（主机名未申报）'}</strong>
                  <code className="muted mono" style={ID_CELL_STYLE}>{l.clientId}</code>
                  <StateBadge status={l.clientStatus} />
                  {l.clientStatus === 'revoked' && <span className="badge badge-revoked">已吊销（历史登记如实展示）</span>}
                </div>
                {l.groups.length === 0 ? (
                  <p className="muted" style={{ fontSize: 11, margin: '2px 16px 12px' }} data-testid={`levels-desktop-${l.clientId}-nogroup`}>
                    该 Desktop 当前没有组登记（真实空态）。
                  </p>
                ) : (
                  l.groups.map((g) => <GroupCard key={g.groupId} group={g} desktopId={l.clientId} />)
                )}
              </div>
            ))}
          </div>

          <div className="toolbar" style={{ margin: '14px 0 0' }}>
            <button type="button" disabled={pageNum <= 1} onClick={() => { const n = pageNum - 1; setPageNum(n); void load(undefined, n); }} data-testid="levels-prev">上一页</button>
            <span className="muted" style={{ fontSize: 11 }}>第 {pageNum} 页</span>
            <button type="button" disabled={nextPage == null} onClick={() => { const n = nextPage ?? pageNum; setPageNum(n); void load(undefined, n); }} data-testid="levels-next">下一页（第 {nextPage == null ? '—' : nextPage} 页）</button>
          </div>
        </>
      )}
    </section>
  );
}

/** 组卡：墓碑真值样式、成员真值、执行登记/意图/终态分列表达 */
function GroupCard(props: { group: GroupLevelsGroup; desktopId: string }): React.JSX.Element {
  const g = props.group;
  return (
    <div className={`levels-group${g.deleted ? ' levels-group-tombstone' : ''}`} data-testid={`levels-group-${g.groupId}`}>
      <div className="row-head" style={{ marginBottom: 4 }}>
        <strong style={{ fontSize: 13 }}>{g.name}</strong>
        <span className="muted" style={{ fontSize: 10 }}>
          <code className="mono" style={ID_CELL_STYLE}>{g.groupId}</code>
          {' '}· revision {g.revision} · 更新 {formatClock(g.updatedAtMs)}
        </span>
      </div>
      {g.deleted && (
        <p className="muted" style={{ fontSize: 10, margin: '0 0 4px' }} data-testid={`levels-group-${g.groupId}-tomb`}>
          墓碑：Desktop 已声明删除该登记（真值展示，非隐藏）。
        </p>
      )}
      <div className="meta-grid levels-members">
        {g.members.length === 0 && <p className="muted" style={{ margin: 0, fontSize: 10 }}>该组当前无成员（登记真值）。</p>}
        {g.members.map((m, i) => (
          <div className="levels-member" key={`${m.deviceId ?? 'null'}-${i}`} data-testid={`levels-member-${i}`}>
            <span style={{ fontWeight: 500, fontSize: 11 }}>{m.deviceName ?? '（设备库无名称记录）'}</span>
            <span className="muted" style={{ fontSize: 10, ...ID_CELL_STYLE }}>{m.deviceId ?? '（deviceId 缺失）'}</span>
            <span className={`tag ${m.deviceKind === 'other' ? 'gray' : m.deviceStatus === 'online' ? '' : 'gray'}`}>
              {m.role != null ? roleText[m.role] : '登记未声明角色'}
              {m.deviceKind != null ? ` · ${kindText(m.deviceKind)}` : ' · 设备库无记录'}
            </span>
            <span className="badge badge-unknown" style={{ fontSize: 10 }}>{m.deviceStatus ?? '状态未知'}</span>
          </div>
        ))}
      </div>
      <div className="levels-executions">
        {g.executions.length === 0 && <p className="muted" style={{ margin: 0, fontSize: 10 }}>该组无执行登记（真实空态）。</p>}
        {g.executions.map((e, i) => <ExecutionRow key={`${e.groupExecutionId ?? 'null'}-${i}`} exec={e} />)}
      </div>
    </div>
  );
}

/** 执行登记行：登记态/停止意图/终态三分——语义见文件头；任一情形不显示为成功 */
function ExecutionRow(props: { exec: GroupLevelsExecution }): React.JSX.Element {
  const e = props.exec;
  const r = e.receipt;
  // 终态合取（冻结合同）：terminal && resourcesReleased；resourcesReleased 单独只有资源收尾证明
  const isTerminal = r != null && r.terminal === true && r.resourcesReleased === true;
  const phaseText =
    e.phase === 'prepared' ? '已登记·未执行' :
    e.phase === 'dispatching' ? '派发中' :
    e.phase === 'unknown' ? '结果未知' :
    r == null ? '已结束·回执缺失（结果未知）' :
    isTerminal ? `回执终态：${r.outcome === 'succeeded' ? '成功' : r.outcome === 'failed' ? '失败' : r.outcome === 'cancelled' ? '已取消' : '结果未知'}` :
    r.terminal === true ? '回执声明终态·资源收尾未证实（结果未知）' :
    '资源已收尾·不构成终态证据（结果未知）';
  return (
    <div className="levels-exec" data-testid={`levels-exec-${e.groupExecutionId ?? 'null'}`}>
      <span className={`tag ${isTerminal ? (r?.outcome === 'succeeded' ? 'primary' : 'warn') : 'gray'}`}>{phaseText}</span>
      {e.stopRequestedAt != null && (
        <span className="tag warn" data-testid={`levels-exec-${e.groupExecutionId ?? 'null'}-stop`} title={e.stopRequestedAt}>
          已请求停止（停止意图 {formatClock(e.stopRequestedAt)}）
        </span>
      )}
      <span className="muted" style={{ fontSize: 10 }}>
        执行 <code className="mono" style={ID_CELL_STYLE}>{e.groupExecutionId ?? '（缺失）'}</code>
        {' '}任务 <code className="mono" style={ID_CELL_STYLE}>{e.taskId ?? '（无任务标识）'}</code>
        {' '}更新 {formatClock(e.updatedAtMs)}
      </span>
      {r != null && (
        <span className="muted" style={{ fontSize: 10 }}>报告标识 {r.reportRef != null ? <code className="mono" style={ID_CELL_STYLE}>{r.reportRef}</code> : '无'}</span>
      )}
    </div>
  );
}
