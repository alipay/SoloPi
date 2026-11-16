interface TaskSource {
  id: string;
  reportDetailLoaded?: boolean;
  summary?: { failedCount?: number };
  cases?: Array<{ status?: string }>;
}

// Task list rows are summaries. Always fetch the authoritative detail for an action,
// including when a previously opened detail happens to be present in renderer state.
export async function loadTaskForFailedRerun<T extends TaskSource>(
  task: T,
  load: () => Promise<{ success?: boolean; task?: T; error?: string }>,
): Promise<T> {
  const result = await load();
  if (!result?.success || !result.task) throw new Error(`加载重跑所需的报告详情失败：${result?.error || '未返回报告详情'}`);
  const detail = result.task;
  if (detail.id !== task.id) throw new Error('报告任务 ID 不一致，已取消重跑');
  if (detail.reportDetailLoaded === false || !Array.isArray(detail.cases)) throw new Error('报告用例明细未完整加载，请重试');
  const failed = detail.cases.filter(record => record.status === 'failed').length;
  if (typeof detail.summary?.failedCount === 'number' && detail.summary.failedCount !== failed) {
    throw new Error(`报告摘要与明细不一致（摘要失败 ${detail.summary.failedCount} 条，明细 ${failed} 条），请重试`);
  }
  return detail;
}
