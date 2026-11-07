// Shared CLI / Agent projection. Filter before paging, preserve whole-task totals.
const CASE_STATUSES = ['pending', 'running', 'success', 'failed', 'stopped'];
function selectTaskCases(task, {caseIds, statuses, offset=0, limit=20}={}) {
  if (!Number.isSafeInteger(offset) || offset<0 || !Number.isSafeInteger(limit) || limit<1 || limit>50) throw Error('报告分页需要 offset>=0，limit为1–50');
  for (const values of [caseIds,statuses]) if (values!==undefined && (!Array.isArray(values) || !values.length || values.some(v=>typeof v!=='string'||!v.length))) throw Error('报告筛选必须是非空字符串数组');
  if (statuses?.some(status=>!CASE_STATUSES.includes(status))) throw Error(`用例状态必须为 ${CASE_STATUSES.join('|')}`);
  const all=task.cases || [];
  const filtered=all.filter(c=>(!caseIds || caseIds.includes(c.caseId || c.id)) && (!statuses || statuses.includes(c.status)));
  return {all, page:filtered.slice(offset,offset+limit),totalCaseCount:all.length,matchedCaseCount:filtered.length,offset,
    nextOffset:offset+limit<filtered.length?offset+limit:null,
    missingCaseIds:caseIds?.filter(id=>!all.some(c=>(c.caseId || c.id)===id)) || [],filters:{statuses:statuses || [],caseIds:caseIds || []}};
}
function artifactLinks(items=[]) {
  const seen=new Set();
  return items.flatMap(item=>{
    const path=item.path || item.outputPath || item.filePath || item.url;
    if(!path || seen.has(path)) return [];
    seen.add(path);
    return [{path,...(item.deviceType?{deviceType:item.deviceType}:{}),...(typeof item.success==='boolean'?{success:item.success}:{}),
      ...(typeof item.evidenceReady==='boolean'?{evidenceReady:item.evidenceReady}:{})}];
  });
}
// Summary/detail views retain sampling receipts; the case index omits this payload.
function taskPerformanceOverview(task) {
  const reports = task.performanceReports || {};
  const performanceTargets = Object.keys(reports);
  const performanceReports = Object.fromEntries(performanceTargets.map(target => {
    const report = reports[target];
    const samples = Array.isArray(report.samples) ? report.samples : [];
    const sampleCount = report.sampleCount ?? samples.length;
    const failedSampleCount = report.failedSampleCount ?? samples.filter(sample => sample.error).length;
    const validSampleCount = report.validSampleCount ?? (sampleCount - failedSampleCount);
    const status = report.status || (validSampleCount ? (failedSampleCount ? 'partial' : 'success') : failedSampleCount ? 'failed' : 'pending');
    return [target, { target, status, serial: report.serial, packageName: report.packageName,
      sampleCount, validSampleCount, failedSampleCount, artifactPath: report.artifactPath,
      errorCode: report.errorCode || '', error: report.error || '',
      firstSampleAt: samples[0]?.timestamp, lastSampleAt: samples.at(-1)?.timestamp }];
  }));
  const statuses = Object.values(performanceReports).map(report => report.status);
  const configured = ['phone', 'glasses'].some(role => task.performanceOptions?.[role] === true);
  const performanceStatus = !statuses.length ? (configured ? 'pending' : 'disabled')
    : statuses.every(status => status === 'success') ? 'success'
    : statuses.every(status => status === 'failed') ? 'failed'
    : statuses.every(status => status === 'pending') ? 'pending' : 'partial';
  return { performanceOptions: task.performanceOptions, performanceTargets, performanceStatus, performanceReports };
}
function caseQueryOverview(task, options={}) {
  const {all,page,...selection}=selectTaskCases(task,options);
  const logs=artifactLinks(task.taskLogs || task.logs || task.artifacts?.logs);
  return {id:task.id,name:task.name,status:task.status,summary:task.summary,...taskPerformanceOverview(task),...selection,
    logs,
    cases:page.map(c=>{
      const error=String(c.error || ''),name=String(c.caseName || c.name || c.caseSnapshot?.name || '');
      const failed=(c.results || []).filter(r=>r.success===false || r.status==='failed');
      return {id:c.id,caseId:c.caseId,name:name.slice(0,160),status:c.status,error:error.slice(0,240),
        ...(name.length>160?{nameTruncated:true}:{}),...(error.length>240?{errorTruncated:true}:{}),
        failedStepCount:failed.length,firstFailedStepId:failed[0]?.stepId,
        recordings:artifactLinks(c.artifacts?.recordings),logs:(c.artifacts?.logs || []).flatMap(item=>{
          const taskLogIndex=logs.findIndex(log=>log.path===(item.path || item.outputPath || item.filePath || item.url));
          return item.sharedTaskLog && taskLogIndex>=0 ? [{taskLogIndex,startSequence:item.startSequence,endSequence:item.endSequence}] : artifactLinks([item]);
        })};
    })};
}
// Deterministic delivery receipt: model analysis and raw artifacts are not needed
// to recover an independently completed test execution.
function taskResultReceipt(task, { offset = 0, limit = 10 } = {}) {
  if (!task || typeof task.id !== 'string' || !task.id) throw Error('任务结果缺少 taskId');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw Error('结果摘要 limit 必须为 1–20');
  const selected = selectTaskCases(task, { statuses: ['failed', 'stopped'], offset, limit });
  const count = status => selected.all.filter(c => c.status === status).length;
  const reportedTotal = task.total ?? task.summary?.caseCount ?? selected.all.length;
  const total = Math.max(Number.isSafeInteger(reportedTotal) && reportedTotal >= 0 ? reportedTotal : 0, selected.all.length);
  const counts = { total, completed: count('success') + count('failed') + count('stopped'),
    success: count('success'), failed: count('failed'), stopped: count('stopped'), pending: count('pending'), running: count('running') };
  counts.unknown = total - counts.completed - counts.pending - counts.running;
  const countsComplete = counts.unknown === 0;
  const terminal = ['success', 'failed', 'stopped'].includes(task.status);
  const text = (value, max) => String(value || '').slice(0, max);
  return { schemaVersion: 'glassbox.task.result.v1', success: true, successScope: 'query',
    observedAt: new Date().toISOString(),
    taskId: task.id, taskName: text(task.name, 200), status: task.status, terminal,
    executionComplete: terminal && countsComplete && counts.completed === total,
    counts, countsComplete, countsSource: 'loaded-case-records',
    passRatePercent: terminal && countsComplete && counts.completed === total && total > 0 ? Math.round(counts.success / total * 10000) / 100 : null,
    devices: Object.fromEntries(['phone', 'glasses'].flatMap(role => {
      const device = task.devices?.[role];
      return device ? [[role, { serial: text(device.serial, 200), packageName: text(device.packageName, 240) }]] : [];
    })),
    reportPackagePath: String(task.reportPackage?.path || task.reportPackagePath || ''),
    failureCount: selected.matchedCaseCount, offset, nextOffset: selected.nextOffset,
    failures: selected.page.map(c => {
      const failed = (c.results || []).find(r => r.status === 'failed' || r.success === false);
      const error = String(c.error || failed?.error || '');
      return { caseId: c.caseId || c.id, executionId: c.id, name: text(c.caseName || c.name, 160), status: c.status,
        firstFailedStepId: failed?.stepId || '', errorCode: text(c.errorCode || failed?.errorCode, 100),
        error: error.slice(0, 240), errorTruncated: error.length > 240 };
    }),
    // A fixed, data-derived receipt. It is safe to deliver even if the LLM fails.
    deliveryText: `任务 ${task.id}：${task.status}，已完成 ${counts.completed}/${total}，成功 ${counts.success}、失败 ${counts.failed}、停止 ${counts.stopped}${countsComplete ? '' : `，另有 ${counts.unknown} 条结果未知`}。`,
  };
}
module.exports={CASE_STATUSES,selectTaskCases,caseQueryOverview,taskPerformanceOverview,taskResultReceipt};

// Whole-case pages: large attachment paths never force character pagination.
function caseListOverview(task,options={}) {
  const {all,page,...selection}=selectTaskCases(task,options);
  const rows=page.map(c=>{
    const failed=(c.results || []).find(r=>r.success===false || r.status==='failed');
    const error=String(c.error || failed?.error || '');
    return {caseId:c.caseId || c.id,name:String(c.caseName || c.name || c.caseSnapshot?.name || ''),status:c.status,firstFailedStepId:failed?.stepId,error:error.slice(0,240),...(error.length>240?{errorTruncated:true}:{})};
  });
  const result={id:task.id,name:task.name,status:task.status,summary:task.summary,...selection,cases:[],returnedCaseCount:0,pageComplete:false,selectionComplete:false};
  for(const row of rows){
    if(result.cases.length && JSON.stringify({...result,cases:[...result.cases,row]}).length>10000)break;
    result.cases.push(row);
  }
  result.returnedCaseCount=result.cases.length;
  result.nextOffset=selection.offset+result.cases.length<selection.matchedCaseCount?selection.offset+result.cases.length:null;
  result.pageComplete=result.nextOffset===null;
  result.selectionComplete=selection.offset===0 && result.pageComplete && !selection.missingCaseIds.length;
  return result;
}
module.exports.caseListOverview=caseListOverview;
