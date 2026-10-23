// Broker-owned leases protect physical devices across every execution entry point.
function prepareWorkflowExecution(input = {}) {
  const payload = structuredClone(input);
  if(payload.devices && Object.keys(payload.devices).some(role=>!['phone','glasses','defaults','adbPath'].includes(role)))
    throw Object.assign(new Error('设备角色仅支持 phone / glasses'),{code:'INVALID_DEVICE_ROLE'});
  const cases = [...(payload.cases || []), ...(payload.testCase ? [payload.testCase] : [])];
  const serials = new Set();
  for (const role of ['phone', 'glasses']) {
    const target = payload.devices?.[role];
    if (target?.serial !== undefined && target.serial !== '' && (typeof target.serial !== 'string' || !target.serial.trim())) {
      throw Object.assign(new Error(`${role} serial 必须是非空字符串`), { code: 'INVALID_DEVICE_SERIAL' });
    }
    if (target?.serial) {
      serials.add(target.serial);
      for (const testCase of cases) {
        testCase.defaults = { ...testCase.defaults, [`${role}Serial`]: target.serial,
          ...(target.packageName ? { [`${role}Package`]: target.packageName } : {}) };
      }
    }
    for (const testCase of cases) {
      const serial = testCase.defaults?.[`${role}Serial`];
      if (serial) serials.add(serial);
    }
    const performance = payload.performanceOptions;
    if (performance?.[role]) {
      const serial = performance.targets?.[role]?.serial;
      if (target?.serial && serial && target.serial !== serial) {
        throw Object.assign(new Error(`${role} 性能设备与任务指定设备不一致`), { code: 'DEVICE_TARGET_MISMATCH' });
      }
      if (serial) serials.add(serial);
    }
  }
  for (const testCase of cases) {
    const needed = require('./task-device-selection').collectRequiredDeviceRoles({...payload,cases:[testCase],payloadComponents:payload.components});
    for (const role of needed) if (!testCase.defaults?.[`${role}Serial`]) {
      throw Object.assign(new Error(`${role} 缺少本次任务设备 SN，任务未提交`), {code:'DEVICE_PREFLIGHT_NO_MATCH',role,caseId:testCase.id});
    }
  }
  payload.reservedDeviceSerials = [...serials].sort();
  return payload;
}
function createWorkflowExecutionGate() {
  const owners = new Set();
  function acquire(task = {}) {
    const serials = new Set(task.reservedDeviceSerials || []);
    const conflicts = [...owners].filter(owner => (task.id && owner.task.id === task.id)
      || owner.task.reservedDeviceSerials.some(serial => serials.has(serial)));
    if (conflicts.length) {
      const activeTasks = conflicts.map(owner => ({ ...owner.task }));
      throw Object.assign(new Error('指定设备正在执行任务或收尾，请等待占用任务结束或显式停止该任务。'), {
        code: 'TEST_TASK_BUSY', activeTask: activeTasks[0], activeTasks,
        conflictingDevices: [...new Set(activeTasks.flatMap(owner => owner.reservedDeviceSerials).filter(serial => serials.has(serial)))],
      });
    }
    const lease = {
      task: { id: task.id || '', name: task.name || '', status: task.status || 'submitted', reservedDeviceSerials: [...serials] },
      release() { owners.delete(lease); },
    };
    owners.add(lease);
    return lease;
  }
  async function run(task, execute) {
    const lease = acquire(task);
    lease.task.status = 'running';
    try { return await execute(); } finally { lease.release(); }
  }
  return { acquire, run };
}
function workflowExecutionFailure(error) {
  return { success: false, submitted: false, error: error instanceof Error ? error.message : String(error),
    ...(error?.code ? { errorCode: error.code } : {}),
    ...(error?.activeTask ? { activeTask: error.activeTask } : {}),
    ...(error?.activeTasks ? { activeTasks: error.activeTasks, conflictingDevices: error.conflictingDevices } : {}),
  };
}
module.exports = { createWorkflowExecutionGate, workflowExecutionFailure, prepareWorkflowExecution };
