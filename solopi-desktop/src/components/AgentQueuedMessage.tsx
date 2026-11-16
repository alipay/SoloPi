import { useState } from 'react';
import { CornerDownLeft, Pencil, Trash2 } from 'lucide-react';
export type QueuedMessage = { id:string; rawText?:string; content?:string | null; editing?:boolean };
export default function AgentQueuedMessage({message, update, remove, steer}:{message:QueuedMessage;update:(patch:{text?:string;editing:boolean})=>Promise<void>;remove:()=>Promise<void>;steer:()=>Promise<void>}) {
  const [draft,setDraft]=useState(message.rawText ?? message.content ?? '');
  const [busy,setBusy]=useState(false);
  const run=async(action:()=>Promise<void>)=>{if(busy)return;setBusy(true);try{await action();}finally{setBusy(false);}};
  const icon='shrink-0 rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-40';
  return <div className="min-w-0 space-y-2">
    {message.editing ? <>
      <textarea aria-label="编辑待发送消息" value={draft} maxLength={16000} onChange={e=>setDraft(e.target.value)} disabled={busy} className="min-h-20 w-full resize-y rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200" />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || !draft.trim()} onClick={()=>void run(()=>update({text:draft,editing:false}))} className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-40">保存修改</button>
        <button type="button" disabled={busy} onClick={()=>void run(()=>update({editing:false}))} className="rounded px-3 py-1 hover:bg-slate-100">取消编辑</button>
        <button type="button" disabled={busy} onClick={()=>void run(remove)} aria-label="删除待发送消息" title="删除" className={icon+' hover:text-red-600'}><Trash2 size={14}/></button>
        <span className="text-slate-400">编辑期间暂不发送此消息</span>
      </div>
    </> : <div className="flex items-center gap-2">
      <p title={message.rawText ?? message.content ?? undefined} className="min-w-0 flex-1 truncate">{message.rawText ?? message.content}</p>
      <button type="button" disabled={busy} onClick={()=>void run(async()=>{setDraft(message.rawText ?? message.content ?? '');await update({editing:true});})} aria-label="重新编辑待发送消息" title="重新编辑" className={icon+' hover:text-blue-600'}><Pencil size={14}/></button>
      <button type="button" disabled={busy} onClick={()=>void run(remove)} aria-label="删除待发送消息" title="删除" className={icon+' hover:text-red-600'}><Trash2 size={14}/></button>
      <button type="button" disabled={busy} onClick={()=>void run(steer)} aria-label="立即引导" title="立即引导" className={icon+' hover:text-blue-600'}><CornerDownLeft size={14}/></button>
    </div>}
  </div>;
}
