const TASK_EVENT_SCHEMA_VERSION = 'glassbox.workflow-task-event.v1';
const TASK_TERMINAL_STATUSES = new Set(['success', 'failed', 'stopped']);
const CASE_TERMINAL_STATUSES = new Set(['success', 'failed', 'stopped']);

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function getTaskCases(task = {}) {
  return Array.isArray(task.cases) ? task.cases : [];
}

function getTaskTotal(task = {}) {
  const cases = getTaskCases(task);
  return Math.max(0, Number(task.total || task.summary?.caseCount || cases.length || 0));
}

function getTaskCompleted(task = {}) {
  const cases = getTaskCases(task);
  if (cases.length) {
    return cases.filter((item) => CASE_TERMINAL_STATUSES.has(normalizeStatus(item?.status))).length;
  }
  return Math.max(0, Number(task.completed || task.summary?.completed || 0));
}

function hasActiveTaskCases(task = {}) {
  return getTaskCases(task).some((item) => ['pending', 'submitted', 'running', 'stopping'].includes(normalizeStatus(item?.status)));
}

function isAuthoritativeTaskTerminal(task = {}) {
  const status = normalizeStatus(task.status);
  const total = getTaskTotal(task);
  const completed = getTaskCompleted(task);
  return TASK_TERMINAL_STATUSES.has(status)
    && Boolean(task.finishedAt)
    && !hasActiveTaskCases(task)
    && completed >= total;
}

function findFirstFailedResult(caseRecord = {}) {
  return (Array.isArray(caseRecord?.results) ? caseRecord.results : [])
    .find((item) => normalizeStatus(item?.status) === 'failed') || null;
}

function getCaseArtifacts(caseRecord = {}) {
  const artifacts = caseRecord?.artifacts && typeof caseRecord.artifacts === 'object'
    ? caseRecord.artifacts
    : null;
  if (!artifacts) return null;
  return {
    runDir: artifacts.runDir || '',
    logs: Array.isArray(artifacts.logs) ? artifacts.logs : [],
    recordings: Array.isArray(artifacts.recordings) ? artifacts.recordings : [],
    screenshots: Array.isArray(artifacts.screenshots) ? artifacts.screenshots : [],
    performanceReports: artifacts.performanceReports || {},
  };
}

function createTaskEvent(task, type, caseRecord, revision, timestamp) {
  const firstFailedNode = findFirstFailedResult(caseRecord);
  const artifacts = getCaseArtifacts(caseRecord);
  const base = {
    schemaVersion: TASK_EVENT_SCHEMA_VERSION,
    eventId: `${task.id}:${revision}`,
    revision,
    taskId: task.id,
    taskRevision: task.taskRevision || '',
    type,
    caseId: caseRecord?.caseId || '',
    caseName: caseRecord?.caseName || caseRecord?.caseSnapshot?.name || '',
    caseStatus: caseRecord?.status || '',
    taskStatus: task.status || '',
    completed: getTaskCompleted(task),
    total: getTaskTotal(task),
    timestamp: timestamp || task.updatedAt || new Date().toISOString(),
  };

  if (type === 'case_terminal') {
    return {
      ...base,
      ...(Array.isArray(caseRecord?.caseSnapshot?.steps) ? {plannedStepCount:caseRecord.caseSnapshot.steps.length} : {}),
      results: Array.isArray(caseRecord?.results) ? caseRecord.results : [],
      firstFailedNode,
      error: caseRecord?.error || firstFailedNode?.error || '',
      errorCode: caseRecord?.errorCode || firstFailedNode?.errorCode || '',
      errorType: caseRecord?.errorType || firstFailedNode?.errorType || '',
      recoveryActions: caseRecord?.recoveryActions || firstFailedNode?.recoveryActions || [],
      evidenceReady: false,
    };
  }

  if (type === 'case_artifacts_ready') {
    return {
      ...base,
      evidenceReady: true,
      ...(artifacts || {
        runDir: '',
        logs: [],
        recordings: [],
        screenshots: [],
        performanceReports: {},
      }),
    };
  }

  if (type === 'task_terminal') {
    return {
      ...base,
      caseId: '',
      caseName: '',
      caseStatus: '',
      hasFailures: Boolean(task.hasFailures || Number(task.summary?.failedCount || 0) > 0),
      summary: task.summary || {},
      reportPackage: task.reportPackage || null,
      reportPackagePath: task.reportPackagePath || task.reportPackage?.path || '',
    };
  }

  return base;
}

function appendTransitionEvents(previousTask = {}, nextTask = {}) {
  const previousCases = new Map(getTaskCases(previousTask).map((item) => [String(item?.caseId || ''), item]));
  const existingEvents = Array.isArray(previousTask.taskEvents)
    ? previousTask.taskEvents
    : (Array.isArray(nextTask.taskEvents) ? nextTask.taskEvents : []);
  const events = [...existingEvents];
  let revision = Math.max(
    Number(previousTask.eventRevision || 0),
    Number(nextTask.eventRevision || 0),
    ...events.map((item) => Number(item?.revision || 0))
  );
  const append = (type, caseRecord, timestamp) => {
    revision += 1;
    events.push(createTaskEvent(nextTask, type, caseRecord, revision, timestamp));
  };

  getTaskCases(nextTask).forEach((caseRecord) => {
    const previous = previousCases.get(String(caseRecord?.caseId || '')) || {};
    const previousStatus = normalizeStatus(previous.status);
    const nextStatus = normalizeStatus(caseRecord?.status);
    if (!['running', 'stopping'].includes(previousStatus) && ['running', 'stopping'].includes(nextStatus)) {
      append('case_started', caseRecord, caseRecord.startedAt || nextTask.updatedAt);
    }
    if (!CASE_TERMINAL_STATUSES.has(previousStatus) && CASE_TERMINAL_STATUSES.has(nextStatus)) {
      append('case_terminal', caseRecord, caseRecord.finishedAt || caseRecord.endedAt || nextTask.updatedAt);
    }
    const previousEvidenceReady = Boolean(previous?.artifacts?.evidenceReady);
    const nextEvidenceReady = Boolean(caseRecord?.artifacts?.evidenceReady);
    if (!previousEvidenceReady && nextEvidenceReady) {
      append('case_artifacts_ready', caseRecord, caseRecord.artifacts.finalizedAt || caseRecord.finishedAt || nextTask.updatedAt);
    }
  });

  if (!isAuthoritativeTaskTerminal(previousTask) && isAuthoritativeTaskTerminal(nextTask)) {
    append('task_terminal', null, nextTask.finishedAt || nextTask.updatedAt);
  }

  return {
    ...nextTask,
    eventRevision: revision,
    taskEvents: events,
  };
}

function rebuildTaskEvents(task = {}) {
  if (Array.isArray(task.taskEvents) && task.taskEvents.length) {
    return [...task.taskEvents].sort((a, b) => Number(a.revision || 0) - Number(b.revision || 0));
  }
  const events = [];
  let revision = 0;
  const append = (type, caseRecord, timestamp) => {
    revision += 1;
    events.push(createTaskEvent(task, type, caseRecord, revision, timestamp));
  };
  getTaskCases(task).forEach((caseRecord) => {
    if (caseRecord?.startedAt) append('case_started', caseRecord, caseRecord.startedAt);
    if (CASE_TERMINAL_STATUSES.has(normalizeStatus(caseRecord?.status))) {
      append('case_terminal', caseRecord, caseRecord.finishedAt || caseRecord.endedAt);
      if (caseRecord?.artifacts) append('case_artifacts_ready', caseRecord, caseRecord.artifacts.finalizedAt || caseRecord.finishedAt || caseRecord.endedAt);
    }
  });
  if (isAuthoritativeTaskTerminal(task)) append('task_terminal', null, task.finishedAt);
  return events;
}

function resolveAfterEventRevision(events = [], after = '') {
  const token = String(after || '').trim();
  if (!token) return 0;
  if (/^\d+$/.test(token)) return Number(token);
  const matches = events.filter((event) => event.eventId === token || event.taskRevision === token);
  return matches.length ? Math.max(...matches.map((event) => Number(event.revision || 0))) : 0;
}

module.exports = {
  TASK_EVENT_SCHEMA_VERSION,
  appendTransitionEvents,
  getTaskCompleted,
  getTaskTotal,
  hasActiveTaskCases,
  isAuthoritativeTaskTerminal,
  rebuildTaskEvents,
  resolveAfterEventRevision,
};
