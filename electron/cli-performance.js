const { randomUUID } = require('node:crypto');
function performanceTask(input) {
  const { serial, packageName, role = 'glasses', runtime = 'android', durationSeconds = 60, intervalSeconds = 5 } = input;
  if (!['phone','glasses'].includes(role) || !['android','harmony'].includes(runtime)) throw Error('role应为phone/glasses，runtime应为android/harmony');
  if (typeof serial !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(serial) || typeof packageName !== 'string' || !/^[A-Za-z0-9_.]+$/.test(packageName)) throw Error('需要有效serial和packageName');
  if (!Number.isInteger(durationSeconds) || durationSeconds < 5 || durationSeconds > 3600 || !Number.isInteger(intervalSeconds) || intervalSeconds < 1 || intervalSeconds > 60) throw Error('duration应为5~3600秒，interval应为1~60秒');
  const taskId = `cli-performance-${randomUUID()}`;
  return { taskId, taskName: input.taskName || 'CLI 性能采集', source: 'cli', components: [], disableScreenMirror: true,
    devices: { [role]: { serial, packageName, runtime } },
    cases: [{ schemaVersion: 'glassbox.workflow.v1', id: `${taskId}-case`, name: '性能采集', defaults: { [`${role}Serial`]: serial, [`${role}Package`]: packageName }, steps: [
      { id: 'start', name: '开始', type: 'start', device: role, config: { showGlassesScreen: false, showPhoneScreen: false, keepScreenAwake: false } },
      { id: 'collect', name: '采集性能', type: 'wait', device: role, config: { durationMs: durationSeconds * 1000 } },
      { id: 'end', name: '结束', type: 'end', device: role, config: {} },
    ] }], performanceOptions: { [role]: true, intervalMs: intervalSeconds * 1000, targets: { [role]: { serial, packageName, runtime } } } };
}
module.exports = { performanceTask };
