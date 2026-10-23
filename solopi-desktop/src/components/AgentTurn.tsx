import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, Copy, ChevronRight, Loader2 } from 'lucide-react';
import AgentMarkdown from './AgentMarkdown';
import { agentTurns, turnTimeline, type AgentMessage, type AgentCall } from './agent-turns';
export function MessageFooter({message,alignRight=false}:{message:AgentMessage;alignRight?:boolean}) {
 const [copied,setCopied]=useState(false);
 return <div className={`mt-1 flex items-center gap-2 text-[11px] text-slate-400 ${alignRight ? 'justify-end' : ''}`}>
  <time dateTime={message.createdAt} title={message.createdAt}>{message.createdAt ? new Date(message.createdAt).toLocaleString('zh-CN',{hour12:false}) : '时间未记录'}</time>
  <button type="button" aria-label="复制消息" title={copied ? '已复制' : '复制消息'} className="rounded p-1 hover:bg-slate-100" onClick={()=>void navigator.clipboard.writeText(message.content || message.reasoning_content || '').then(()=>setCopied(true)).catch(()=>setCopied(false))}>{copied ? <Check size={13}/> : <Copy size={13}/>}</button>
 </div>;
}
export default function AgentTurn({ sessionId, turn, labels, latestReasoning, reasoningRevision }: { sessionId: string; turn: ReturnType<typeof agentTurns>[number]; labels: Record<string, string>; latestReasoning?: AgentMessage; reasoningRevision: number }) {
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{if(!turn.active)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[turn.active]);
  const start=Date.parse(turn.user?.createdAt || '');
  const end=turn.active ? now : Date.parse(turn.messages.at(-1)?.createdAt || '');
  const seconds=Number.isFinite(start) && Number.isFinite(end) ? Math.max(0,Math.floor((end-start)/1000)) : null;
  const elapsed=seconds===null ? '处理耗时未记录' : `处理耗时${Math.floor(seconds/60)}m ${seconds%60}s`;
  const [expanded, setExpanded] = useState(turn.active);
  useEffect(() => setExpanded(turn.active), [turn.active]);
  const [visibleSteps, setVisibleSteps] = useState(30);
  const process = expanded ? turnTimeline(turn) : [];
  const processViewport = useRef<HTMLDivElement>(null);
  const revision = [turn.messages.map(m=>[m.content?.length,m.reasoning_content?.length].join(',')).join(';'), turn.calls.length, turn.calls.at(-1)?.status].join(':');
  useLayoutEffect(() => {
    const viewport = processViewport.current;
    if (expanded && viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [revision, expanded]);
  const hasProcess = turn.calls.length > 0 || turn.messages.some(m => (m !== turn.final && m.content) || m.reasoning_content);
  return <div className="space-y-5">
    {turn.user?.content && <div className="flex flex-col items-end"><div className="max-w-[85%] rounded-2xl bg-slate-200/70 px-5 py-3 text-sm whitespace-pre-wrap break-words">{turn.user.content}{turn.user.attachments?.map(a => <div key={a.id} className="mt-2 rounded-lg border border-slate-300 px-3 py-2 text-xs">{a.mime.startsWith('image/') ? '图片' : '文件'} · {a.name} · {Math.ceil(a.size/1024)} KB</div>)}</div><MessageFooter message={turn.user} alignRight /></div>}
    {hasProcess && <div className="text-sm text-slate-500">
      <button aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className="flex items-center gap-2 py-2 hover:text-slate-800">
        {turn.active ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} className={expanded ? 'rotate-90' : ''} />}
        {elapsed}{turn.calls.length ? ` · ${turn.calls.length} 次工具调用` : ''}
      </button>
      {expanded && <div ref={processViewport} aria-label="执行过程时间线" className="max-h-[45vh] overflow-y-auto space-y-3 border-l-2 border-slate-200 pl-4 mt-2">
        {process.length > visibleSteps && <button onClick={()=>setVisibleSteps(n=>n+30)}>加载更早的执行步骤</button>}
        {process.slice(-visibleSteps).map(({ message: m, calls, index }) => <div key={index} className="space-y-2">
          {m.reasoning_content && <details key={`${reasoningRevision}-${index}`} open={m === latestReasoning}><summary className="cursor-pointer text-xs">模型返回的推理内容</summary><div className="text-xs leading-6 whitespace-pre-wrap break-words mt-2">{m.reasoning_content}</div></details>}
          {m !== turn.final && m.content && <div><AgentMarkdown>{m.content}</AgentMarkdown><MessageFooter message={m}/></div>}
        {calls.map(c => <CallDetails sessionId={sessionId} key={c.id} call={c} label={labels[c.name] || c.name} />)}
        </div>)}
      </div>}
    </div>}
    {turn.final?.content && <div className="text-sm leading-7 text-slate-700 min-w-0"><AgentMarkdown>{turn.final.content}</AgentMarkdown><MessageFooter message={turn.final}/></div>}
  </div>;
}

function CallDetails({sessionId,call:c,label}:{sessionId:string;call:ReturnType<typeof agentTurns>[number]['calls'][number];label:string}) {
  const [open,setOpen]=useState(false);
  const [details,setDetails]=useState<{parameters:unknown;result:unknown}|null>(null),[error,setError]=useState('');
  useEffect(()=>{
    if(!open || !c.detailsAvailable)return;
    let live=true;setDetails(null);setError('');
    const api=window.glassbox?.ipcRenderer;
    if(!api){setError('桌面接口不可用');return;}
    void api.invoke('agent:call-details',{id:sessionId,callId:c.id}).then((r:{call?:AgentCall;error?:string})=>{
      if(!live)return;if(!r.call)throw Error(r.error || '读取调用详情失败');setDetails({parameters:r.call.args,result:r.call.result});
    }).catch((e:Error)=>{if(live)setError(e.message);});
    return()=>{live=false;setDetails(null);};
  },[open,sessionId,c.id,c.status,c.detailsAvailable]);
  return <details onToggle={event=>setOpen(event.currentTarget.open)} className="rounded-lg border border-slate-200 bg-white text-xs">
    <summary className="cursor-pointer px-3 py-2">{label}<span className={`float-right font-medium ${c.status === 'failed' ? 'text-red-600' : c.status === 'done' ? 'text-emerald-600' : 'text-slate-400'}`}>{({pending:'待确认',running:'执行中',done:(c.result as {successScope?:string})?.successScope==='process'?'✅ 进程完成':'✅ 已完成',failed:'❌ 失败',cancelled:'已取消'} as Record<string,string>)[c.status] || c.status}</span></summary>
    {open && <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all border-t border-slate-100 p-3">{error || (c.detailsAvailable ? details ? JSON.stringify(details,null,2) : '加载原始调用详情…' : JSON.stringify({parameters:c.args,result:c.result},null,2))}</pre>}
  </details>;
}
