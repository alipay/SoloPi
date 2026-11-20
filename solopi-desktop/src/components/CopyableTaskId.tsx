import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';

export default function CopyableTaskId({ taskId }: { taskId: string }) {
  const [feedback, setFeedback] = useState('');
  useEffect(() => { setFeedback(''); }, [taskId]);
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1 text-xs font-bold text-slate-400">
      <span className="shrink-0">任务 ID</span>
      <span className="min-w-0 select-text truncate font-mono" title={taskId}>{taskId}</span>
      <button
        type="button"
        aria-label="复制任务 ID"
        title={feedback || '复制任务 ID'}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-blue-50 hover:text-blue-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
        onClick={async event => {
          event.stopPropagation();
          try {
            await navigator.clipboard.writeText(taskId);
            setFeedback('已复制任务 ID');
          } catch {
            setFeedback('复制失败，请选中任务 ID 手动复制');
          }
        }}
      >
        {feedback === '已复制任务 ID' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <span role="status" className="sr-only">{feedback}</span>
    </span>
  );
}
