import type {ReactNode,FormHTMLAttributes} from 'react';
import {Loader2,PanelLeftClose,PanelLeftOpen,Plus,MessageSquare} from 'lucide-react';

/** Shared presentation only. Desktop IPC and Server HTTP stay in their hosts. */
export function AgentRunStatus({children}:{children:ReactNode}){
 return <div role="status" className="flex gap-2 items-center text-xs text-slate-500"><Loader2 size={14} className="animate-spin"/>{children}</div>;
}
export function modelRetryText({reason,attempt,maxAttempts}:{reason?:string;attempt?:number;maxAttempts?:number}){
 const count=typeof attempt==='number'&&Number.isInteger(attempt)&&attempt>0 ? `第 ${attempt}${typeof maxAttempts==='number'&&Number.isInteger(maxAttempts)&&maxAttempts>0?'/'+maxAttempts:''} 次重试` : '重试';
 return `模型请求失败${reason?`（${reason}）`:''}，正在等待${count}…`;
}
export function AgentSessionList({items,selected,collapsed,onCollapse,onCreate,onSelect,loading=false,createDisabled=false,error,onRetry,footer}:{
 items:{id:string;title:string;executionStatus?:string|null}[];selected?:string;collapsed:boolean;onCollapse:()=>void;onCreate:()=>void;onSelect:(id:string)=>void;
 loading?:boolean;createDisabled?:boolean;error?:string;onRetry?:()=>void;footer?:ReactNode;
}){
 return <aside aria-label="会话列表" aria-busy={loading} className={`${collapsed?'w-12 p-2':'w-48 p-4 max-lg:w-40'} shrink-0 border-r border-slate-200/70 flex flex-col gap-4 min-h-0`}>
  <button type="button" aria-label={collapsed?'展开会话列表':'收起会话列表'} title={collapsed?'展开会话列表':'收起会话列表'} aria-expanded={!collapsed} onClick={onCollapse} className="self-start rounded-lg p-1.5 text-slate-500 hover:bg-slate-200/70">{collapsed?<PanelLeftOpen size={17}/>:<PanelLeftClose size={17}/>}</button>
  <button type="button" disabled={loading||createDisabled} aria-label="新对话" title="新对话" onClick={onCreate} className={`flex items-center justify-center gap-2 rounded-xl text-sm hover:bg-slate-100 disabled:opacity-40 ${collapsed?'p-1.5':'border border-slate-200 bg-white px-3 py-2.5'}`}><Plus size={16}/>{!collapsed&&'新对话'}</button>
  <div className="flex-1 min-h-0 overflow-auto space-y-1">
   {loading&&<div role="status" className="px-2 py-3 text-xs text-slate-500"><Loader2 size={14} className="inline-block animate-spin mr-2"/><span className={collapsed?'sr-only':''}>正在加载对话列表…</span></div>}
   {error&&<div role="alert" className="text-xs text-red-600 px-2 py-3">{!collapsed&&<p>对话列表加载失败</p>}<button type="button" aria-label="重新加载对话列表" onClick={onRetry} className="underline mt-2">重试</button></div>}
   {!loading&&!error&&!collapsed&&!items.length&&<p className="px-3 py-2 text-xs text-slate-400">暂无对话</p>}
   {!loading&&!collapsed&&items.map(s=><button type="button" key={s.id} aria-current={selected===s.id?'page':undefined} onClick={()=>onSelect(s.id)} title={s.title} className={`w-full flex items-center gap-2 text-left rounded-lg px-3 py-2 text-xs ${selected===s.id?'bg-slate-200/70 text-slate-900':'text-slate-500 hover:bg-slate-100'}`}><span className="min-w-0 flex-1 truncate">{s.title}</span>{['queued','running','waiting'].includes(s.executionStatus||'')&&<span role="img" aria-label={s.executionStatus==='queued'?'等待处理':s.executionStatus==='waiting'?'等待任务结果':'正在执行'} title={s.executionStatus==='queued'?'等待处理':s.executionStatus==='waiting'?'等待任务结果':'正在执行'} className="shrink-0 text-blue-600"><Loader2 size={13} aria-hidden="true" className="motion-safe:animate-spin"/></span>}</button>)}
  </div>{footer}
 </aside>;
}
export function AgentChatHeader({title,children}:{title:string;children?:ReactNode}){
 return <header className="shrink-0 flex flex-wrap gap-3 items-center justify-between px-7 py-5 border-b border-slate-200/60"><div className="flex gap-3 items-center min-w-0"><MessageSquare size={19}/><span className="font-semibold text-slate-800">{title}</span></div>{children}</header>;
}
export function AgentComposer({value,onChange,onSend,disabled=false,sending=false,placeholder,label='发送给 Agent 的消息',before,footerLeft,footerRight,maxLength=16000,formEvents}:{
 value:string;onChange:(value:string)=>void;onSend:()=>void;disabled?:boolean;sending?:boolean;placeholder:string;label?:string;
 before?:ReactNode;footerLeft?:ReactNode;footerRight?:ReactNode;maxLength?:number;formEvents?:Pick<FormHTMLAttributes<HTMLFormElement>,'onDragOver'|'onDrop'|'onPaste'>;
}){
 return <form {...formEvents} onSubmit={e=>{e.preventDefault();if(!disabled&&!sending)onSend();}} className="px-6 pb-5 pt-2"><div className="max-w-3xl mx-auto rounded-2xl border border-slate-300 bg-white shadow-sm p-3 focus-within:border-slate-500">
  {before}<textarea disabled={disabled} value={value} onChange={e=>onChange(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&e.keyCode!==229){e.preventDefault();if(!disabled&&!sending)onSend();}}} rows={2} maxLength={maxLength} placeholder={placeholder} aria-label={label} className="w-full resize-none bg-transparent px-2 py-1 text-sm outline-none"/>
  <div className="flex flex-wrap gap-y-2 justify-between items-center"><div className="min-w-0 flex flex-wrap items-center">{footerLeft}</div><div className="flex items-center gap-2 min-w-0 ml-2">{footerRight}</div></div>
 </div></form>;
}
