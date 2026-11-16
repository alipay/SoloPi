function isBrokerWorkflowTask(task) {
  return task?.source === 'cli'
    || task?.source === 'broker'
    || task?.source === 'ui-broker'
    || String(task?.id || '').startsWith('cli-task-');
}

function getWorkflowTaskUpdatedAtMs(task) {
  const value = Date.parse(String(task?.updatedAt || task?.finishedAt || task?.createdAt || ''));
  return Number.isFinite(value) ? value : 0;
}

function isWorkflowTaskActive(task) {
  return ['submitted', 'running', 'stopping'].includes(String(task?.status || ''));
}

function getWorkflowTaskCounts(task) {
  const cases = Array.isArray(task?.cases) ? task.cases : [];
  const summary = task?.summary || {};
  if (!cases.length) {
    return {
      successCount: Number(summary.successCount || 0),
      failedCount: Number(summary.failedCount || 0),
      stoppedCount: Number(summary.stoppedCount || 0),
      runningCount: Number(summary.runningCount || 0),
      pendingCount: Number(summary.pendingCount || 0),
      completed: Number(summary.completed || task?.completed || 0),
      caseCount: Number(summary.caseCount || task?.total || 0),
    };
  }
  const successCount = cases.filter((item) => item?.status === 'success').length;
  const failedCount = cases.filter((item) => item?.status === 'failed').length;
  const stoppedCount = cases.filter((item) => item?.status === 'stopped').length;
  const runningCount = cases.filter((item) => ['running', 'stopping'].includes(item?.status)).length;
  const pendingCount = cases.filter((item) => ['pending', 'submitted', ''].includes(String(item?.status || ''))).length;
  return {
    successCount,
    failedCount,
    stoppedCount,
    runningCount,
    pendingCount,
    completed: successCount + failedCount + stoppedCount,
    caseCount: cases.length,
  };
}

function createWorkflowTaskSummary(task, detailPath = '') {
  if (!task || typeof task !== 'object') return task;
  const counts = getWorkflowTaskCounts(task);
  const summary = {
    ...task,
    cases: undefined,
    taskEvents: undefined,
    performanceReports: undefined,
    reportDetailPath: detailPath || task.reportDetailPath || '',
    reportDetailLoaded: false,
    summary: {
      ...(task.summary || {}),
      ...counts,
    },
    hasFailures: Boolean(task.hasFailures || counts.failedCount > 0),
  };
  return summary;
}

function createWorkflowTaskRendererDetail(task) {
  return { ...task, taskEvents: undefined,
    performanceReports: task.performanceReports && Object.fromEntries(Object.entries(task.performanceReports).map(([target, report]) => [target, {
      ...report, samples: (report.samples || []).map(({ raw, commandErrors, ...sample }) => ({
        ...sample, commandErrors: (commandErrors || []).map(({ stdout, stderr, ...error }) => error),
      })),
    }])),
  };
}

function splitWorkflowTaskDetails(tasks = [], options = {}) {
  const getDetailPath = typeof options.getDetailPath === 'function'
    ? options.getDetailPath
    : (task) => String(task?.reportDetailPath || '');
  const persistDetail = typeof options.persistDetail === 'function'
    ? options.persistDetail
    : () => {};
  const detailExists = typeof options.detailExists === 'function'
    ? options.detailExists
    : () => false;
  let changed = false;
  const summaries = tasks.map((task) => {
    if (!task?.id || !Array.isArray(task.cases) || task.cases.length === 0) {
      return task;
    }
    const detailPath = getDetailPath(task);
    if (task.reportDetailLoaded !== false || !detailExists(detailPath)) {
      persistDetail(detailPath, task);
    }
    changed = true;
    return createWorkflowTaskSummary(task, detailPath);
  });
  return { tasks: summaries, changed };
}

function shouldRecoverStaleWorkflowTask(task, options = {}) {
  if (!isWorkflowTaskActive(task) || !task?.id) return false;
  if (options.activeTaskIds?.has(String(task.id))) return false;
  if (options.runnerLiveness !== 'dead') return false;
  const now = Number(options.now || Date.now());
  const minimumAgeMs = Math.max(0, Number(options.minimumAgeMs ?? 60_000));
  const updatedAtMs = getWorkflowTaskUpdatedAtMs(task);
  return updatedAtMs > 0 && now - updatedAtMs >= minimumAgeMs;
}

function mergeWorkflowTasksForRendererSave(incomingTasks = [], persistedTasks = []) {
  const incomingById = new Map(incomingTasks.map((task) => [String(task?.id || ''), task]).filter(([id]) => id));
  const mergedTasks = [...incomingTasks];

  persistedTasks.forEach((persistedTask) => {
    if (!isBrokerWorkflowTask(persistedTask) || !persistedTask?.id) return;
    const incomingTask = incomingById.get(String(persistedTask.id));
    if (!incomingTask) {
      mergedTasks.unshift(persistedTask);
      return;
    }
    if (getWorkflowTaskUpdatedAtMs(persistedTask) > getWorkflowTaskUpdatedAtMs(incomingTask)) {
      const index = mergedTasks.findIndex((task) => task?.id === persistedTask.id);
      if (index >= 0) mergedTasks[index] = persistedTask;
    }
  });

  const dedupedTasks = [];
  const seenTaskIds = new Set();
  mergedTasks.forEach((task) => {
    const id = String(task?.id || '');
    if (!id || seenTaskIds.has(id)) return;
    seenTaskIds.add(id);
    dedupedTasks.push(task);
  });
  return dedupedTasks;
}

function mergeWorkflowStateForRendererSave(incomingState = {}, persistedState = {}) {
  return require('./task-cleanup').preserveRemovals({
    ...incomingState,
    automationTasks: mergeWorkflowTasksForRendererSave(
      Array.isArray(incomingState.automationTasks) ? incomingState.automationTasks.filter(task => !task.externalSource) : [],
      Array.isArray(persistedState.automationTasks) ? persistedState.automationTasks : []
    ),
  },persistedState);
}

module.exports = {
  createWorkflowTaskRendererDetail,
  createWorkflowTaskSummary,
  getWorkflowTaskUpdatedAtMs,
  getWorkflowTaskCounts,
  isWorkflowTaskActive,
  isBrokerWorkflowTask,
  mergeWorkflowStateForRendererSave,
  mergeWorkflowTasksForRendererSave,
  shouldRecoverStaleWorkflowTask,
  splitWorkflowTaskDetails,
};
