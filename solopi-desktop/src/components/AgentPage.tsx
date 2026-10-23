import { chatScrollMetrics, chatScrollUpdate, type ChatScrollMetrics } from './agent-chat-scroll';
import AgentQueuedMessage from './AgentQueuedMessage';
import { agentDrafts, useAgentDraft } from './agent-drafts';
import AgentExtensions from './AgentExtensions';
import AgentRequestSettings from './AgentRequestSettings';
import AgentMarkdown from './AgentMarkdown';
import AgentTurn, { MessageFooter } from './AgentTurn';
import { agentTurns, modelOptions, type AgentModel, type AgentMessage, type AgentCall } from './agent-turns';
import AgentOperationSummary from './AgentOperationSummary';
import { Profiler, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, X, ArrowUp, Loader2, MessageSquare, PanelLeftClose, PanelLeftOpen, Plus, Settings2, Square } from 'lucide-react';

type Message = AgentMessage;
type Call = AgentCall;
type Session = { id: string; title: string; status: string; updatedAt?: string; messages: Message[]; pendingMessages?: Message[]; queuedMessages?: (Message & { id: string; rawText?: string; editing?:boolean })[]; calls: Call[]; error?: string; contextState?: { phase: string; batchStartedAt?:number; startedAt?:number; outputCharacters?:number; reasoningCharacters?:number; currentChunk?: number; totalChunks?: number; attempt?: number; beforeTokensEstimate?: number; afterTokensEstimate?: number; message?: string }; errorDetails?: unknown; streaming?: {content:string;reasoning:string;toolCallCount:number;stage:string;createdAt:string} | null; retry?: {attempt:number;maxAttempts:number;retryAt:number;reason?:string} | null; watch?: { kind: string; id: string; reviewCases?: boolean }; approvalMode?: 'ask' | 'auto' };
type Summary = Pick<Session, 'id' | 'title' | 'status'>;
const suggestions = ['查看已连接设备和可用用例', '帮我编写一个测试用例', '运行用例并采集性能和电池温度', '分析设备耗电情况'];
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
function RetryCountdown({retry}:{retry:{attempt:number;maxAttempts:number;retryAt:number;reason?:string}}) {
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),250);return()=>clearInterval(timer);},[]);
 const labels:Record<string,string>={'connect-timeout':'模型连接未建立','first-response-timeout':'等待模型首响应超时','rate-limit':'模型限流','transport-error':'模型连接中断','server-error':'模型服务暂时异常','model-timeout':'模型响应超时','empty-response':'模型返回空响应','incomplete-response':'模型响应不完整'};
 return <div role="status" className="text-sm text-amber-700">{labels[retry.reason || 'rate-limit'] || '模型请求暂时失败'}，{Math.max(0,Math.ceil((retry.retryAt-now)/1000))} 秒后重试（{retry.attempt}/{retry.maxAttempts}），可点击停止取消</div>;
}
function CompactionStatus({state}:{state:{currentChunk?:number;totalChunks?:number;batchStartedAt?:number;outputCharacters?:number;reasoningCharacters?:number}}){
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  return <span>压缩历史 · {state.currentChunk || 1}/{state.totalChunks || 1} 批 · 本批耗时 {Math.max(0,Math.floor((now-(state.batchStartedAt || now))/1000))}s · 摘要 {state.outputCharacters || 0} 字{state.reasoningCharacters ? ` · 推理 ${state.reasoningCharacters} 字` : ''}</span>;
}
export default function AgentPage({ onNavigate, deviceControls, initialSessionId, onSessionChange }: { onNavigate: (tab: string) => void; deviceControls: ReactNode; initialSessionId: string; onSessionChange: (id: string) => void }) {
  const api = window.glassbox?.ipcRenderer;
  const [sessions, setSessions] = useState<Summary[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [models, setModels] = useState<AgentModel[]>([]);
  const [modelId, setModelId] = useState('');
  const [selectingModel, setSelectingModel] = useState(false);
  const { text, setText, attachments, setAttachments, sending } = useAgentDraft(session?.id || initialSessionId);
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
  const selected = useRef('');
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
  const refresh = useCallback(async () => setSessions((await invoke('agent:list')).sessions), [invoke]);
  const select = async (id: string) => { selected.current = id; setSession((await invoke('agent:get', { id })).session); };
  const create = async () => { const r = await invoke('agent:create'); selected.current = r.session.id; setSession(r.session); await refresh(); };
  useEffect(() => {
    let live = true;
    void invoke('agent:list').then(async r => {
      if (!live) return; setSessions(r.sessions);
      const id = r.sessions.find((s: Summary) => s.id === initialSessionId)?.id || r.sessions[0]?.id;
      const current = id ? await invoke('agent:get', { id }) : await invoke('agent:create');
      if (live) { selected.current = current.session.id; setSession(current.session); }
    }).catch(e => { if (live) setError(e.message); });
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
    api?.on('agent:changed', changed);
    return () => { live = false; clearInterval(performanceTimer); api?.removeListener('agent:changed', changed); };
  }, [api, invoke, refresh]);
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
    const id = session.id, draft = agentDrafts.beginSend(id);
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
  const pending = session?.calls.find(c => c.status === 'pending');
  return <Profiler id="agent" onRender={profileRender}><div className="flex flex-1 min-h-0 min-w-0 bg-[#fafaf8]">
    <div className="flex flex-1 min-w-0 min-h-0 flex-col">
      <div className="relative shrink-0 bg-white" aria-label="设备与快捷操作">{deviceControls}</div>
      <div className="flex flex-1 min-w-0 min-h-0">
        <aside aria-label="会话列表" className={`${sessionsCollapsed ? 'w-12 p-2' : 'w-48 p-4 max-lg:w-40'} shrink-0 border-r border-slate-200/70 flex flex-col gap-4 min-h-0`}>
          <button type="button" aria-label={sessionsCollapsed ? '展开会话列表' : '收起会话列表'} title={sessionsCollapsed ? '展开会话列表' : '收起会话列表'} aria-expanded={!sessionsCollapsed} onClick={() => setSessionsCollapsed(value => !value)} className="self-start rounded-lg p-1.5 text-slate-500 hover:bg-slate-200/70">{sessionsCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button>
          <button aria-label="新对话" title="新对话" onClick={() => void perform(create)} className={`flex items-center justify-center gap-2 rounded-xl text-sm hover:bg-slate-100 ${sessionsCollapsed ? 'p-1.5' : 'border border-slate-200 bg-white px-3 py-2.5'}`}><Plus size={16} />{!sessionsCollapsed && '新对话'}</button>
          <div className="flex-1 min-h-0 overflow-auto space-y-1">{!sessionsCollapsed && sessions.map(s => <button key={s.id} onClick={() => void perform(() => select(s.id))} className={`w-full truncate text-left rounded-lg px-3 py-2 text-xs ${s.id === session?.id ? 'bg-slate-200/70 text-slate-900' : 'text-slate-500 hover:bg-slate-100'}`} title={s.title}>{s.title}</button>)}</div>
          <button aria-label="MCP 与 Skills" title="MCP 与 Skills" onClick={() => setExtensions(true)} className="flex gap-2 items-center text-xs text-slate-500"><Settings2 size={14} />{!sessionsCollapsed && 'MCP 与 Skills'}</button>
        </aside>
        <section className="flex flex-1 min-w-0 min-h-0 flex-col">
      <header className="shrink-0 flex items-center justify-between px-7 py-5 border-b border-slate-200/60"><div className="flex gap-3 items-center"><MessageSquare size={19} /><span className="font-semibold text-slate-800">solopi-desktop Agent</span><span className="text-[10px] tracking-wider text-slate-400 border border-slate-200 rounded px-1.5 py-0.5">EXPERIMENT</span></div><button onClick={() => onNavigate('automation-tasks')} className="text-xs text-slate-500 hover:text-blue-600">查看测试任务 →</button></header>
      <div className="relative flex-1 min-h-0">
      <div ref={chatViewport} onScroll={onChatScroll}
        onWheel={event=>{if(event.deltaY<0)followOutput.current=false;}}
        onTouchStart={event=>{touchY.current=event.touches[0]?.clientY ?? null;}}
        onTouchMove={event=>{const y=event.touches[0]?.clientY;if(y!==undefined && touchY.current!==null && y>touchY.current)followOutput.current=false;touchY.current=y ?? null;}}
        onTouchEnd={()=>{touchY.current=null;}}
        onPointerDown={event=>{if(event.target===event.currentTarget)followOutput.current=false;}}
        onKeyDown={event=>{if(['ArrowUp','PageUp','Home'].includes(event.key))followOutput.current=false;}}
        className="h-full overflow-y-auto px-6 py-8">
        <div ref={chatContent} className="mx-auto max-w-3xl space-y-6">
          {!session?.messages.length && <div className="pt-[8vh] pb-8"><div className="text-[11px] tracking-[0.2em] text-slate-400 mb-4">从一个问题开始</div><h1 className="text-3xl font-semibold tracking-tight text-slate-900 mb-3">今天想测什么？</h1><p className="text-sm text-slate-500 mb-8">描述目标，我来查询设备、准备配置和执行测试。</p><div className="grid grid-cols-2 gap-3">{suggestions.map(s => <button key={s} onClick={() => setText(s)} className="rounded-xl border border-slate-200 bg-white p-4 text-left text-sm text-slate-600 hover:border-blue-300 hover:text-blue-600 transition-colors">{s}<span className="block mt-3 text-slate-300">↗</span></button>)}</div></div>}
          {turns.length > visibleTurns && <button onClick={()=>setVisibleTurns(n=>n+20)} className="text-sm text-blue-600">加载更早的对话</button>}
          {session && turns.slice(-visibleTurns).map(turn => <AgentTurn sessionId={session.id} key={`${session.id}-${turn.start}`} turn={turn} labels={labels} latestReasoning={session.messages[latestReasoningIndex]} reasoningRevision={latestReasoningIndex} />)}
          {session?.status === 'awaiting_approval' && pending && <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4"><div className="text-sm font-semibold mb-3">确认执行：{labels[pending.name] || pending.name}</div><AgentOperationSummary args={pending.args} /><div className="flex gap-2">{[true,false].map(allow => <button key={String(allow)} onClick={() => void perform(async () => setSession((await invoke('agent:approve', { id: session.id, callId: pending.id, allow })).session))} className={`rounded-lg px-4 py-2 text-xs ${allow ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200'}`}>{allow ? '执行' : '取消此操作'}</button>)}<button onClick={() => setApprovalMode('auto')} className="rounded-lg px-4 py-2 text-xs border border-blue-300 text-blue-700 bg-white">授权并自动执行</button></div></div>}
          {session?.status === 'waiting' && <div role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-700">后台任务进行中，{session.watch?.reviewCases ? '已开启逐条用例分析，收到结果后继续分析。' : '当前仅等待整场任务结束，未开启逐条用例分析。'}待发送消息会在任务结束并完成分析后按顺序执行，也可点击立即引导。<button className="ml-3 underline" onClick={() => void perform(() => invoke('agent:stop', { id: session.id }))}>停止等待</button></div>}
          {session?.streaming && (session.streaming.content || session.streaming.reasoning) && <div className="space-y-3 text-sm leading-7 text-slate-700">
            {session.streaming.reasoning && <details open><summary className="cursor-pointer text-xs text-slate-500">模型返回的推理内容 · 正在生成</summary><div className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-500">{session.streaming.reasoning}</div></details>}
            {session.streaming.content && <AgentMarkdown>{session.streaming.content}</AgentMarkdown>}
            {session.streaming.stage==='incomplete' && <p className="text-xs text-amber-700">响应未完成，以上为未校验的部分内容，未执行其中的工具调用。</p>}
          </div>}
          {busy && <div role="status" className="flex gap-2 items-center text-xs text-slate-500"><Loader2 size={14} className="animate-spin" />{session?.contextState?.phase === 'compacting' ? <CompactionStatus state={session.contextState}/> : session?.streaming?.stage==='queued' ? '等待同一模型请求队列…' : session?.streaming?.stage==='waiting' ? '等待模型响应…' : session?.streaming?.toolCallCount ? '正在生成工具调用…' : session?.streaming?.stage==='receiving' ? '正在生成…' : '正在执行…'}</div>}
          {session?.retry && <RetryCountdown retry={session.retry} />}
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
      <form onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!sending) addFiles(Array.from(e.dataTransfer.files)); }} onPaste={e => { const files=Array.from(e.clipboardData.files); if(files.length && !sending) { e.preventDefault(); addFiles(files); } }} onSubmit={e => { e.preventDefault(); void send(); }} className="px-6 pb-5 pt-2"><div className="max-w-3xl mx-auto rounded-2xl border border-slate-300 bg-white shadow-sm p-3 focus-within:border-slate-500"><div className="flex flex-wrap gap-2 mb-2">{attachments.map((f,i)=><AttachmentPreview key={i} file={f} disabled={sending} onRemove={()=>setAttachments(a=>a.filter((_,j)=>i!==j))} />)}</div><input type="file" multiple ref={fileInput} className="hidden" onChange={e=>{addFiles(Array.from(e.target.files || []));e.target.value='';}} /><textarea disabled={!session} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!sending) void send(); } }} rows={2} maxLength={16000} placeholder="例如：查一下已连接的眼镜，帮我跑一个用例并采集性能" aria-label="发送给 Agent 的消息" className="w-full resize-none bg-transparent px-2 py-1 text-sm outline-none" /><div className="flex justify-between items-center"><div className="min-w-0 flex items-center"><button type="button" disabled={sending} aria-label="添加图片或文件" title="添加图片或文件" onClick={()=>fileInput.current?.click()} className="mr-1 rounded-lg p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-40"><Plus size={18} /></button><select aria-label="执行授权模式" title="仅对当前对话生效，可随时切回逐次确认" value={session?.approvalMode || 'ask'} onChange={e => setApprovalMode(e.target.value)} className={`rounded-lg px-2 py-1 text-xs outline-none ${session?.approvalMode === 'auto' ? 'text-orange-600 bg-orange-50' : 'text-slate-600 hover:bg-slate-100'}`}><option value="ask">逐次确认</option><option value="auto">自动执行 · 当前对话</option></select><span className="px-2 text-[11px] text-slate-400">{session?.status === 'awaiting_approval' ? '可直接发送修改要求，旧操作不会执行' : busy ? '发送到待发送队列，可点击立即引导' : 'Enter 发送 · Shift + Enter 换行'}</span></div><div className="flex items-center gap-2 min-w-0 ml-2"><select aria-label="选择对话模型" value={modelId} disabled={busy || selectingModel} onChange={e => void chooseModel(e.target.value)} className="max-w-[240px] min-w-0 rounded-lg bg-transparent px-2 py-1.5 text-xs text-slate-600 outline-none hover:bg-slate-100 disabled:opacity-50">{!models.length && <option value="">暂无模型</option>}{modelOptions(models).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select><button type="button" onClick={() => setRequestSettings(true)} aria-label="模型请求与流式对照" title="模型请求与流式对照" className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">请求设置</button><button type="button" onClick={() => onNavigate('settings')} aria-label="管理模型配置" title="管理模型配置" className="text-slate-400 hover:text-slate-700"><Settings2 size={14} /></button>{busy && <button type="button" onClick={() => void perform(() => invoke('agent:stop', { id: session?.id }))} aria-label="停止对话" className="rounded-xl bg-slate-900 text-white p-2"><Square size={16} /></button>}{(!busy || text.trim() || attachments.length > 0) && <button disabled={sending || (!text.trim() && !attachments.length) || !session || selectingModel} aria-label={busy ? "发送补充要求" : "发送"} className="rounded-xl bg-slate-900 text-white p-2 disabled:opacity-30"><ArrowUp size={17} /></button>}</div></div></div></form>
        </section>
      </div>
    </div>
    {requestSettings && <AgentRequestSettings id={session?.id} busy={busy} onClose={() => setRequestSettings(false)} />}
    {extensions && <AgentExtensions invoke={invoke} onClose={() => setExtensions(false)} />}
  </div></Profiler>;
}
