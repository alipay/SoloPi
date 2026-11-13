import { useRef, useState } from 'react';
export type TaskActionResult = { success: boolean; taskId?: string; error?: string };
export type TaskActionFeedback = { phase: 'pending' | 'accepted' | 'error'; message: string; taskId?: string };
export function useTaskActionFeedback() {
  const pending = useRef(new Set<string>());
  const [pendingTaskActions, setPendingTaskActions] = useState<Set<string>>(new Set());
  const [taskActionFeedback, setTaskActionFeedback] = useState<Record<string, TaskActionFeedback>>({});
  const runTaskAction = async (sourceTaskId: string, label: string, execute: () => Promise<TaskActionResult>) => {
    // Ref protects rapid clicks before React has committed the disabled button.
    if (pending.current.has(sourceTaskId)) return;
    pending.current.add(sourceTaskId);
    setPendingTaskActions(new Set(pending.current));
    setTaskActionFeedback(current => ({ ...current, [sourceTaskId]: { phase: 'pending', message: `${label}：正在校验并提交，请稍候…` } }));
    try {
      const result = await execute();
      if (!result.success || !result.taskId) throw Error(result.error || '未收到新任务的提交回执，请核对任务列表后再操作。');
      setTaskActionFeedback(current => ({ ...current, [sourceTaskId]: { phase: 'accepted', message: `${label}已提交，任务 ID：${result.taskId}`, taskId: result.taskId } }));
    } catch (error) {
      setTaskActionFeedback(current => ({ ...current, [sourceTaskId]: { phase: 'error', message: error instanceof Error ? error.message : String(error) } }));
    } finally {
      pending.current.delete(sourceTaskId);
      setPendingTaskActions(new Set(pending.current));
    }
  };
  return { pendingTaskActions, taskActionFeedback, runTaskAction };
}
