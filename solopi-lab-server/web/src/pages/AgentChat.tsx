import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAgentChatDesktops, probeAgentChatReadface, type AgentChatDesktop } from '../api/agent-chat-desktops-ro';
import { fetchAgentTasksPage, type AgentTaskRow } from '../api/agent-tasks-ro';
import { uaLogin, uaLogout, uaWhoami, uaCreatePromptOutcome, uaTaskDetail, type UaCreatePromptRequest, type UaAgentTaskDetail } from '../api/ua-session';
import { formatClock } from '../components/format';

/**
 * G2 目标3正式实现（dg150现役/ua面）：真实鉴权连接+Desktop选择+输入发送+每目标隔离会话+任务/报告回执。
 *
 * 真实语义：
 * - **登录**：POST /ua/session {token} 一次性提交0600受控凭据→HttpOnly(SameSite=Strict+Secure)会话cookie，
 *   token不落URL/日志/存储（登录成功后立即从内存清除）；登出按钮销毁会话；/ua/whoami探针探真实会话剩余期；
 * - **会话隔离**：每 Desktop(clientId) 一个独立会话（消息/在飞任务/错误/详情代次互不串）；创建请求带
 *   idempotencyKey=本会话内稳定生成（结果未知断线**绝不自动重发**——同键重放由用户确认后对账，
 *   服务端同键同载荷回duplicate原状=对账安全，异载荷409如实展示）；
 * - **回执**：创建200带 agentTaskId 即入会话消息；轮询该任务详情（GET /ua/agent-tasks/{id}——G1接线，
 *   prompt/result归档原文仅在受控会话可见）；终态五值如实，取消受理≠停止；
 * - 结果未知（网络中断/无响应）=「结果未知」状态如实显示+「同键对账」按钮（不自动重发副作用）；
 * - 历史台账：/ro/agent-tasks 按 clientId 过滤只读投影为同会话历史消息（RO面progress/result原文不投影——
 *   详情按钮表示受控详情）；
 * - 委托文本默认不带任何执行授权语义（服务端kind=prompt白名单+结构化前缀由用户编辑）。
 * - 迟回执/失效纪律（W28五红闭合）：鉴权代次（登出/401失效+1）作废全部在途回执与轮询结果并清空
 *   **全部目标**受控报告/委托原文/flight（含持久幂等原键）；同目标并发按request seq执法，旧响应不得
 *   覆盖新回执；幂等原键持久化失败先拒发（不给不可达的恢复承诺）；创建/详情回执必须同ID同归属
 *   Client，异 Client 回执拒绝入会话渲染。
 */

interface SessionState {
  rows: AgentTaskRow[] | null;
  nextPage: number | null;
  readError: string | null;
  refreshing: boolean;
  lastUpdatedAt: number | null;
  /** 本会话在飞任务（发送创建的）——受控详情轮询 */
  flight: FlightTask | null;
}

/** 在飞任务：发送后开始跟踪详情直到终态（终态后归档到会话消息顶部并停止轮询） */
interface FlightTask {
  agentTaskId: string;
  detail: UaAgentTaskDetail | null;
  pollError: string | null;
  outcome: 'created' | 'duplicate' | null;
  /** 结果未知：创建响应未到达（网络中断等）——只能同键对账，绝不自动重发 */
  unknown: boolean;
  pendingKey: string | null;
  lastPolledAt: number | null;
}

const emptySession = (): SessionState => ({ rows: null, nextPage: null, readError: null, refreshing: false, lastUpdatedAt: null, flight: null });

const kindLabel: Record<string, string> = { 'tool-call': '工具调用', prompt: '对话委托' };

const statusLabel: Record<string, string> = {
  queued: '排队中', delivered: '已派发', running: '执行中', succeeded: '成功', failed: '失败', cancelled: '已取消（记录）', expired: '已过期',
};

const TERMINAL: ReadonlySet<string> = new Set(['succeeded', 'failed', 'cancelled', 'expired']);

/** 结果envelope渲染（三端合同增补：result开放object，Client回传{localTaskId,text,...}）——只读展示不解析执行 */
function ResultBody({ result }: { result: Record<string, unknown> | null }): React.JSX.Element | null {
  if (result == null) return null;
  const localTaskId = typeof result.localTaskId === 'string' ? result.localTaskId : null;
  const text = typeof result.text === 'string' ? result.text : null;
  const steps = Array.isArray(result.steps) ? (result.steps as unknown[]).filter((s): s is Record<string, unknown> => typeof s === 'object' && s != null) : [];
  const report = typeof result.report === 'object' && result.report != null ? result.report as Record<string, unknown> : null;
  return (
    <div className="agentchat-result" data-testid="agentchat-result">
      {localTaskId != null && <p className="muted mono" style={{ fontSize: 10, margin: '2px 0' }}>本地任务 <code>{localTaskId}</code></p>}
      {text != null && <pre className="agentchat-report" data-testid="agentchat-report-text">{text}</pre>}
      {steps.length > 0 && (
        <ol className="agentchat-steps" data-testid="agentchat-steps">{steps.map((s, i) => (
          <li key={i}>
            <b>步骤 {typeof s.index === 'number' ? s.index : i + 1}</b>·{String(s.action ?? '未知动作')}·{String(s.deviceId ?? '未绑定设备')}·「{String(s.status ?? '未知')}」{s.note != null ? <span className="muted"> {String(s.note)}</span> : null}
          </li>
        ))}</ol>
      )}
      {report != null && (
        <p className="muted mono" style={{ fontSize: 10, margin: '2px 0' }} data-testid="agentchat-report-ref">
          报告{typeof report.sha256 === 'string' ? ` sha256:${report.sha256.slice(0, 12)}…` : ' 标识缺失如实'}
          {Array.isArray(report.caseEvidence) ? ` · 证据 ${report.caseEvidence.length} 项` : ''}
        </p>
      )}
    </div>
  );
}

export function AgentChat(_props?: unknown): React.JSX.Element {
  const [probe, setProbe] = useState<'unknown' | 'available' | 'not-deployed'>('unknown');
  const [desktops, setDesktops] = useState<AgentChatDesktop[] | null>(null);
  const [selectorError, setSelectorError] = useState<string | null>(null);
  const [activeClientId, setActiveClientId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Record<string, SessionState>>({});
  const mounted = useRef(true);

  // G2受控会话
  const [ua, setUa] = useState<'probing' | 'out' | 'in' | 'blocked'>(null as never as 'probing');
  const [uaExpiresIn, setUaExpiresIn] = useState<number | null>(null);
  const [loginHint, setLoginHint] = useState<string | null>(null);
  const tokenRef = useRef<string>(''); // 一次性提交体——登录后立即清空
  const loginSeqRef = useRef(0);
  const authGenRef = useRef(0); // 鉴权代次：登出/401失效时+1——旧代次的在途回执/轮询结果一律作废（阻断迟回执）

  useEffect(() => { void (async () => { const s = await uaWhoami(new AbortController().signal).catch(() => null); if (!mounted.current) return; if (s == null || s.operatorSession !== true) { setUa('out'); } else { setUa('in'); setUaExpiresIn(s.expiresInSeconds); } })(); return () => { mounted.current = false; }; }, []);

  const doLogin = useCallback(async (token: string) => {
    const seq = (loginSeqRef.current += 1);
    tokenRef.current = ''; // 立即清空——token不经状态保存
    setLoginHint(null);
    try {
      const s = await uaLogin(token, new AbortController().signal);
      if (!mounted.current || seq !== loginSeqRef.current) return;
      authGenRef.current += 1; // 新会话代次——旧代次残留的迟回执不得进入新会话
      setUa('in');
      setUaExpiresIn(s.expiresInSeconds);
      setLoginHint(null);
    } catch (err) {
      if (!mounted.current || seq !== loginSeqRef.current) return;
      setUa('out');
      setLoginHint(`登录失败（${(err as Error).message || '原因未知'}）——凭据由管理员按 0600 受控交付流程提供，本站不保存。`);
    }
  }, []);

  const doLogout = useCallback(async () => {
    try { await uaLogout(new AbortController().signal); } catch { /* 会话可能已过期——登出尽力送达 */ }
    if (mounted.current) invalidateControlled('已登出受控会话——全部目标受控报告/委托原文已清空，在途回执已作废。');
  }, []);

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      const ok = await probeAgentChatReadface(new AbortController().signal);
      if (!mounted.current) return;
      setProbe(ok ? 'available' : 'not-deployed');
      if (!ok) return;
      try {
        const rows = await fetchAgentChatDesktops(new AbortController().signal);
        if (!mounted.current) return;
        setDesktops(rows);
        setSelectorError(null);
      } catch (err) {
        if (!mounted.current) return;
        setSelectorError((err as Error).message || '桌面读面读取失败');
      }
    })();
    return () => { mounted.current = false; };
  }, []);

  const visible = (desktops ?? []).filter((d) => d.clientStatus === 'approved');
  const agents = visible.filter((d) => d.agentCapable);

  const session = activeClientId != null ? sessions[activeClientId] ?? null : null;

  const openSession = useCallback((clientId: string) => {
    setActiveClientId(clientId);
    setSessions((prev) => (prev[clientId] != null ? prev : { ...prev, [clientId]: emptySession() }));
  }, []);

  const loadSession = useCallback(async (clientId: string, page = 1) => {
    setSessions((prev) => ({ ...prev, [clientId]: { ...(prev[clientId] ?? emptySession()), refreshing: true } }));
    try {
      const pg = await fetchAgentTasksPage({ clientId, page }, new AbortController().signal);
      if (!mounted.current) return;
      setSessions((prev) => ({
        ...prev,
        [clientId]: {
          ...(prev[clientId] ?? emptySession()),
          rows: page === 1 ? pg.items : [...(prev[clientId]?.rows ?? []), ...pg.items],
          nextPage: pg.nextPage, readError: null, refreshing: false, lastUpdatedAt: Date.now(),
        },
      }));
    } catch (err) {
      if (!mounted.current) return;
      setSessions((prev) => ({ ...prev, [clientId]: { ...(prev[clientId] ?? emptySession()), readError: (err as Error).message || '读取失败（原因未知）', refreshing: false } }));
    }
  }, []);

  useEffect(() => {
    if (activeClientId == null) return;
    const s = sessions[activeClientId];
    if (s != null && (s.rows != null || s.readError != null || s.refreshing)) return;
    void loadSession(activeClientId);
  }, [activeClientId, sessions, loadSession]);

  /**
   * 发送Q（G2目标3）：同幂等键一次提交；结果未知→unknown态+同键对账（绝不自动重发）。
   * 幂等键持久化：发送前先把{key,text}写入 sessionStorage（同目标一席）——丢响应/刷新/断开后
   * 重入会提示恢复原键（用户确认后同键重放，服务端duplicate回原行=与已建任务同ID对账，
   * 不凭空多创建）。仅幂等键/委托文本入storage——**凭据/token永不入storage永不复用**。
   */
  const IDEM_KEY = 'solopi-ua-idem';
  const idemStore = {
    load: (): Record<string, { key: string; text: string }> => {
      try { return JSON.parse(sessionStorage.getItem(IDEM_KEY) ?? '{}') as Record<string, { key: string; text: string }>; } catch { return {}; }
    },
    /**
     * 发送前持久化原键。写失败=丢响应后无法同键对账——**不再是"无害"**：
     * 返回false由调用方先拒发并给出可恢复原因，不得吞错继续首次POST。
     */
    save: (k: string, cid: string, text: string): boolean => {
      try { sessionStorage.setItem(IDEM_KEY, JSON.stringify({ ...idemStore.load(), [cid]: { key: k, text } })); return true; } catch { return false; }
    },
    clear: (cid: string) => {
      try { const all = idemStore.load(); delete all[cid]; sessionStorage.setItem(IDEM_KEY, JSON.stringify(all)); } catch { /* 无害——清残余尽力 */ }
    },
    /** 认证失效（登出/401）时清全部持久原键与委托原文——受控内容不跨身份残留 */
    clearAll: () => {
      try { sessionStorage.removeItem(IDEM_KEY); } catch { /* 尽力 */ }
    },
  };
  const sendRef = useRef<Record<string, { key: string; text: string; nonce: number }>>({});
  const sendSeqRef = useRef(0);
  const [idemRecover, setIdemRecover] = useState<{ clientId: string; key: string; text: string } | null>(null);
  // 进入会话时发现storage中的未对账原幂等键（unknown/丢响应/刷新后）→ 给用户同键恢复入口
  useEffect(() => {
    if (activeClientId == null) { setIdemRecover(null); return; }
    const saved = idemStore.load()[activeClientId];
    const st = sessions[activeClientId];
    if (saved != null && (st?.flight == null || st.flight.unknown)) {
      setIdemRecover({ clientId: activeClientId, key: saved.key, text: saved.text });
    } else {
      setIdemRecover(null);
    }
  }, [activeClientId, sessions]);
  const doIdemRecover = useCallback(async (clientId: string, saved: { key: string; text: string }) => {
    if (ua !== 'in') return;
    sendRef.current[clientId] = { key: saved.key, text: saved.text, nonce: sendSeqRef.current };
    await sendPrompt(clientId, saved.text);
  }, [ua]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * 认证失效统一入口（登出/任一目标发送或详情401）：
   * - 代次+1 → 旧代次的在途回执/轮询结果一律作废（迟回执不得把受控内容带回DOM）；
   * - 清空**全部目标**的受控会话状态（报告/委托原文/flight），不只清当前目标；
   * - 清内存幂等账与持久原键——受控委托原文不跨身份残留；恢复对账只在新登录后按原键人工确认。
   */
  const invalidateControlled = useCallback((note: string) => {
    authGenRef.current += 1;
    sendRef.current = {};
    idemStore.clearAll();
    setIdemRecover(null);
    setSessions({});
    setUa('out');
    setUaExpiresIn(null);
    setLoginHint(note);
  }, []);

  const sendPrompt = useCallback(async (clientId: string, text: string) => {
    if (ua !== 'in') return;
    const seq = (sendSeqRef.current += 1);
    const gen = authGenRef.current;
    const prevEnvelope = sendRef.current[clientId] ?? idemStore.load()[clientId];
    let idempotencyKey: string;
    if (prevEnvelope != null && prevEnvelope.text === text) {
      idempotencyKey = prevEnvelope.key; // 同键对账（结果未知后的用户确认重放——含storage恢复态；原键已持久，无需再写）
      sendRef.current[clientId] = { key: idempotencyKey, text, nonce: seq };
    } else {
      idempotencyKey = `web-${clientId.slice(-8)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      // 发送前必须持久化原键——丢响应后才能同键对账；存储不可写=对账承诺不可达，先拒发（不吞错继续POST）
      if (!idemStore.save(idempotencyKey, clientId, text)) {
        const why = '本浏览器无法持久化幂等原键（存储不可写）——为保丢响应后可同键对账，本次发送已拒绝；恢复存储（关闭隐私模式/清理配额）后重试将生成新键。';
        setSessions((prev) => ({ ...prev, [clientId]: { ...(prev[clientId] ?? emptySession()), flight: { agentTaskId: '', detail: null, pollError: why, outcome: null, unknown: false, pendingKey: null, lastPolledAt: Date.now() } } }));
        return;
      }
      sendRef.current[clientId] = { key: idempotencyKey, text, nonce: seq };
    }
    const req: UaCreatePromptRequest = { kind: 'prompt', prompt: { text }, clientId, idempotencyKey, timeoutSeconds: 300 };
    setSessions((prev) => ({ ...prev, [clientId]: { ...(prev[clientId] ?? emptySession()), flight: { agentTaskId: '', detail: null, pollError: null, outcome: null, unknown: false, pendingKey: idempotencyKey, lastPolledAt: null } } }));
    const outcome = await uaCreatePromptOutcome(req, new AbortController().signal);
    // 迟回执执法：卸载/鉴权代次已失效/已被同目标更新请求顶替（seq≠最新）——旧响应作废，不得覆盖新回执
    if (!mounted.current || authGenRef.current !== gen) return;
    const latest = sendRef.current[clientId];
    if (latest == null || latest.key !== idempotencyKey || latest.nonce !== seq) return;
    if (outcome.kind === 'created' || outcome.kind === 'duplicate') {
      // 回执一致性核验：响应必须归属请求的Client/带回任务ID——异Client回执拒绝入会话（防拼接冒充）
      if (outcome.detail.clientId !== clientId || outcome.detail.agentTaskId === '') {
        const why = `创建回执归属失配（响应Client ${outcome.detail.clientId.slice(-8)}≠请求 ${clientId.slice(-8)}）——拒绝渲染，请按任务台账对账核实`;
        setSessions((prev) => ({ ...prev, [clientId]: { ...(prev[clientId] ?? emptySession()), flight: { agentTaskId: '', detail: null, pollError: why, outcome: null, unknown: false, pendingKey: idempotencyKey, lastPolledAt: Date.now() } } }));
        return;
      }
      setSessions((prev) => ({
        ...prev,
        [clientId]: {
          ...(prev[clientId] ?? emptySession()),
          flight: { agentTaskId: outcome.detail.agentTaskId, detail: outcome.detail, pollError: null, outcome: outcome.kind, unknown: false, pendingKey: idempotencyKey, lastPolledAt: Date.now() },
        },
      }));
      idemStore.clear(clientId); // 已带ID实回执——清恢复残余，不长留storage
    } else if (outcome.kind === 'unknown') {
      setSessions((prev) => ({
        ...prev,
        [clientId]: {
          ...(prev[clientId] ?? emptySession()),
          flight: { agentTaskId: '', detail: null, pollError: '创建请求结果未知（网络中断或无响应）——未自动重发；可用同幂等键对账或稍后在历史台账中查询', outcome: null, unknown: true, pendingKey: idempotencyKey, lastPolledAt: Date.now() },
        },
      }));
    } else if (outcome.kind === 'conflict') {
      const why = `同幂等键载荷冲突（${outcome.message}）——请修改内容后重试（新键）`;
      setSessions((prev) => ({ ...prev, [clientId]: { ...(prev[clientId] ?? emptySession()), flight: { agentTaskId: '', detail: null, pollError: why, outcome: null, unknown: false, pendingKey: idempotencyKey, lastPolledAt: Date.now() } } }));
    } else if (outcome.kind === 'unauthorized') {
      // 401=认证失效：作废旧代次在途回执，清空**全部目标**受控缓存（不只当前目标——其他目标的报告也须消失）
      invalidateControlled('发送401：受控会话已失效——已清空全部目标的受控报告/委托原文并作废在途回执，请重新登录。');
      return;
    } else {
      const rej = outcome as { status: number; message: string };
      const why = `服务端拒绝（HTTP ${String(rej.status)}，${String(rej.message)}）`;
      setSessions((prev) => ({ ...prev, [clientId]: { ...(prev[clientId] ?? emptySession()), flight: { agentTaskId: '', detail: null, pollError: why, outcome: null, unknown: false, pendingKey: idempotencyKey, lastPolledAt: Date.now() } } }));
    }
  }, [ua]);

  /** 在飞任务详情轮询（受控G1详情）到终态归档 */
  useEffect(() => {
    if (activeClientId == null) return;
    const st = sessions[activeClientId];
    const fl = st?.flight;
    if (fl == null || fl.agentTaskId === '' || (fl.detail != null && TERMINAL.has(fl.detail.status))) return;
    const flight = fl;
    const cid = activeClientId;
    // 轮询节流3s（404/空结果也限速不热循环）；节流窗内用定时器补轮，不依赖下一次渲染触发
    const waitMs = flight.lastPolledAt != null ? Math.max(0, 3000 - (Date.now() - flight.lastPolledAt)) : 0;
    const timer = setTimeout(() => { void attemptPoll(cid, flight.agentTaskId); }, waitMs);
    return () => clearTimeout(timer);
    function attemptPoll(cidNow: string, currentId: string) {
      const gen = authGenRef.current;
      void (async () => {
      let detail: UaAgentTaskDetail | null = null;
      let pollFailed = false;
      try { detail = await uaTaskDetail(currentId, new AbortController().signal); } catch { pollFailed = true; }
      if (!mounted.current || authGenRef.current !== gen) return; // 卸载/认证失效后的迟轮询作废
      if (detail == null && !pollFailed) {
        // uaTaskDetail的null=401会话失效——认证统一失效（清全部目标受控缓存并作废在途回执）
        invalidateControlled('详情401：受控会话已失效——已清空全部目标的受控报告/委托原文，请重新登录。');
        return;
      }
      setSessions((prev) => {
        const st = prev[cidNow];
        if (st?.flight == null || st.flight.agentTaskId !== currentId) return prev; // 会话内代次
        // 受控详情一致性执法：回执必须同ID同Client——异Client报告不得进入本目标会话
        if (detail != null && (detail.agentTaskId !== currentId || detail.clientId !== cidNow)) return prev;
        // 404/空结果也推进轮询时间戳——新一轮发起（任务creation可见前/详情尚未落账时持续轮询到终态）；
        // 已终态则立即归档停止
        return { ...prev, [cidNow]: { ...st, flight: { ...st.flight, detail: detail ?? st.flight.detail, lastPolledAt: Date.now() } } };
      });
      })();
    }
  }, [activeClientId, sessions]);

  const activeDesktop = visible.find((d) => d.clientId === activeClientId) ?? null;
  const stale = session != null && session.readError != null && session.rows != null;
  const flight = session?.flight ?? null;

  return (
    <section className="zone" aria-label="Agent 会话">
      <div className="page-heading">
        <div>
          <div className="eyebrow">AGENT SESSIONS</div>
          <h1>Agent 会话</h1>
          <p>受控登录后向真实 Client Agent 发送对话委托，实时可见任务状态与报告回执（每 Desktop 独立会话）。</p>
        </div>
        {ua === 'in' ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="badge badge-approved" data-testid="agentchat-session-state">已登录（剩余 {uaExpiresIn != null ? Math.floor(uaExpiresIn / 60) : '—'} 分钟）</span>
            <button type="button" onClick={() => { void doLogout(); }} data-testid="agentchat-logout">登出</button>
          </div>
        ) : (
          <span className="badge badge-gray" data-testid="agentchat-session-state">未登录受控会话</span>
        )}
      </div>

      {/* G2受控登录（真实凭据面） */}
      {ua === 'out' && (
        <div className="agentchat-login panel" data-testid="agentchat-login">
          <h3 style={{ marginTop: 0 }}>受控登录</h3>
          <p className="muted" style={{ fontSize: 12 }}>
            一次性提交管理员受控交付的 0600 凭据换取 HttpOnly 会话——本站不保存凭据，登录后仅持会话cookie；
            凭据获取/轮换请按受控交付说明（部署侧handoff流程），页面不做任何匿名替代。
          </p>
          <form onSubmit={(ev) => { ev.preventDefault(); const fd = new FormData(ev.currentTarget); const t = String(fd.get('uatoken') ?? '').trim(); if (t.length > 0) void doLogin(t); (ev.currentTarget as HTMLFormElement).reset(); }}>
            <label style={{ display: 'block', fontSize: 12 }}>
              受控凭据（一次性输入）
              <input name="uatoken" type="password" autoComplete="off" style={{ width: 'min(460px, 100%)' }} data-testid="agentchat-token-input" />
            </label>
            <button type="submit" className="primary" data-testid="agentchat-login-submit">登录</button>
          </form>
          {loginHint != null && <p className="muted" style={{ fontSize: 11 }} data-testid="agentchat-login-hint">{loginHint}</p>}
        </div>
      )}

      {probe === 'not-deployed' && (
        <p className="muted" data-testid="agentchat-readface-absent">Desktop 读面未部署——本页不构造假数据。</p>
      )}
      {selectorError != null && (
        <div className="flash-box" role="alert" data-testid="agentchat-selector-error">Desktop 列表读取失败：{selectorError}</div>
      )}

      {probe === 'available' && (
        <>
          <div className="agentchat-layout">
            <aside className="agentchat-sidebar" aria-label="Client Agent 选择">
              <p className="muted" style={{ fontSize: 11, margin: '0 0 6px' }} data-testid="agentchat-sidecount">
                {desktops == null ? '读取中…' : `真实 Desktop ${visible.length} 台（已吊销不展示）；其中具备 Agent 能力 ${agents.length} 台`}
              </p>
              <div className="agentchat-list">
                {visible.map((d) => (
                  <button
                    type="button"
                    key={d.clientId}
                    className={`agentchat-item${activeClientId === d.clientId ? ' active' : ''}`}
                    onClick={() => { if (d.agentCapable) openSession(d.clientId); }}
                    disabled={!d.agentCapable}
                    data-testid={`agentchat-item-${d.clientId}`}
                    title={d.agentCapable ? undefined : '该 Desktop 登记能力未声明 agent——如实不可会话'}
                  >
                    <span>{d.hostname ?? d.clientId.slice(-8)}</span>
                    <span className={`badge badge-${d.online === 'online' ? 'approved' : 'gray'}`}>{d.online === 'online' ? '在线' : d.online === 'offline' ? '离线' : '状态未知'}</span>
                    <span className="tag gray" style={{ fontSize: 10 }}>{d.agentCapable ? 'Agent 可会话' : '无 Agent 能力'}</span>
                  </button>
                ))}
              </div>
            </aside>

            <div className="agentchat-main" data-testid="agentchat-main">
              {activeDesktop == null ? (
                <div className="panel card-notwired" style={{ padding: '16px 20px' }} data-testid="agentchat-no-session">
                  <p style={{ margin: 0 }}>左侧选择一个具备 Agent 能力的真实 Desktop 开始对话。</p>
                </div>
              ) : (
                <>
                  <div className="row-head" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 6 }}>
                    <strong data-testid="agentchat-session-title">{activeDesktop.hostname ?? activeDesktop.clientId}</strong>
                    <span className="muted" style={{ fontSize: 11 }}>
                      独立会话 · 幂等键对账制（结果未知绝不自动重发）
                      {activeDesktop.lastHeartbeatAt != null ? ` · 心跳 ${formatClock(activeDesktop.lastHeartbeatAt)}` : ''}
                    </span>
                  </div>
                  {activeDesktop.online !== 'online' && (
                    <p className="tag gray" style={{ marginTop: 6 }} data-testid="agentchat-offline-note">
                      该 Desktop 当前{activeDesktop.online === 'offline' ? '离线' : '状态未知'}——可发送委托（服务端入队）但Client上线前不会执行。
                    </p>
                  )}
                  {stale && (
                    <div className="alert-strip" role="alert" data-testid="agentchat-stale-note">
                      历史台账读取失败（保留上次数据并标注陈旧，不冒充最新）：{session?.readError}
                    </div>
                  )}

                  {/* G2发送面（受控会话内可用） */}
                  {ua === 'in' ? (
                    <form className="agentchat-compose" onSubmit={(ev) => { ev.preventDefault(); const fd = new FormData(ev.currentTarget); const t = String(fd.get('q') ?? '').trim(); if (t.length > 0) void sendPrompt(activeDesktop.clientId, t); (ev.currentTarget as HTMLFormElement).reset(); }} data-testid="agentchat-compose">
                      <label style={{ display: 'block', fontSize: 12 }}>对话委托
                        <textarea name="q" rows={3} style={{ width: '100%' }} placeholder="例如：[委托] 用例:示例A 组:交互设备组 设备:ALL 清点设备清单" data-testid="agentchat-input" />
                      </label>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button type="submit" className="primary" data-testid="agentchat-send">发送委托</button>
                        <span className="muted" style={{ fontSize: 10 }}>kind=prompt 白名单（非执行授权）；同内容重复提交=同幂等键对账。</span>
                      </div>
                    </form>
                  ) : (
                    <p className="muted" style={{ fontSize: 12, marginTop: 8 }} data-testid="agentchat-requires-login">发送对话委托需要先完成受控登录（上方）。</p>
                  )}

                  {/* 未对账的持久原幂等键恢复入口（丢响应/断线/刷新后同ID对账——绝不自动重发） */}
                  {idemRecover != null && (flight == null || flight.unknown) && (
                    <div className="agentchat-flight" data-testid="agentchat-idem-recover" style={{ border: '1px dashed var(--warn)', background: 'var(--warn-bg)' }}>
                      <p style={{ fontSize: 11, margin: '4px 0' }}>
                        恢复未对账委托：上次发送无回执，原幂等键 <code className="mono">{idemRecover.key}</code>（委托「{idemRecover.text.slice(0, 60)}{idemRecover.text.length > 60 ? '…' : ''}」）。
                        用同键重放=服务端按duplicate回原任务ID，不会凭空新建；<strong>是否对账由你确认</strong>。
                        <button type="button" style={{ fontSize: 11, marginLeft: 8 }} data-testid="agentchat-idem-recover-btn" onClick={() => { void doIdemRecover(idemRecover.clientId, { key: idemRecover.key, text: idemRecover.text }); setIdemRecover(null); }}>同键对账</button>
                      </p>
                    </div>
                  )}

                  {/* 在飞任务（受控详情轮询） */}
                  {flight != null && (
                    <div className="agentchat-flight" data-testid="agentchat-flight">
                      <div className="row-head" style={{ marginBottom: 4 }}>
                        <strong style={{ fontSize: 12 }}>
                          {flight.unknown ? '结果未知（未自动重发）' : `${kindLabel[flight.detail?.kind ?? 'prompt'] ?? '委托'} · ${statusLabel[flight.detail?.status ?? 'queued'] ?? flight.detail?.status ?? '排队中'}${flight.outcome === 'duplicate' ? '（同键对账命中幂等门——未产生新任务）' : ''}`}
                        </strong>
                        {flight.agentTaskId !== '' && <span className="muted mono" style={{ fontSize: 10 }}>{flight.agentTaskId}</span>}
                      </div>
                      {flight.detail?.prompt?.text != null && <p className="muted" style={{ fontSize: 10, margin: '2px 0' }}>委托原文：{flight.detail.prompt.text}</p>}
                      {flight.pollError != null && <p className="mv-hint" style={{ fontSize: 11 }} data-testid="agentchat-flight-error">{flight.pollError}</p>}
                      <ResultBody result={flight.detail?.result ?? null} />
                      {flight.agentTaskId !== '' && flight.detail != null && !TERMINAL.has(flight.detail.status) && (
                        <p className="muted" style={{ fontSize: 10, margin: '2px 0' }}>轮询中（上次 {flight.lastPolledAt != null ? formatClock(flight.lastPolledAt) : '—'}）；排除超时剩余计算以服务端 expiresAt 为准。</p>
                      )}
                    </div>
                  )}

                  {/* 历史台账（/ro真实投影——progress/result原文不投影） */}
                  <div className="agentchat-timeline" data-testid="agentchat-timeline">
                    {session == null || (session.rows == null && session.readError == null) ? (
                      <p className="muted">正在加载该会话的历史台账…</p>
                    ) : session.rows != null && session.rows.length === 0 ? (
                      <p className="muted" data-testid="agentchat-session-empty">该 Desktop 暂无历史任务记录（真实空态）。</p>
                    ) : (
                      (session?.rows ?? []).slice().reverse().map((r) => (
                        <div className="agentchat-msg" key={r.agentTaskId} data-testid={`agentchat-msg-${r.agentTaskId}`}>
                          <div className="row-head" style={{ marginBottom: 2 }}>
                            <span style={{ fontSize: 11, fontWeight: 600 }}>{kindLabel[r.kind] ?? r.kind} · {statusLabel[r.status] ?? r.status}</span>
                            <span className="muted mono" style={{ fontSize: 10 }}>{r.agentTaskId}</span>
                          </div>
                          {r.toolName != null ? <p className="muted" style={{ fontSize: 10, margin: 0 }}>工具 {r.toolName}</p> : null}
                          <p className="muted" style={{ fontSize: 10, margin: 0 }}>
                            创建 {formatClock(r.createdAt)}——结束 {r.endedAt != null ? formatClock(r.endedAt) : '未结束'}
                            {r.cancelRequestedAt != null ? `；取消受理 ${formatClock(r.cancelRequestedAt)}（受理≠停止）` : ''}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                  {session?.nextPage != null && (
                    <button type="button" style={{ fontSize: 11 }} onClick={() => { if (session?.nextPage != null) void loadSession(activeDesktop.clientId, session.nextPage); }} data-testid="agentchat-more">继续加载更早记录</button>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
