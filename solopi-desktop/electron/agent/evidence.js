const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
async function searchTaskLog(task, { deviceType, fileIndex, query = '', fromLine = 1, limit = 80, timeText = '', startTime, endTime }, signal) {
  // Only logs explicitly owned by this task may be read. No arbitrary filesystem paths.
  if (startTime && endTime && startTime > endTime) throw Error('跨午夜请分成两次时间范围查询');
  const records = [...(task.taskLogs || task.logs || []), ...(task.artifacts?.logs || []),
    ...(task.cases || []).flatMap(c => c.artifacts?.logs || [])];
  const selected=require('./log-source').select(task,{fileIndex,deviceType});if(selected.error)return selected.error;
  const {file,files}=selected;
  const stat = await fs.promises.stat(file);
  if (!stat.isFile() || stat.size > 512 * 1024 ** 2) throw Error('日志不是普通文件或超过512MiB');
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const matches = []; let line = 0; let hasMore = false;
  try {
    for await (const text of lines) {
      signal?.throwIfAborted();
      line++;
      const time = text.match(/\b(\d{2}:\d{2}:\d{2})/)?.[1];
      if ((startTime || endTime) && (!time || (startTime && time < startTime) || (endTime && time > endTime))) continue;
      if (line < fromLine || !text.includes(query) || (timeText && !text.includes(timeText))) continue;
      if (matches.length >= limit) { hasMore = true; break; }
      matches.push({ line, text: text.slice(0, 4000) });
    }
  } finally { lines.close(); stream.destroy(); }
  return { success: true, file, files, deviceType:selected.deviceType, matches,
    nextLine: hasMore ? matches.at(-1).line + 1 : null };
}
function recordingReceipt(item) {
  const receipt=Object.fromEntries(['deviceType','serial','path','sourcePath','success','evidenceReady','error','errorCode','sizeBytes','segmentationPhase','partial','sourceErrorCode','sourceError','sourceExitCode','exitCode','signal'].filter(key=>item?.[key]!==undefined).map(key=>[key,item[key]]));
  if(typeof item?.scrcpyOutput==='string')receipt.outputPreview=item.scrcpyOutput.slice(-1500);
  return receipt;
}
function taskOverview(task, {caseIds, statuses, offset=0, limit=20, view='details'}={}) {
  const {selectTaskCases,caseQueryOverview,taskPerformanceOverview}=require('../task-case-query');
  const options={caseIds,statuses,offset,limit};
  if(view==='cases')return require('../task-case-query').caseListOverview(task,{caseIds,statuses,offset,limit});
  if(view==='steps'){const {all,page,...selection}=selectTaskCases(task,options);return {id:task.id,...selection,selectionComplete:selection.offset===0&&selection.nextOffset===null&&!selection.missingCaseIds.length,returnedCaseCount:page.length,executionResultsOnly:true,cases:page.map(c=>require('./case-evidence-summary').compactCaseSteps(c))};}
  if (!['summary','details'].includes(view)) throw Error('报告view必须为summary或details');
  if (view==='summary') return caseQueryOverview(task,options);
  const {all,page,...selection}=selectTaskCases(task,options);
  return { id: task.id, name: task.name, status: task.status, taskType: task.taskType, performanceOptions:task.performanceOptions, startOptions:task.startOptions, recordingSession:task.recordingSession?{schemaVersion:task.recordingSession.schemaVersion,finalizedAt:task.recordingSession.finalizedAt,sourceRecordings:(task.recordingSession.sourceRecordings || []).map(recordingReceipt)}:undefined, stress: task.stress || null, error: task.error, errorCode:task.errorCode, errorType:task.errorType, stopReason:task.stopReason, stopCause:task.stopCause, summary: task.summary,
    ...selection,
    reportDetailPath: task.reportDetailPath, ...taskPerformanceOverview(task),
    cases: page.map(c => ({ id: c.id, caseId: c.caseId, name: c.caseName || c.name || c.caseSnapshot?.name, status: c.status, error: c.error,
      recordingConfig: (()=>{const config=c.caseSnapshot?.steps?.find(step=>step.type==='start')?.config;return config || task.startOptions ? {recordPhoneScreen:task.startOptions?.recordPhoneScreen ?? config?.recordPhoneScreen,recordGlassesScreen:task.startOptions?.recordGlassesScreen ?? config?.recordGlassesScreen}:undefined;})(),
      caseRecordingConfig:c.caseSnapshot?.steps?.find(step=>step.type==='start')?.config ? {recordPhoneScreen:c.caseSnapshot.steps.find(step=>step.type==='start').config.recordPhoneScreen,recordGlassesScreen:c.caseSnapshot.steps.find(step=>step.type==='start').config.recordGlassesScreen}:undefined,
      recordings:(c.artifacts?.recordings || []).map(recordingReceipt), recordingsPending:c.artifacts?.recordingsPending,
      failedSteps: (c.results || []).filter(r => r.success === false || r.status === 'failed').map(r => ({ stepId: r.stepId, name: r.stepName || r.name, error: r.error })) })) };
}
module.exports = { searchTaskLog, taskOverview };
