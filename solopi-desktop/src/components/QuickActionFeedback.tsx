import { CheckCircle2, ChevronDown, ChevronUp, FolderOpen, Loader2, X, XCircle } from 'lucide-react';
import { useState } from 'react';

export interface QuickActionResult { type: 'success' | 'error'; message: string; outputDir?: string; title?: string }
export function QuickActionFeedback({ feedback, busy, sessions, onDismiss, onOpenDirectory }: {
  feedback: QuickActionResult | null; busy: string; sessions: { id: string; name: string; status: string }[];
  onDismiss: () => void; onOpenDirectory: (path: string) => void;
}) {
  const [minimized, setMinimized] = useState(false);
  if (!feedback && !busy && sessions.length === 0) return null;
  return <aside aria-label="快捷操作状态与结果" className="fixed right-4 top-24 z-[140] w-[360px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
      <span className="flex min-w-0 items-center gap-2 text-xs font-bold text-slate-800">{busy && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600" />}快捷操作{busy ? ' · 执行中' : feedback?.type === 'error' ? ' · 执行失败' : feedback ? ' · 执行结果' : ' · 运行状态'}</span>
      <div className="flex shrink-0 gap-2"><button type="button" aria-label={minimized ? '展开执行状态' : '收起执行状态'} onClick={() => setMinimized(!minimized)} className="text-slate-400 hover:text-slate-700">{minimized ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}</button>{feedback && <button type="button" aria-label="关闭执行结果" onClick={onDismiss} className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>}</div>
    </div>
    <div className={minimized ? 'sr-only' : 'max-h-[50vh] space-y-3 overflow-y-auto p-4'}>
      {busy && <p role="status" className="break-words text-xs font-bold text-blue-600">{busy}</p>}
      {sessions.map((item) => <div key={item.id} className="rounded-xl bg-blue-50 px-3 py-2 text-xs"><div className="truncate font-bold text-slate-800" title={item.name}>{item.name}</div><div role="status" className="mt-1 text-blue-600">{item.status}</div></div>)}
      {feedback && <div role={feedback.type === 'error' ? 'alert' : 'status'} className={`rounded-xl p-3 text-xs ${feedback.type === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
        <div className="mb-2 flex items-center gap-2 font-bold">{feedback.type === 'error' ? <XCircle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}<span className="min-w-0 truncate">{feedback.title || (feedback.type === 'error' ? '操作失败' : '操作完成')}</span></div>
        <p className="whitespace-pre-wrap break-words leading-5">{feedback.message}</p>
        {feedback.outputDir && !minimized && <button type="button" className="mt-3 inline-flex items-center gap-1 font-bold underline" onClick={() => onOpenDirectory(feedback.outputDir!)}><FolderOpen className="h-3.5 w-3.5" />打开目录</button>}
      </div>}
    </div>
  </aside>;
}
