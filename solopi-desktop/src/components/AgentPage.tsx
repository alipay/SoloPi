import { useLanguage } from '../language';
import AgentRequestSettings from './AgentRequestSettings';
import {AgentSessionList,AgentComposer,AgentRunStatus,modelRetryText} from './AgentChat';
import { flushSync } from 'react-dom';
import { chatScrollMetrics, chatScrollUpdate, type ChatScrollMetrics } from './agent-chat-scroll';
import AgentQueuedMessage from './AgentQueuedMessage';
import { agentDrafts, useAgentDraft } from './agent-drafts';
import AgentExtensions from './AgentExtensions';
import AgentMarkdown from './AgentMarkdown';
import AgentTurn, { MessageFooter } from './AgentTurn';
import { agentTurns, modelOptions, type AgentModel, type AgentMessage, type AgentCall } from './agent-turns';
import AgentOperationSummary from './AgentOperationSummary';
import { Profiler, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, X, ArrowUp, Loader2, MessageSquare, Plus, Settings2, Square } from 'lucide-react';

type Message = AgentMessage;
type Call = AgentCall;
type Session = { id: string; title: string; status: string; screenMode?: 'main'|'virtual'; screenCleanup?: {confirmed:boolean;ownerActive?:boolean}; screenReport?: {status:'passed'|'failed'|'not_tested';reportPath:string|null;recoveryCleanupConfirmed?:boolean;recoveryRecordRemovalFailed?:boolean;checkpoints:{status:string;reason:string}[]}; updatedAt?: string; messages: Message[]; pendingMessages?: Message[]; queuedMessages?: (Message & { id: string; rawText?: string; editing?:boolean })[]; calls: Call[]; error?: string; contextState?: { phase: string; batchStartedAt?:number; startedAt?:number; outputCharacters?:number; reasoningCharacters?:number; currentChunk?: number; totalChunks?: number; attempt?: number; beforeTokensEstimate?: number; afterTokensEstimate?: number; message?: string }; errorDetails?: unknown; streaming?: {content:string;reasoning:string;toolCallCount:number;stage:string;createdAt:string} | null; retry?: {attempt:number;maxAttempts:number;retryAt:number;phase?:'backoff'|'requesting';reason?:string} | null; watch?: { kind: string; id: string; reviewCases?: boolean }; approvalMode?: 'ask' | 'auto' };
type VirtualPreview = {id:string; screenMode:'virtual'; state:'active'|'unavailable'|'closed'; displayId?:number; image?:string; cleanupConfirmed?:boolean; ocrState?:'ready'|'degraded'|'unavailable'|'unknown'};
type Summary = Pick<Session, 'id' | 'title' | 'status'>;
const suggestions = [
  ['查看已连接设备和可用用例', 'Show connected devices and available test cases'],
  ['帮我编写一个测试用例', 'Help me write a test case'],
  ['运行用例并采集性能和电池温度', 'Run a test case and collect performance and battery temperature'],
  ['分析设备耗电情况', 'Analyze device battery usage'],
];
const labels: Record<string, string> = { discover_tools:'加载所需工具', read_operation_receipt:'读取已有回执', update_work_state:'记录任务进度', read_command_help:'读取命令帮助', read_attachment:'读取附件', describe_capabilities:'查询功能目录', read_device_settings:'读取设备设置', save_device_settings:'保存设备设置', quick_action_list: '查询快捷操作', quick_action_show: '读取快捷操作', quick_action_create: '新建快捷操作', quick_action_import_script: '导入快捷脚本', quick_action_update: '修改快捷操作', quick_action_import_git: '从仓库导入快捷操作', quick_action_export_git: '推送快捷操作到仓库', quick_action_query: '查询快捷操作状态', quick_action_execute: '执行快捷操作', quick_action_visibility: '设置快捷操作显示', quick_action_remove: '移除快捷操作', run_commands:'顺序执行命令', run_command: '执行命令（进程）', install_skill: '安装 Skill', download_file: '下载文件', install_apk: '安装 APK', uninstall_package: '卸载应用', read_configuration: '读取配置', save_configuration: '保存配置', save_environment: '保存环境与TTS配置', save_extensions: '保存MCP与Skills配置', watch_operation: '等待任务完成', read_task_result: '读取执行结果摘要', read_task_report: '读取任务报告', read_performance_report: '读取性能采样', read_case_results: '读取步骤结果', search_task_log: '检索任务日志', read_evidence: '检索完整证据', start_performance: '持续采集性能', cancel_battery_import: '取消耗电导入', list_devices: '查询设备', list_cases: '查询用例', read_case: '读取用例', list_components: '查询组件', save_case: '保存用例', submit_task: '提交测试任务', list_tasks: '查询任务', sample_performance: '采集性能', start_battery_import: '导入耗电日志', read_environment: '查询环境', read_skill: '加载 Skill' };
function AttachmentPreview({ file, disabled, onRemove }: { file: File; disabled: boolean; onRemove: () => void }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!file.type.startsWith('image/')) { setUrl(''); return; }
    const preview = URL.createObjectURL(file);
    setUrl(preview);
    return () => URL.revokeObjectURL(preview);
  }, [file]);
  return <div className="relative flex max-w-48 items-center rounded-lg border border-slate-200 bg-slate-50 p-1" title={file.name}>
    {url ? <img src={url} alt={file.name} className="h-16 w-16 rounded-md object-cover" /> : <span className="truncate px-2 pr-7 text-xs">{file.name}</span>}
    <button type="button" disabled={disabled} aria-label={`移除 ${file.name}`} onClick={onRemove} className="absolute -right-1 -top-1 rounded-full border border-slate-200 bg-white p-0.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"><X size={12} /></button>
  </div>;
}
function RetryCountdown({retry}:{retry:{attempt:number;maxAttempts:number;retryAt:number;phase?:'backoff'|'requesting';reason?:string}}) {
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{
   setNow(Date.now());
   if (retry.phase === 'requesting' || retry.retryAt <= Date.now()) return;
   const timer=setInterval(()=>{const current=Date.now();setNow(current);if(current>=retry.retryAt)clearInterval(timer);},250);
   return()=>clearInterval(timer);
 },[retry.retryAt,retry.phase]);
 if (retry.phase === 'requesting' || retry.retryAt <= now) return null;
 const labels:Record<string,string>={'connect-timeout':'模型连接未建立','first-response-timeout':'等待模型首响应超时','rate-limit':'模型限流','transport-error':'模型连接中断','server-error':'模型服务暂时异常','model-timeout':'模型响应超时','empty-response':'模型返回空响应','incomplete-response':'模型响应不完整'};
 return <div role="status" className="text-sm text-amber-700">{labels[retry.reason || 'rate-limit'] || '模型请求暂时失败'}，{Math.max(0,Math.ceil((retry.retryAt-now)/1000))} 秒后重试（{retry.attempt}/{retry.maxAttempts}），可点击停止取消</div>;
}
function CompactionStatus({state}:{state:{currentChunk?:number;totalChunks?:number;batchStartedAt?:number;outputCharacters?:number;reasoningCharacters?:number}}){
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  return <span>压缩历史 · {state.currentChunk || 1}/{state.totalChunks || 1} 批 · 本批耗时 {Math.max(0,Math.floor((now-(state.batchStartedAt || now))/1000))}s · 摘要 {state.outputCharacters || 0} 字{state.reasoningCharacters ? ` · 推理 ${state.reasoningCharacters} 字` : ''}</span>;
}
export default function AgentPage({ onNavigate, onOpenSettings, deviceControls, initialSessionId, onSessionChange }: { onOpenSettings: (section:'agent-screen'|'agent-reply')=>void; onNavigate: (tab: string) => void; deviceControls: ReactNode; initialSessionId: string; onSessionChange: (id: string) => void }) {
  const { t } = useLanguage();
  const api = window.glassbox?.ipcRenderer;
  const [sessions, setSessions] = useState<Summary[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [sessionError, setSessionError] = useState('');
  const mounted = useRef(false);
  const listRequest = useRef(0);
  const sessionRequest = useRef(0);
  const preferredSession = useRef(initialSessionId);
  const selected = useRef('');
  const [models, setModels] = useState<AgentModel[]>([]);
  const [modelId, setModelId] = useState('');
  const [selectingModel, setSelectingModel] = useState(false);
  const { text, setText, attachments, setAttachments, sending } = useAgentDraft(session?.id || selected.current || initialSessionId);
  const rendererMetrics = useRef({lastSent:0,renderMs:0,maxRenderMs:0,commitCount:0});
  const profileRender = useCallback((_id:string,_phase:string,actualDuration:number) => {
    const value=rendererMetrics.current;value.renderMs+=actualDuration;value.maxRenderMs=Math.max(value.maxRenderMs,actualDuration);value.commitCount++;
  },[]);
  const fileInput = useRef<HTMLInputElement>(null);
  const addFiles = (files: File[]) => {
    setAttachments(old => { const next=[...old,...files]; if(next.length>8 || next.some(f=>!f.size || f.size>20*1024*1024) || next.reduce((n,f)=>n+f.size,0)>32*1024*1024) { setError('最多8个附件，单文件20MB，总大小32MB'); return old; } return next; });
  };
  const encode = (f:File) => new Promise<{name:string;data:string}>((resolve,reject)=>{ const reader=new FileReader(); reader.onerror=()=>reject(Error('附件读取失败：'+f.name)); reader.onload=()=>resolve({name:f.name,data:String(reader.result).split(',')[1]}); reader.readAsDataURL(f); });
  const [error, setError] = useState('');
  const sendLock = useRef(false);
  const [virtualPreviews,setVirtualPreviews] = useState<Record<string,VirtualPreview>>({});
  const [extensions, setExtensions] = useState(false);
  const [requestSettings,setRequestSettings]=useState(false);
  const [sessionsCollapsed, setSessionsCollapsed] = useState(false);
  const chatViewport = useRef<HTMLDivElement>(null);
  const chatContent = useRef<HTMLDivElement>(null);
  const followOutput = useRef(true);
  const lastScrollMetrics = useRef<ChatScrollMetrics | null>(null);
  const touchY = useRef<number | null>(null);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const jumpToBottom = useCallback(() => {
    followOutput.current = true;
    const viewport = chatViewport.current;
    if (viewport) { viewport.scrollTop = viewport.scrollHeight; lastScrollMetrics.current = chatScrollMetrics(viewport); }
    setShowJumpToBottom(false);
  }, []);
  const onChatScroll = (event: React.UIEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const viewport = chatViewport.current;
    if (!viewport) return;
    const metrics = chatScrollMetrics(viewport);
    const update = chatScrollUpdate(lastScrollMetrics.current, metrics, followOutput.current);
    lastScrollMetrics.current = metrics;
    followOutput.current = update.following;
    if (update.scrollToBottom) jumpToBottom();
    else setShowJumpToBottom(update.showJump);
  };
  const invoke = useCallback(async (channel: string, payload = {}) => {
    if (!api) throw Error('请通过 npm run dev 启动 solopi-desktop 桌面端');
    const r = await api.invoke(channel, payload);
    if (r?.error && r?.success === false) throw Error(r.error);
    return r;
  }, [api]);
  useEffect(() => {
    let live = true;
    const refreshModels = () => { void invoke('agent:models').then(r => { if (live) { setModels(r.models); setModelId(r.selectedModelId); } }).catch(e => { if (live) setError(e.message); }); };
    refreshModels(); window.addEventListener('focus', refreshModels);
    return () => { live = false; window.removeEventListener('focus', refreshModels); };
  }, [invoke]);
  const chooseModel = async (id: string) => {
    setSelectingModel(true); setError('');
    try { await invoke('agent:select-model', { modelId: id }); setModelId(id); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSelectingModel(false); }
  };
  const refresh = useCallback(async () => {
    const request = ++listRequest.current;
    setListLoading(true); setListError('');
    try {
      const r = await invoke('agent:list');
      if (!Array.isArray(r.sessions)) throw Error('对话列表读取失败');
      if (!mounted.current || request !== listRequest.current) return;
      setSessions(r.sessions); return r.sessions as Summary[];
    } catch (e) {
      if (mounted.current && request === listRequest.current) setListError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current && request === listRequest.current) setListLoading(false);
    }
  }, [invoke]);
  const select = useCallback(async (id?: string) => {
    const request = ++sessionRequest.current;
    selected.current = id || '';
    setSession(null); setSessionLoading(true); setSessionError('');
    try {
      const r = await invoke(id ? 'agent:get' : 'agent:create', id ? { id } : {});
      if (!r.session?.id) throw Error('对话内容读取失败');
      if (!mounted.current || request !== sessionRequest.current) return;
      selected.current = r.session.id; setSession(r.session);
      if (!id) void refresh();
    } catch (e) {
      if (mounted.current && request === sessionRequest.current) setSessionError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current && request === sessionRequest.current) setSessionLoading(false);
    }
  }, [invoke, refresh]);
  const create = () => select();
  const initialize = useCallback(async () => {
    const request = ++sessionRequest.current;
    setSessionLoading(true); setSessionError('');
    const items = await refresh();
    if (!mounted.current || request !== sessionRequest.current) return;
    if (!items) { setSessionLoading(false); setSessionError('无法加载对话，请重试'); return; }
    const id = items.find(s => s.id === preferredSession.current)?.id || items[0]?.id;
    await select(id);
  }, [refresh, select]);
  useEffect(() => {
    let live = true; mounted.current = true;
    void initialize();
    const frameMetrics = {lastSent:0,renderMs:0,maxRenderMs:0,commitCount:0};
    rendererMetrics.current = frameMetrics;
    const reportFrame = () => {
      const receivedAt=performance.now();
      if(receivedAt-frameMetrics.lastSent<10000)return;
      frameMetrics.lastSent=receivedAt;
      requestAnimationFrame(()=>{
        if(!live)return;
        const memory=(performance as Performance & {memory?:{usedJSHeapSize:number;jsHeapSizeLimit:number}}).memory;
        void invoke('agent:performance',{rendererHeapUsedBytes:memory?.usedJSHeapSize,rendererHeapLimitBytes:memory?.jsHeapSizeLimit,
          ipcToFrameMs:performance.now()-receivedAt,renderMs:frameMetrics.renderMs,maxRenderMs:frameMetrics.maxRenderMs,commitCount:frameMetrics.commitCount}).catch(()=>{});
        frameMetrics.renderMs=0;frameMetrics.maxRenderMs=0;frameMetrics.commitCount=0;
      });
    };
    const performanceTimer=setInterval(reportFrame,10000);
    const changed = (_event: unknown, update: Session | {metadata: Session; from: number; messages: Message[]; calls: Call[]; callIds: string[]; reset: boolean}) => {
      reportFrame();
      // Development HMR can refresh the renderer before the main process restarts.
      if (!('metadata' in update)) {
        if (update.id === selected.current) setSession(update);
        setSessions(previous => [{id:update.id,title:update.title,status:update.status},...previous.filter(item=>item.id!==update.id)]);
        return;
      }
      const s = update.metadata;
      if (s.id === selected.current) setSession(previous => {
        const base = !update.reset && previous?.id===s.id ? previous : undefined;
        const calls = new Map(base?.calls.map(c=>[c.id,c]) || []);
        update.calls.forEach(c=>calls.set(c.id,c));
        return {...s, messages:[...(base?.messages.slice(0,update.from) || []),...update.messages],calls:update.callIds.flatMap(id=>calls.has(id)?[calls.get(id)!]:[])};
      });
      setSessions(previous => [{id:s.id,title:s.title,status:s.status}, ...previous.filter(item=>item.id!==s.id)]);
    };
    api?.on?.('agent:changed', changed);
    return () => { live = false; mounted.current = false; ++listRequest.current; ++sessionRequest.current; clearInterval(performanceTimer); api?.removeListener?.('agent:changed', changed); };
  }, [api, invoke, initialize]);
  useEffect(()=>{const handler=(_event:unknown,value:VirtualPreview)=>{if(value&&typeof value.id==='string'&&value.screenMode==='virtual')setVirtualPreviews(current=>({...current,[value.id]:value}));};api?.on?.('agent:virtual-preview',handler);return()=>api?.removeListener?.('agent:virtual-preview',handler);},[api]);
  useEffect(() => { if (session?.id) onSessionChange(session.id); }, [session?.id, onSessionChange]);
  const [visibleTurns, setVisibleTurns] = useState(20);
  useEffect(()=>setVisibleTurns(20),[session?.id]);
  const turns = useMemo(()=>session ? agentTurns(session.messages, session.calls, session.status) : [], [session]);
  const latestReasoningIndex = session?.messages.reduce((latest, m, index) => m.role === 'assistant' && m.reasoning_content ? index : latest, -1) ?? -1;
  const outputRevision = [session?.id, session?.messages.map(m=>[m.content?.length,m.reasoning_content?.length].join(',')).join(';'), session?.calls.length, session?.calls.at(-1)?.status, session?.status, session?.error].join(':');
  useEffect(() => { jumpToBottom(); }, [session?.id, jumpToBottom]);
  useEffect(() => { if (followOutput.current) jumpToBottom(); }, [outputRevision, jumpToBottom]);
  useEffect(() => {
    const viewport = chatViewport.current, content = chatContent.current;
    if (!viewport || !content) return;
    const observer = new ResizeObserver(() => {
      if (followOutput.current) jumpToBottom();
      else setShowJumpToBottom(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop > 160);
    });
    observer.observe(content);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [jumpToBottom]);
  const perform = async (work: () => Promise<unknown>) => { setError(''); try { await work(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  const send = async () => {
    if (!session || (!text.trim() && !attachments.length) || selectingModel || sendLock.current) return;
    const id = session.id;
    const submission = { draft: null as ReturnType<typeof agentDrafts.beginSend> };
    flushSync(() => { submission.draft = agentDrafts.beginSend(id); });
    const draft = submission.draft;
    if (!draft) return;
    followOutput.current = true;
    sendLock.current = true;
    setError('');
    let accepted = false;
    try {
      const r = await invoke('agent:send', { id, text: draft.text, enqueue: ['running','waiting'].includes(session.status), attachments: await Promise.all(draft.attachments.map(encode)) });
      accepted = true;
      if (selected.current === id) setSession(r.session);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { agentDrafts.finishSend(id, draft.revision, accepted); sendLock.current = false; }

  };
  const setApprovalMode = (mode: string) => void perform(async () => {
    if (session) setSession((await invoke('agent:approval-mode', { id: session.id, mode })).session);
  });
  const busy = sending || session?.status === 'running';
  const [responseWaitSeconds, setResponseWaitSeconds] = useState(0);
  const responseWaitStartedAt = session?.streaming?.stage === 'waiting' ? session.streaming.createdAt : '';
  useEffect(() => {
    if (!responseWaitStartedAt) { setResponseWaitSeconds(0); return; }
    const tick = () => setResponseWaitSeconds(Math.max(0, Math.floor((Date.now() - Date.parse(responseWaitStartedAt)) / 1000)));
    tick(); const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [responseWaitStartedAt]);
  const pending = session?.calls.find(c => c.status === 'pending');
  return <Profiler id="agent" onRender={profileRender}><div className="flex flex-1 min-h-0 min-w-0 bg-[#fafaf8]">
    <div className="flex flex-1 min-w-0 min-h-0 flex-col">
      <div className="relative shrink-0 bg-white" aria-label="设备与快捷操作">{deviceControls}</div>
      <div className="flex flex-1 min-w-0 min-h-0">
        <AgentSessionList items={sessions} selected={session?.id} collapsed={sessionsCollapsed} onCollapse={()=>setSessionsCollapsed(value=>!value)} loading={listLoading} createDisabled={sessionLoading} error={listError} onRetry={()=>void(session?refresh():initialize())} onCreate={()=>void perform(create)} onSelect={id=>void perform(()=>select(id))} footer={<div className="space-y-3"><button aria-label={t("后台屏幕设置", "Background screen settings")} title={t("后台屏幕设置", "Background screen settings")} onClick={()=>onOpenSettings('agent-screen')} className="flex gap-2 items-center text-xs text-slate-500"><Settings2 size={14}/>{!sessionsCollapsed&&t("后台屏幕设置", "Background screen settings")}</button><button aria-label={t("消息自动回复", "Automatic replies")} title={t("消息自动回复", "Automatic replies")} onClick={()=>onOpenSettings('agent-reply')} className="flex gap-2 items-center text-xs text-slate-500"><MessageSquare size={14}/>{!sessionsCollapsed&&t("消息自动回复", "Automatic replies")}</button><button aria-label={t("MCP 与 Skills", "MCP & skills")} title={t("MCP 与 Skills", "MCP & skills")} onClick={()=>setExtensions(true)} className="flex gap-2 items-center text-xs text-slate-500"><Settings2 size={14}/>{!sessionsCollapsed&&t("MCP 与 Skills", "MCP & skills")}</button></div>}/>
        <section className="flex flex-1 min-w-0 min-h-0 flex-col">
      <header className="shrink-0 flex items-center justify-between px-7 py-5 border-b border-slate-200/60"><div className="flex gap-3 items-center"><MessageSquare size={19} /><span className="font-semibold text-slate-800">solopi-desktop Agent</span><span className="text-[10px] tracking-wider text-slate-400 border border-slate-200 rounded px-1.5 py-0.5">EXPERIMENT</span></div><button onClick={() => onNavigate('automation-tasks')} className="text-xs text-slate-500 hover:text-blue-600">{t("查看测试任务 →", "View test runs →")}</button></header>
      <div className="relative flex-1 min-h-0">
      <div ref={chatViewport} onScroll={onChatScroll}
        onWheel={event=>{if(event.deltaY<0)followOutput.current=false;}}
        onTouchStart={event=>{touchY.current=event.touches[0]?.clientY ?? null;}}
        onTouchMove={event=>{const y=event.touches[0]?.clientY;if(y!==undefined && touchY.current!==null && y>touchY.current)followOutput.current=false;touchY.current=y ?? null;}}
        onTouchEnd={()=>{touchY.current=null;}}
        onPointerDown={event=>{if(event.target===event.currentTarget)followOutput.current=false;}}
        onKeyDown={event=>{if(['ArrowUp','PageUp','Home'].includes(event.key))followOutput.current=false;}}
        className="h-full overflow-y-auto px-6 py-8">
        <div ref={chatContent} aria-busy={sessionLoading} className="mx-auto max-w-3xl space-y-6">
          {sessionLoading && <div role="status" aria-live="polite" className="pt-12 space-y-6"><div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin motion-reduce:animate-none" />正在加载对话内容…</div><div aria-hidden="true" className="space-y-6 motion-safe:animate-pulse"><div className="ml-auto h-16 w-2/3 rounded-2xl bg-slate-200/60" /><div className="space-y-3"><div className="h-3 w-4/5 rounded bg-slate-200/70" /><div className="h-3 w-full rounded bg-slate-200/70" /><div className="h-3 w-3/5 rounded bg-slate-200/70" /></div></div></div>}
          {sessionError && <div role="alert" className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700"><p>对话内容加载失败：{sessionError}</p><button onClick={() => void (listError ? initialize() : select(selected.current || undefined))} className="mt-3 underline">重新加载对话</button></div>}
          {!sessionLoading && !sessionError && session && !session.messages.length && <div className="pt-[8vh] pb-8"><div className="text-[11px] tracking-[0.2em] text-slate-400 mb-4">{t("从一个问题开始", "Start with a question")}</div><h1 className="text-3xl font-semibold tracking-tight text-slate-900 mb-3">{t("今天想测什么？", "What would you like to test?")}</h1><p className="text-sm text-slate-500 mb-8">{t("描述目标，我来查询设备、准备配置和执行测试。", "Describe your goal to find devices, prepare the setup, and run tests.")}</p><div className="grid grid-cols-2 gap-3">{suggestions.map(([zh, en]) => <button key={zh} onClick={() => setText(t(zh, en))} className="rounded-xl border border-slate-200 bg-white p-4 text-left text-sm text-slate-600 hover:border-blue-300 hover:text-blue-600 transition-colors">{t(zh, en)}<span className="block mt-3 text-slate-300">↗</span></button>)}</div></div>}
          {turns.length > visibleTurns && <button onClick={()=>setVisibleTurns(n=>n+20)} className="text-sm text-blue-600">加载更早的对话</button>}
          {session && turns.slice(-visibleTurns).map(turn => <AgentTurn sessionId={session.id} key={`${session.id}-${turn.start}`} turn={turn} labels={labels} latestReasoning={session.messages[latestReasoningIndex]} reasoningRevision={latestReasoningIndex} />)}
          {session?.status === 'awaiting_approval' && pending && <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4"><div className="text-sm font-semibold mb-3">{t("确认执行：", "Approve action:")}{labels[pending.name] || pending.name}</div><AgentOperationSummary args={pending.args} /><div className="flex gap-2">{[true,false].map(allow => <button key={String(allow)} onClick={() => void perform(async () => setSession((await invoke('agent:approve', { id: session.id, callId: pending.id, allow })).session))} className={`rounded-lg px-4 py-2 text-xs ${allow ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200'}`}>{allow ? '执行' : '取消此操作'}</button>)}<button onClick={() => setApprovalMode('auto')} className="rounded-lg px-4 py-2 text-xs border border-blue-300 text-blue-700 bg-white">授权并自动执行</button></div></div>}
          {session?.status === 'waiting' && <div role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-700">后台任务进行中，{session.watch?.reviewCases ? '已开启逐条用例分析，收到结果后继续分析。' : '当前仅等待整场任务结束，未开启逐条用例分析。'}待发送消息会在任务结束并完成分析后按顺序执行，也可点击立即引导。<button className="ml-3 underline" onClick={() => void perform(() => invoke('agent:stop', { id: session.id }))}>停止等待</button></div>}
          {session?.streaming && (session.streaming.content || session.streaming.reasoning) && <div className="space-y-3 text-sm leading-7 text-slate-700">
            {session.streaming.reasoning && <details open><summary className="cursor-pointer text-xs text-slate-500">模型返回的推理内容 · 正在生成</summary><div className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-500">{session.streaming.reasoning}</div></details>}
            {session.streaming.content && <AgentMarkdown>{session.streaming.content}</AgentMarkdown>}
            {session.streaming.stage==='incomplete' && <p className="text-xs text-amber-700">响应未完成，以上为未校验的部分内容，未执行其中的工具调用。</p>}
          </div>}
          {busy && <AgentRunStatus>{session?.contextState?.phase === 'compacting' ? <CompactionStatus state={session.contextState}/> : session?.streaming?.stage==='queued' ? '等待同一模型请求队列…' : sending ? '正在提交消息…' : session?.streaming?.stage==='waiting' ? `${session.retry ? modelRetryText(session.retry)+' ' : ''}等待模型首个有效输出… ${responseWaitSeconds}s${responseWaitSeconds >= 15 ? '（尚未收到有效内容，可停止）' : ''}` : session?.streaming?.toolCallCount ? '正在生成工具调用…' : session?.streaming?.stage==='receiving' ? '正在生成…' : '正在执行…'}</AgentRunStatus>}
          {busy && session?.retry && session.retry.phase !== 'requesting' && <RetryCountdown retry={session.retry} />}
          {(error || session?.error) && <div role="alert" className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error || session?.error}<MessageFooter message={{role:'assistant',content:[error || session?.error, session?.updatedAt ? `时间：${session.updatedAt}` : '', session?.errorDetails ? `错误诊断记录：\n${JSON.stringify(session.errorDetails, null, 2)}` : ''].filter(Boolean).join('\n\n'),createdAt:session?.updatedAt}} />{ !!session?.errorDetails && <details className="mt-2 text-xs text-slate-600"><summary className="cursor-pointer">查看错误诊断记录</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(session.errorDetails, null, 2)}</pre></details>}</div>}

        </div>
      </div>
      {showJumpToBottom && <button type="button" aria-label="直达底部" title="直达底部" onClick={jumpToBottom} className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-slate-200 bg-white p-2 text-slate-700 shadow-md hover:bg-slate-50"><ArrowDown size={20} /></button>}
      </div>
      {!!session?.queuedMessages?.length && <div aria-label="待发送消息" className="mx-auto mt-2 w-[calc(100%_-_3rem)] max-w-3xl min-w-0 space-y-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">
        {session.queuedMessages.map(message => <AgentQueuedMessage key={`${session.id}:${message.id}`} message={message}
          update={patch=>perform(async()=>{const id=session.id;const r=await invoke('agent:edit-queued',{id,messageId:message.id,...patch});if(selected.current===id)setSession(r.session);})}
          remove={()=>perform(async()=>{const id=session.id;const r=await invoke('agent:delete-queued',{id,messageId:message.id});if(selected.current===id)setSession(r.session);})}
          steer={()=>perform(async()=>{const id=session.id;const r=await invoke('agent:steer-queued',{id,messageId:message.id});if(selected.current===id)setSession(r.session);})}/>) }
      </div>}
      {!!session?.pendingMessages?.length && <div role="status" className="mx-auto mt-2 w-[calc(100%_-_3rem)] max-w-3xl min-w-0 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">
        <span className="sr-only">正在应用引导，支持取消的命令正在中断；其他操作完成后继续。</span>
        {session.pendingMessages.map((message, index) => <p key={index} title="正在应用引导；当前操作结束后按此消息继续" className="flex items-center gap-2"><Loader2 size={12} className="shrink-0 animate-spin" /><span className="truncate">{message.content}</span></p>)}
      </div>}
      {session?.screenMode === 'virtual' && <div className="border-b border-slate-200 bg-blue-50 px-5 py-2 text-xs text-blue-800" role="status">
        后台屏幕 · {session.screenCleanup?.confirmed === true || virtualPreviews[session.id]?.state === 'closed' ? t("已结束", "Finished") : virtualPreviews[session.id]?.state === 'unavailable' ? t("画面暂未更新", "Waiting for a fresh frame") : virtualPreviews[session.id]?.state === 'active' ? `运行中（屏幕 ${virtualPreviews[session.id].displayId ?? '准备中'}）` : '等待设备画面'}
        {virtualPreviews[session.id]?.ocrState === 'unavailable' && ' · 手机 OCR 不可用，仅能使用无障碍节点'}
        {virtualPreviews[session.id]?.ocrState === 'degraded' && ' · 本次 OCR 未就绪，请重新观察'}
        {session.screenCleanup?.confirmed === false && (['running','awaiting_approval'].includes(session.status) ? ' · 会话结束后释放屏幕' : session.screenCleanup.ownerActive ? ' · 正在验收与清理' : <> · 清理未确认 <button className="ml-2 underline" onClick={() => void perform(async () => { setSession((await invoke('agent:virtual-cleanup', { id: session.id })).session); })}>重试清理</button></>)}
        {session.screenReport && <div className="mt-1">固定验收：{({passed:'通过',failed:t("失败", "Failed"),not_tested:'未测试'} as const)[session.screenReport.status]} {session.screenReport.reportPath ? <button className="ml-2 underline" onClick={() => void perform(() => invoke('agent:virtual-report', { id: session.id }))}>打开报告</button> : ' · 报告未生成'}</div>}
        {session.screenReport?.recoveryCleanupConfirmed && <div className="mt-1">恢复通道已确认清理；原报告保留中断时的待确认状态。</div>}
        {session.screenReport?.recoveryRecordRemovalFailed && <div className="mt-1">屏幕已清理，但本机加密恢复记录删除失败。<button className="ml-2 underline" onClick={() => void perform(async () => { setSession((await invoke('agent:virtual-forget-recovery', { id:session.id })).session); })}>重试删除恢复记录</button></div>}
        {virtualPreviews[session.id]?.image && <details className="mt-1"><summary className="cursor-pointer">{virtualPreviews[session.id].state === 'active' ? '查看副屏画面' : '查看最后一帧（画面未更新）'}</summary><img className="mt-2 max-h-52 rounded border border-slate-200" src={virtualPreviews[session.id].image} alt="当前任务后台屏幕的最近画面" /></details>}
      </div>}
      <AgentComposer value={text} onChange={setText} onSend={()=>void send()} disabled={!session} sending={sending} placeholder={t("例如：查一下已连接的眼镜，帮我跑一个用例并采集性能", "Example: Find my connected glasses, run a test case, and collect performance data")} formEvents={{onDragOver:e=>e.preventDefault(),onDrop:e=>{e.preventDefault();if(!sending)addFiles(Array.from(e.dataTransfer.files));},onPaste:e=>{const files=Array.from(e.clipboardData.files);if(files.length&&!sending){e.preventDefault();addFiles(files);}}}} before={<><div className="flex flex-wrap gap-2 mb-2">{attachments.map((f,i)=><AttachmentPreview key={i} file={f} disabled={sending} onRemove={()=>setAttachments(a=>a.filter((_,j)=>i!==j))} />)}</div><input type="file" multiple ref={fileInput} className="hidden" onChange={e=>{addFiles(Array.from(e.target.files || []));e.target.value='';}} /></>} footerLeft={<><button type="button" disabled={sending} aria-label={t("添加图片或文件", "Add images or files")} title={t("添加图片或文件", "Add images or files")} onClick={()=>fileInput.current?.click()} className="mr-1 rounded-lg p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-40"><Plus size={18} /></button><select aria-label="执行授权模式" title={t("仅对当前对话生效，可随时切回逐次确认", "Applies to this conversation. You can switch back to per-action confirmation at any time.")} value={session?.approvalMode || 'ask'} onChange={e => setApprovalMode(e.target.value)} className={`rounded-lg px-2 py-1 text-xs outline-none ${session?.approvalMode === 'auto' ? 'text-orange-600 bg-orange-50' : 'text-slate-600 hover:bg-slate-100'}`}><option value="ask">{t("逐次确认", "Ask before each action")}</option><option value="auto">{t("自动执行 · 当前对话", "Auto-run in this chat")}</option></select><span className="px-2 text-[11px] text-slate-400">{session?.status === 'awaiting_approval' ? '可直接发送修改要求，旧操作不会执行' : busy ? '发送到待发送队列，可点击立即引导' : t("Enter 发送 · Shift + Enter 换行", "Enter to send · Shift + Enter for a new line")}</span></>} footerRight={<><select aria-label="选择对话模型" value={modelId} disabled={busy || selectingModel} onChange={e => void chooseModel(e.target.value)} className="max-w-[240px] min-w-0 rounded-lg bg-transparent px-2 py-1.5 text-xs text-slate-600 outline-none hover:bg-slate-100 disabled:opacity-50">{!models.length && <option value="">{t("暂无模型", "No model configured")}</option>}{modelOptions(models).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select><button type="button" onClick={()=>setRequestSettings(true)} aria-label={t("模型请求与流式对照", "Model Requests and Streaming Comparison")} title={t("模型请求与流式对照", "Model Requests and Streaming Comparison")} className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">{t("请求设置", "Request settings")}</button><button type="button" onClick={() => onNavigate('settings')} aria-label={t("管理模型配置", "Manage models")} title={t("管理模型配置", "Manage models")} className="text-slate-400 hover:text-slate-700"><Settings2 size={14} /></button>{busy && <button type="button" onClick={() => void perform(() => invoke('agent:stop', { id: session?.id }))} aria-label="停止对话" className="rounded-xl bg-slate-900 text-white p-2"><Square size={16} /></button>}{!sending && (!busy || text.trim() || attachments.length > 0) && <button disabled={sending || (!text.trim() && !attachments.length) || !session || selectingModel} aria-label={busy ? "发送补充要求" : "发送"} className="rounded-xl bg-slate-900 text-white p-2 disabled:opacity-30"><ArrowUp size={17} /></button>}</>}/>

        </section>
      </div>
    </div>
    {requestSettings && <AgentRequestSettings id={session?.id} busy={busy} onClose={()=>setRequestSettings(false)}/>}
    {extensions && <AgentExtensions invoke={invoke} onClose={() => setExtensions(false)} />}
  </div></Profiler>;
}
