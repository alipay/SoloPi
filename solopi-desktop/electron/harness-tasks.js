const { randomUUID } = require('node:crypto');
// Adapt the added fixed replay entry to the existing task/report lifecycle.
// Device execution still belongs to the shared Harness bridge.
function createHarnessTasks({ control, persist, readTasks, now = () => new Date().toISOString() }) {
  const active = new Map();
  const publish = async task => { task.updatedAt = now(); await persist(structuredClone(task)); };
  async function recover() {
    for (const previous of readTasks()) if (previous.executionEngine === 'device-harness' && ['submitted', 'running', 'stopping'].includes(previous.status)) {
      const task = structuredClone(previous), finishedAt = now();
      task.status = 'interrupted'; task.finishedAt = finishedAt; task.error = '上次回放已中断，动作结果未知；未自动重放，请核查原证据。';
      for (const item of task.cases || []) if (['submitted', 'running', 'stopping'].includes(item.status)) Object.assign(item, { status: 'stopped', finishedAt, error: task.error });
      await publish(task);
    }
  }
  async function replay(payload) {
    if (active.size) throw Error('desktop_operation_busy');
    const id = 'harness-task-' + randomUUID(), caseId = randomUUID(), startedAt = now();
    const task = { id, name: '三端录制用例回放', taskType: 'standard', source: 'ui', executionEngine: 'device-harness',
      status: 'running', createdAt: startedAt, startedAt, total: 1, completed: 0,
      devices: { phone: { serial: payload?.config?.deviceId || '', runtime: payload?.config?.platform || '' } },
      cases: [{ caseId, name: '三端录制用例回放', status: 'running', startedAt, results: [],
        caseSnapshot: { id: caseId, name: '三端录制用例回放', steps: [], harnessRequirement: structuredClone(payload?.requirement) } }] };
    const state = { task, stopping: false }; active.set(id, state);
    try {
      await publish(task); // Failure to make the task visible must prevent execution.
      const response = await control.request('replay', payload);
      const verdict = response?.data?.result?.status;
      const status = state.stopping ? 'stopped' : response?.success && response.data?.exitCode === 0 && ['passed', 'success'].includes(verdict) ? 'success' : 'failed';
      const finishedAt = now(), error = status === 'failed' ? response.error || `录制用例回放结果：${verdict || '未确认'}` : '';
      Object.assign(task, { status, finishedAt, completed: 1, error });
      Object.assign(task.cases[0], { status, finishedAt, error, results: [{ stepId: 'device-replay', stepName: '录制用例回放', status, error,
        startedAt, finishedAt, output: JSON.stringify(response.data || response) }], harnessArtifacts: response.data?.artifacts });
      await publish(task); return { ...response, taskId: id };
    } catch (error) {
      const status = state.stopping ? 'stopped' : 'failed', finishedAt = now();
      Object.assign(task, { status, finishedAt, completed: 1, error: error.message });
      Object.assign(task.cases[0], { status, finishedAt, error: error.message }); await publish(task); throw error;
    } finally { active.delete(id); }
  }
  async function stop(id) {
    const entry = active.get(id); if (!entry) return { success: false, error: '回放任务已结束或不存在' };
    entry.stopping = true; entry.task.status = 'stopping'; await publish(entry.task);
    await (entry.stop ? entry.stop() : control.stop()); return { success: true, taskId: id };
  }
  async function beginActivity({ name, deviceId, stop: stopActivity }) {
    const id = 'harness-task-' + randomUUID(), startedAt = now(), caseId = randomUUID();
    const task = { id, name, taskType: 'standard', source: 'ui', executionEngine: 'device-harness', executionKind: 'activity',
      status: 'running', createdAt: startedAt, startedAt, total: 1, completed: 0,
      devices: { phone: { serial: deviceId, runtime: 'android' } }, cases: [{ caseId, name, status: 'running', startedAt, results: [], caseSnapshot: { id: caseId, name, steps: [] } }] };
    const entry = { task, stop: stopActivity }; active.set(id, entry);
    try { await publish(task); } catch (error) { active.delete(id); throw error; }
    let queue = Promise.resolve(), terminal = false;
    return { id, update(snapshot) {
      queue = queue.catch(() => {}).then(async () => {
        if (terminal) return;
        const finished = !['starting', 'running'].includes(snapshot.status);
        const status = finished ? (snapshot.status === 'stopped' || snapshot.reason === 'stopped') && snapshot.cleanupConfirmed === true && !snapshot.pending ? 'stopped' : 'failed' : entry.stopping ? 'stopping' : 'running';
        const finishedAt = finished ? now() : undefined;
        const error = status === 'failed' ? snapshot.reason || 'device_activity_failed' : '';
        Object.assign(task, { status, error, ...(finished ? { finishedAt, completed: 1 } : {}) });
        Object.assign(task.cases[0], { status, error, ...(finished ? { finishedAt } : {}), results: [{ stepId: 'device-activity', stepName: name, status, error, output: JSON.stringify(snapshot) }] });
        await publish(task);
        if (finished) { terminal = true; active.delete(id); }
      });
      return queue;
    } };
  }
  return { replay, stop, recover, beginActivity, owns: id => active.has(id), stopAll: () => Promise.all([...active.keys()].map(stop)) };
}
module.exports = { createHarnessTasks };
