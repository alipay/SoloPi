import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import type { TaskActionFeedback } from '../hooks/use-task-action-feedback';
export default function TaskActionNotice({ feedback, onOpenTask }: { feedback?: TaskActionFeedback; onOpenTask: (id: string) => void }) {
  if (!feedback) return null;
  const { phase, message, taskId } = feedback;
  const Icon = phase === 'error' ? AlertTriangle : phase === 'pending' ? Loader2 : CheckCircle2;
  return <div role={phase === 'error' ? 'alert' : 'status'} aria-live="polite" className={`mt-2 flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${phase === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700' : phase === 'accepted' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-blue-200 bg-blue-50 text-blue-700'}`}>
    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${phase === 'pending' ? 'animate-spin' : ''}`} />
    <span className="min-w-0 flex-1 break-words">{message}</span>
    {phase === 'accepted' && taskId && <button type="button" className="shrink-0 rounded-md border border-emerald-200 bg-white px-2 py-1 font-bold hover:bg-emerald-100" onClick={() => onOpenTask(taskId)}>查看新任务</button>}
  </div>;
}
