const { randomUUID } = require('node:crypto');

function parameters(input) {
  const packageName = String(input.packageName || '').trim();
  const iterations = Number(input.iterations);
  const intervalSeconds = Number(input.intervalSeconds);
  if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(packageName)) throw Error('请输入有效的 Android 应用包名');
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100) throw Error('轮数必须为 1 到 100 的整数');
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < 0 || intervalSeconds > 60) throw Error('间隔必须为 0 到 60 秒');
  return { packageName, iterations, intervalSeconds };
}

function createCase(input) {
  const p = parameters(input);
  const id = `startup-time-${randomUUID()}`;
  const componentId = `${id}-component`;
  const name = String(input.name || `${p.packageName} 冷启动耗时采集`).trim();
  if (!name || name.length > 200) throw Error('用例名称不能为空且不能超过 200 字');
  return { schemaVersion: 'glassbox.workflow.v1', id, name, description: '通过 Android Activity Manager 逐轮采集冷启动耗时。',
    defaults: { phonePackage: p.packageName },
    components: [{ id: componentId, name: '测量应用冷启动', kind: 'mobile_ui_action', device: 'phone', commandTemplate: '', timeoutSeconds: 30,
      params: [{ key: 'action', label: '操作类型', inputType: 'text', defaultValue: 'startup_time' },
        { key: 'packageName', label: '应用包名', inputType: 'text', defaultValue: p.packageName, required: true },
        { key: 'iterations', label: '轮数', inputType: 'number', defaultValue: String(p.iterations) },
        { key: 'intervalSeconds', label: '间隔（秒）', inputType: 'number', defaultValue: String(p.intervalSeconds) }] }],
    steps: [{ id: `${id}-start`, name: '开始', type: 'start', device: 'phone', config: { keepScreenAwake: false, showPhoneScreen: false, showGlassesScreen: false } },
      { id: `${id}-measure`, name: '测量应用冷启动', type: 'component', device: 'phone', componentId, config: {}, inputs: { action: 'startup_time', packageName: p.packageName, iterations: String(p.iterations), intervalSeconds: String(p.intervalSeconds) } },
      { id: `${id}-end`, name: '结束', type: 'end', device: 'phone', config: {} }] };
}

function parseSample(output, packageName) {
  if (/error:|error type |exception occurred while executing|security\s*exception|permission denial|unable to resolve intent/i.test(output)) throw Error('Activity Manager 报告启动失败');
  const fields = {};
  let complete = 0;
  for (const line of output.split(/\r?\n/)) {
    if (line.trim() === 'Complete') { complete++; continue; }
    const m = line.trim().match(/^(Status|LaunchState|Activity|ThisTime|TotalTime|WaitTime):\s*(.*)$/);
    if (m) { if (Object.hasOwn(fields, m[1])) throw Error(`启动结果包含重复字段 ${m[1]}`); fields[m[1]] = m[2].trim(); }
  }
  if (complete !== 1 || fields.Status?.toLowerCase() !== 'ok' || fields.LaunchState?.toUpperCase() !== 'COLD') throw Error('启动结果不完整或系统未报告冷启动');
  if (!fields.Activity?.startsWith(`${packageName}/`) || !/^[A-Za-z0-9_.$]+\/[A-Za-z0-9_.$]+$/.test(fields.Activity)) throw Error('启动结果中的 Activity 与目标包不符');
  const result = { LaunchState: 'COLD', Activity: fields.Activity, ThisTime: null };
  for (const key of ['ThisTime', 'TotalTime', 'WaitTime']) {
    if (key === 'ThisTime' && fields[key] === undefined) continue;
    if (!/^\d+$/.test(fields[key] || '') || !Number.isSafeInteger(Number(fields[key]))) throw Error(`启动结果 ${key} 无效`);
    result[key] = Number(fields[key]);
  }
  if (result.WaitTime < result.TotalTime || (result.ThisTime !== null && result.TotalTime < result.ThisTime)) throw Error('启动耗时字段关系无效');
  return result;
}

async function measure(input, { runAdb, sleep, checkCanceled = () => {} }) {
  const p = parameters(input);
  const serial = String(input.serial || '').trim();
  if (!serial || serial.startsWith('-') || /[\s\x00-\x1f]/.test(serial)) throw Error('设备 SN 无效');
  let component;
  for (const prefix of [['cmd', 'package'], ['pm']]) {
    checkCanceled();
    try {
      const output = await runAdb(['-s', serial, 'shell', ...prefix, 'resolve-activity', '--brief', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', p.packageName], 15000);
      const matches = [...new Set(output.split(/\r?\n/).map(x => x.trim()).filter(x => x.startsWith(`${p.packageName}/`) && /^[A-Za-z0-9_.$]+\/[A-Za-z0-9_.$]+$/.test(x)))];
      if (matches.length === 1) { component = matches[0]; break; }
    } catch (error) { checkCanceled(); }
  }
  if (!component) throw Error('无法解析目标应用的 Launcher Activity');
  const samples = [];
  for (let i = 1; i <= p.iterations; i++) {
    checkCanceled();
    try {
      const output = await runAdb(['-s', serial, 'shell', 'am', 'start', '-W', '-S', '-n', component], 30000);
      samples.push({ iteration: i, ...parseSample(output, p.packageName) });
    } catch (error) { checkCanceled(); error.message = `第 ${i} 轮失败（已完成 ${samples.length} 轮）：${error.message}`; throw error; }
    if (i < p.iterations && p.intervalSeconds) await sleep(p.intervalSeconds * 1000);
  }
  const values = samples.map(s => s.TotalTime).sort((a, b) => a - b);
  const n = values.length;
  return { success: true, targetPackage: p.packageName, launcherComponent: component, mode: 'cold', iterations: n, intervalSeconds: p.intervalSeconds,
    unit: 'ms', measurement: 'Android Activity Manager TotalTime（非视觉完成时间）', percentileMethod: 'nearest-rank', samples,
    statistics: { TotalTime: { min: values[0], max: values[n - 1], mean: Math.round(values.reduce((a, b) => a + b, 0) / n * 1000) / 1000,
      median: n % 2 ? values[(n - 1) / 2] : (values[n / 2 - 1] + values[n / 2]) / 2, p90: values[Math.ceil(n * 0.9) - 1] } } };
}
module.exports = { parameters, createCase, parseSample, measure };
