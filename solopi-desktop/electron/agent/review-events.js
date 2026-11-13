// Only durable event metadata enters the agent wakeup; full results stay in reports.
const { rebuildTaskEvents, isAuthoritativeTaskTerminal } = require('../workflow-task-events');
function caseSummary(event, record) {
  const results=Array.isArray(event.results)?event.results:[];
  const failed=event.firstFailedNode || results.find(r=>r?.status==='failed');
  const error=typeof failed?.error==='string'?failed.error:'';
  const short=value=>require('./upstream-diagnostics').redactUpstreamMessage(String(value ?? ''))?.slice(0,256);
  const assertion=failed?.meta?.logTextAssertion;
  return {
    scope:'execution-summary',caseName:String(event.caseName || '').slice(0,256),
    stepCount:results.length,successfulSteps:results.filter(r=>r?.status==='success').length,
    plannedStepCount:event.plannedStepCount ?? (Array.isArray(record?.caseSnapshot?.steps)?record.caseSnapshot.steps.length:undefined),
    attemptedSteps:results.slice(0,16).map(r=>({stepId:short(r?.stepId),name:short(r?.stepName || r?.name),status:r?.status})),
    attemptedStepsTruncated:results.length>16,
    failedSteps:results.filter(r=>r?.status==='failed').length,
    ...(!failed && typeof event.error==='string' && event.error?{
      caseError:require('./upstream-diagnostics').redactUpstreamMessage(event.error)?.slice(0,1024),
      errorTruncated:event.error.length>1024,
    }:{}),
    ...(failed && typeof failed==='object'?{firstFailedStep:{
      stepId:failed.stepId,name:String(failed.stepName || failed.name || '').slice(0,256),
      error:require('./upstream-diagnostics').redactUpstreamMessage(error)?.slice(0,1024),
      errorTruncated:error.length>1024,errorCode:failed.errorCode,
      startedAt:failed.startedAt,completedAt:failed.completedAt || failed.endedAt,
      ...(assertion && typeof assertion==='object'?{logTextAssertion:{
        patternMatched:typeof assertion.patternMatched==='boolean'?assertion.patternMatched:undefined,
        lastExtractedText:assertion.lastExtractedText==null?null:short(assertion.lastExtractedText),
        expectedText:short(assertion.expectedText),matchOperator:short(assertion.matchOperator),
        valuesTruncated:[assertion.lastExtractedText,assertion.expectedText].some(v=>String(v ?? '').length>256),
      }}:{}),
    }}:{}),
  };
}
function reviewSnapshot(task) {
  const records=new Map((task.cases || []).map(c=>[c.caseId,c]));
  const terminal = ['success','failed','stopped'].includes(task.status);
  const status = terminal && !isAuthoritativeTaskTerminal(task) ? 'running' : task.status;
  return {status,
    ...(task.id && terminal && isAuthoritativeTaskTerminal(task) ? { executionReceipt: require('../task-case-query').taskResultReceipt(task,{limit:1}) } : {}),
    caseEvents:rebuildTaskEvents(task).filter(e=>e.type==='case_terminal').map(e=>({
    eventId:e.eventId,revision:e.revision,caseId:e.caseId,caseStatus:e.caseStatus,
    completed:e.completed,total:e.total,evidenceReady:!!e.evidenceReady,
    caseSummary:caseSummary(e,records.get(e.caseId)),
  }))};
}
module.exports={reviewSnapshot};
