const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const performanceTargetSchema={type:'object',additionalProperties:false,properties:{
  target:{enum:['phone','glasses']},runtime:{enum:['android','harmony','ios']},serial:{type:'string'},packageName:{type:'string'}
}};
const performanceOptionsSchema={type:'object',additionalProperties:false,properties:{
  phone:{type:'boolean',description:'采集手机；不是enabled开关'},glasses:{type:'boolean',description:'采集眼镜；不是enabled开关'},
  intervalMs:{type:'integer',minimum:1000},
  targets:{type:'object',additionalProperties:false,properties:{phone:performanceTargetSchema,glasses:performanceTargetSchema}},
  threadStacks:{type:'object',additionalProperties:false,properties:{enabled:{type:'boolean'},mode:{enum:['manual','interval','checkpoint','failure']},
    intervalMs:{type:'integer',minimum:30000,maximum:3600000},maxCount:{type:'integer',minimum:1,maximum:100},
    maxBytes:{type:'integer',minimum:1024,maximum:67108864},waitMs:{type:'integer',minimum:500,maximum:15000},
    checkpoints:{type:'array',items:{type:'string',minLength:1}}}}
}};
performanceOptionsSchema.allOf=['phone','glasses'].map(role=>({
  if:{properties:{[role]:{const:true}},required:[role]},
  then:{required:['targets'],properties:{targets:{required:[role],properties:{[role]:{required:['serial','packageName'],properties:{serial:{type:'string',minLength:1},packageName:{type:'string',minLength:1}}}}}}}
}));
// This module is also staged next to the standalone Node CLI: keep it dependency-free.
function validatePerformanceShape(options) {
  if(!options || typeof options!=='object' || Array.isArray(options) || Object.keys(options).some(k=>!Object.hasOwn(performanceOptionsSchema.properties,k))) return false;
  for(const role of ['phone','glasses']) if(options[role]!==undefined && typeof options[role]!=='boolean') return false;
  if(options.intervalMs!==undefined && (!Number.isSafeInteger(options.intervalMs) || options.intervalMs<1000)) return false;
  if(options.targets!==undefined) {
    if(!options.targets || typeof options.targets!=='object' || Array.isArray(options.targets) || Object.keys(options.targets).some(k=>!['phone','glasses'].includes(k))) return false;
    for(const role of ['phone','glasses']) {
      const target=options.targets[role];if(target===undefined)continue;
      if(!target || typeof target!=='object' || Array.isArray(target) || Object.keys(target).some(k=>!Object.hasOwn(performanceTargetSchema.properties,k)))return false;
      for(const key of ['serial','packageName']) if(target[key]!==undefined && typeof target[key]!=='string')return false;
      if(target.runtime!==undefined && !performanceTargetSchema.properties.runtime.enum.includes(target.runtime))return false;
      if(target.target!==undefined && !['phone','glasses'].includes(target.target))return false;
    }
  }
  if(options.threadStacks!==undefined) {
    const value=options.threadStacks;
    if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(k=>!Object.hasOwn(performanceOptionsSchema.properties.threadStacks.properties,k)))return false;
  }
  return true;
}

function validateWorkflowPerformanceTargets(options = {}) {
  if(!validatePerformanceShape(options)) throw Object.assign(new Error('性能参数无效：使用phone/glass布尔开关及targets.<role>.serial/packageName，不支持enabled等未知字段。'),{
    code:'PERFORMANCE_OPTIONS_INVALID',errorCode:'PERFORMANCE_OPTIONS_INVALID',field:'performanceOptions'
  });
  for (const role of ['phone', 'glasses']) {
    if (!options[role]) continue;
    const target = options.targets?.[role];
    if (!String(target?.serial || '').trim() || !String(target?.packageName || '').trim()) {
      throw Object.assign(new Error(`${role} 性能采集缺少设备 SN 或目标包名。`), {
        code: 'PERFORMANCE_TARGET_CONFIG_MISSING', errorCode: 'PERFORMANCE_TARGET_CONFIG_MISSING',
        field: `performanceOptions.targets.${role}`,
      });
    }
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
  fs.renameSync(tempPath, filePath);
}

function getPerformanceRecoveryActions(target, config = {}) {
  return [
    `确认 ${target} 设备 SN ${config.serial || '<serial>'} 在线且可执行性能采样命令。`,
    `确认目标包名/进程名 ${config.packageName || '<package>'} 正确且进程正在运行。`,
    '检查 task.performanceDiagnostics 和 performanceReports.<target>.samples[].error 获取采集失败详情。',
  ];
}

function createPerformanceDiagnostic(target, code, message, config = {}, details = {}) {
  return {
    schemaVersion: 'glassbox.error.v1',
    code,
    type: 'performance-collection',
    message,
    target,
    recoveryActions: getPerformanceRecoveryActions(target, config),
    details: {
      target,
      runtime: config.runtime || 'android',
      serial: config.serial || '',
      packageName: config.packageName || '',
      ...details,
    },
  };
}

function uniquePerformanceSamples(samples = []) {
  const seen = new Set();
  return samples.filter(sample => {
    const key = sample.sampleId || (sample.timestamp ? JSON.stringify([sample.timestamp, sample.serial, sample.packageName]) : null);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

// Raw command output is evidence, not live task state. Write it once per sample.
async function retainSampleEvidence(sample, taskDir, target, index, taskId) {
  const sampleId = `${taskId}:${target}:${index}`;
  const evidencePath = path.join(taskDir, 'evidence', `${target}-${index}.json`);
  await fs.promises.mkdir(path.dirname(evidencePath), { recursive: true });
  await fs.promises.writeFile(evidencePath, JSON.stringify({ ...sample, sampleId }), { mode: 0o600 });
  const { raw, commandErrors, ...metrics } = sample;
  return { ...metrics, sampleId, rawEvidencePath: evidencePath,
    commandErrors: (commandErrors || []).map(({ stdout, stderr, ...error }) => error) };
}

function summarizePerformanceReports(reports = {}) {
  const performanceDiagnostics = [];
  const normalizedReports = Object.fromEntries(Object.entries(reports).map(([target, report]) => {
    const samples = uniquePerformanceSamples(Array.isArray(report.samples) ? report.samples : []);
    const failedSamples = samples.filter((sample) => sample?.error);
    const validSamples = samples.filter((sample) => !sample?.error);
    let status = 'pending';
    let errorCode = '';
    if (validSamples.length && failedSamples.length) {
      status = 'partial';
      errorCode = 'PERFORMANCE_COLLECTION_PARTIAL';
    } else if (validSamples.length) {
      status = 'success';
    } else if (failedSamples.length) {
      status = 'failed';
      errorCode = 'PERFORMANCE_COLLECTION_FAILED';
    }
    const diagnostics = failedSamples.slice(-5).map((sample) => createPerformanceDiagnostic(
      target,
      sample.errorCode || 'PERFORMANCE_SAMPLE_FAILED',
      sample.error || `${target} 性能采样失败`,
      report,
      { timestamp: sample.timestamp || '' }
    ));
    if (report.persistenceError) {
      status = validSamples.length ? 'partial' : 'failed';
      errorCode = 'PERFORMANCE_EVIDENCE_WRITE_FAILED';
      diagnostics.push(createPerformanceDiagnostic(target, errorCode, report.persistenceError, report));
    }
    performanceDiagnostics.push(...diagnostics);
    return [target, {
      ...report,
      samples,
      status,
      sampleCount: samples.length,
      validSampleCount: validSamples.length,
      failedSampleCount: failedSamples.length,
      errorCode,
      error: report.persistenceError || failedSamples.slice(-1)[0]?.error || '',
      diagnostics,
      recoveryActions: errorCode ? getPerformanceRecoveryActions(target, report) : [],
    }];
  }));
  const statuses = Object.values(normalizedReports).map((report) => report.status);
  const performanceStatus = statuses.includes('failed') && !statuses.includes('success') && !statuses.includes('partial')
    ? 'failed'
    : statuses.includes('failed') || statuses.includes('partial') ? 'partial' : statuses.length ? 'success' : 'disabled';
  return {
    performanceReports: normalizedReports,
    performanceDiagnostics,
    performanceStatus,
    performanceErrorCode: performanceStatus === 'failed'
      ? 'PERFORMANCE_COLLECTION_FAILED'
      : performanceStatus === 'partial' ? 'PERFORMANCE_COLLECTION_PARTIAL' : '',
    performanceRecoveryActions: performanceDiagnostics.length
      ? [...new Set(performanceDiagnostics.flatMap((item) => item.recoveryActions || []))]
      : [],
  };
}

function createWorkflowPerformanceCollector(options = {}) {
  const performanceOptions = options.performanceOptions || {};
  const enabledTargets = ['phone', 'glasses'].filter((target) => Boolean(performanceOptions[target]));
  if (!enabledTargets.length) {
    return null;
  }
  const now = options.now || (() => new Date().toISOString());
  const taskDir = path.join(options.dataDir, 'logs', 'workflow-performance', options.taskId);
  const reports = Object.fromEntries(enabledTargets.map((target) => {
    const config = performanceOptions.targets?.[target] || {};
    return [target, {
      id: `task-performance-${target}-${Date.now()}`,
      target,
      name: `${options.taskName || options.taskId} · ${target === 'phone' ? '手机性能报告' : '眼镜性能报告'}`,
      createdAt: now(),
      runtime: config.runtime || 'android',
      serial: config.serial || '',
      packageName: config.packageName || '',
      samples: [],
      artifactPath: path.join(taskDir, `${target}.json`),
    }];
  }));
  const crashCollectors = Object.fromEntries(enabledTargets.map(target => [target, options.createCrashCollector?.({
    ...(performanceOptions.targets?.[target] || {}),
    artifactPath: path.join(taskDir, `${target}-crashes.json`),
    onUpdate: snapshot => { reports[target].crashes = snapshot; },
  })]));
  let timerId = null;
  let queue = Promise.resolve();
  let started = false;
  let collecting = false;
  let stopping = false;
  let stopPromise;
  const controller = new AbortController();

  const persist = async () => {
    let snapshot = summarizePerformanceReports(reports);
    await Promise.all(Object.values(snapshot.performanceReports).map(async report => {
      const temporary = `${report.artifactPath}.tmp`;
      try {
      await fs.promises.mkdir(path.dirname(temporary), { recursive: true });
      await fs.promises.writeFile(temporary, JSON.stringify(report));
      await fs.promises.rename(temporary, report.artifactPath);
      delete reports[report.target].persistenceError;
      } catch (error) { reports[report.target].persistenceError = error.message; }
    }));
    snapshot = summarizePerformanceReports(reports);
    try {
      options.onUpdate?.(snapshot);
    } catch (_error) {
      // Performance persistence must not interrupt workflow execution.
    }
    return snapshot;
  };

  const collectAll = async () => {
    if (stopping) return summarizePerformanceReports(reports);
    await Promise.all(enabledTargets.map(async (target) => {
      const config = performanceOptions.targets?.[target] || {};
      let sample;
      if (!config.serial || !config.packageName) {
        sample = {
          timestamp: now(),
          serial: config.serial || '',
          packageName: config.packageName || '',
          runtime: config.runtime || 'android',
          errorCode: 'PERFORMANCE_TARGET_CONFIG_MISSING',
          error: `${target} 性能采样缺少设备 SN 或包名`,
        };
      } else {
        try {
          sample = await options.collectSample(target, config, { signal: controller.signal });
          sample = {
            timestamp: sample?.timestamp || now(),
            serial: sample?.serial || config.serial,
            packageName: sample?.packageName || config.packageName,
            runtime: sample?.runtime || config.runtime || 'android',
            ...(sample || {}),
          };
        } catch (error) {
          if (controller.signal.aborted) return;
          sample = {
            timestamp: now(),
            serial: config.serial,
            packageName: config.packageName,
            runtime: config.runtime || 'android',
            errorCode: 'PERFORMANCE_SAMPLE_FAILED',
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
      if (controller.signal.aborted) return;
      try {
        sample = await retainSampleEvidence(sample, taskDir, target, reports[target].samples.length, options.taskId);
      } catch (error) {
        // Preserve evidence loss as an explicit failed sample, never a successful empty sample.
        sample = { timestamp: sample.timestamp, serial: sample.serial, packageName: sample.packageName,
          errorCode: 'PERFORMANCE_EVIDENCE_WRITE_FAILED', error: error.message };
      }
      reports[target].samples.push(sample);
    }));
    return persist();
  };

  const enqueueCollect = () => {
    if (collecting || stopping) return queue;
    collecting = true;
    queue = queue.then(collectAll, collectAll).finally(() => { collecting = false; });
    return queue;
  };

  return {
    start() {
      if (started || stopping) return;
      started = true;
      const crashReady = Promise.all(Object.values(crashCollectors).map(collector => collector?.start()));
      enqueueCollect();
      timerId = setInterval(enqueueCollect, Math.max(1000, Number(performanceOptions.intervalMs || 5000)));
      timerId.unref?.();
      return crashReady;
    },
    stop() {
      stopping = true;
      controller.abort();
      if (timerId) clearInterval(timerId);
      return stopPromise ||= (async () => {
        await Promise.all(Object.values(crashCollectors).map(collector => collector?.stop()));
        await queue;
        return persist();
      })();
    },
    getSnapshot() {
      return summarizePerformanceReports(reports);
    },
  };
}

// Half-open intervals; a boundary sample belongs to the next round, gaps to the task only.
function performanceSampleOwner(sample, cases) {
  const time = Date.parse(sample?.timestamp);
  if (!Number.isFinite(time)) return -1;
  let owner = -1, latest = -Infinity;
  cases.forEach((record, index) => {
    const start = Date.parse(record.startedAt), end = Date.parse(record.endedAt);
    if (Number.isFinite(start) && Number.isFinite(end) && time >= start && time < end && start > latest) {
      owner = index; latest = start;
    }
  });
  return owner;
}

function attachPerformanceReportsToTaskCases(task = {}, performanceReports = {}) {
  const cases = task.cases || [];
  const reports = summarizePerformanceReports(performanceReports).performanceReports;
  const assigned = cases.map(() => ({}));
  for (const [target, report] of Object.entries(reports)) {
    for (const sample of report.samples) {
      const index = performanceSampleOwner(sample, cases);
      if (index >= 0) (assigned[index][target] ||= []).push(sample);
    }
  }
  const attributedReports = Object.fromEntries(Object.entries(reports).map(([target, report]) => {
    const samples = report.samples.map(sample => {
      const owner = performanceSampleOwner(sample, cases);
      return { ...sample, caseId: owner >= 0 ? cases[owner].caseId : '', attribution: owner >= 0 ? 'case' : 'task-only' };
    });
    return [target, { ...report, samples, sampleScope: { type: 'task', policy: 'start-inclusive-end-exclusive',
      unassignedSampleCount: samples.filter(sample => !sample.caseId).length } }];
  }));
  return { ...task, performanceReports: attributedReports, cases: cases.map((record, index) => {
    const runDir = record.artifacts?.runDir;
    if (!runDir || !record.endedAt || !fs.existsSync(runDir)) return record;
    const reportEntries = Object.entries(reports);
    if (!reportEntries.length) return record;
    // Only assigned sample changes require rewriting an already completed round.
    const revision = crypto.createHash('sha256').update(JSON.stringify(reportEntries.map(([target]) =>
      [target, assigned[index][target] || [], reports[target].crashes?.status, reports[target].crashes?.error, (reports[target].crashes?.events || []).filter(event => performanceSampleOwner(event, cases) === index)]))).digest('hex');
    if (record.artifacts.performanceRevision === revision) return record;
    const caseReports = Object.fromEntries(reportEntries.map(([target, report]) => {
      const reportPath = path.join(runDir, 'performance', `${target}.json`);
      const caseReport = summarizePerformanceReports({ [target]: {
        ...report, persistenceError: undefined, artifactPath: reportPath, samples: assigned[index][target] || [],
        crashes: report.crashes ? { ...report.crashes, artifactPath: undefined,
          events: report.crashes.events.filter(event => performanceSampleOwner(event, cases) === index),
          count: report.crashes.events.filter(event => performanceSampleOwner(event, cases) === index).length,
          targetCount: report.crashes.events.filter(event => performanceSampleOwner(event, cases) === index && event.isTarget).length,
        } : undefined,
        sampleScope: { type: 'case', caseId: record.caseId, start: record.startedAt, endExclusive: record.endedAt },
      } }).performanceReports[target];
      writeJsonAtomic(reportPath, caseReport);
      const { samples, ...summary } = caseReport;
      return [target, { ...summary, path: reportPath }];
    }));
    return { ...record, artifacts: { ...record.artifacts, performanceRevision: revision, performanceReports: caseReports } };
  }) };
}

// Each evidence file is copied once, shared by task and round reports. References are portable.
function packagePerformanceReports(reports = {}, packageRoot, evidenceRoot = process.cwd()) {
  return Object.fromEntries(Object.entries(reports).map(([target, report]) => [target, { ...report,
    artifactPath: undefined,
    crashes: report.crashes ? { ...report.crashes, artifactPath: undefined } : undefined,
    samples: (report.samples || []).map(sample => {
      if (!sample.rawEvidencePath) return sample;
      const source = path.resolve(evidenceRoot, sample.rawEvidencePath);
      const relative = `artifacts/performance-evidence/${crypto.createHash('sha256').update(source).digest('hex')}.json`;
      const dest = path.join(packageRoot, relative);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (!fs.existsSync(dest)) fs.copyFileSync(source, dest);
      return { ...sample, rawEvidencePath: relative };
    }),
  }]));
}
function packageCasePerformanceReports(runDir, packageRoot, originalRunDir = runDir) {
  let evidenceRoot = path.resolve(originalRunDir);
  while (!fs.existsSync(path.join(evidenceRoot, 'manifest.json')) && path.dirname(evidenceRoot) !== evidenceRoot) evidenceRoot = path.dirname(evidenceRoot);
  const directory = path.join(runDir, 'performance');
  if (!fs.existsSync(directory)) return;
  for (const name of fs.readdirSync(directory).filter(name => name.endsWith('.json'))) {
    const file = path.join(directory, name);
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    const target = report.target || path.basename(name, '.json');
    writeJsonAtomic(file, packagePerformanceReports({ [target]: report }, packageRoot, evidenceRoot)[target]);
  }
}

module.exports = {
  performanceOptionsSchema,
  uniquePerformanceSamples, performanceSampleOwner, packagePerformanceReports, packageCasePerformanceReports,
  validateWorkflowPerformanceTargets,
  attachPerformanceReportsToTaskCases,
  createWorkflowPerformanceCollector,
  summarizePerformanceReports,
};
