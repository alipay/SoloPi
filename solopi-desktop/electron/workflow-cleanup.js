// Cleanup is a separate, ordered finally region, never an outgoing business edge.
function partitionWorkflowSteps(steps = [], edges = []) {
  const cleanup = steps.filter(s => s.phase === 'cleanup');
  const main = steps.filter(s => s.phase !== 'cleanup');
  const ids = new Set(cleanup.map(s => s.id));
  for (const step of steps) {
    if (step.phase != null && !['main', 'cleanup'].includes(step.phase)) throw Object.assign(new Error(`未知执行区域：${step.phase}`), {code:'WORKFLOW_PHASE_INVALID'});
  }
  for (const step of cleanup) {
    if (['start', 'end', 'if', 'parallel', 'join'].includes(step.type)) throw Object.assign(new Error(`清理区域不支持控制节点：${step.id}`), {code:'WORKFLOW_CLEANUP_CONTROL_NODE'});
  }
  if (edges.some(e => ids.has(e.source || e.from) || ids.has(e.target || e.to))) throw Object.assign(new Error('清理区域按列表顺序执行，不能连接业务流程或包含手动连线。'), {code:'WORKFLOW_CLEANUP_EDGE_INVALID'});
  return {main, cleanup};
}

async function runCleanupSteps(steps, execute, onProgress = () => {}) {
  const results = [], warnings = [];
  const report = row => { try { onProgress(row); } catch(error) { warnings.push({stepId:row.stepId, error:error.message}); } };
  for (const original of steps) {
    // Ignore the cancelled business scope. Each cleanup command still has a
    // finite timeout and uses the same variables, device binding and components.
    const configuredTimeout = Number(original.timeoutMs);
    const step = {...original, timeoutMs: Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 30000};
    const startedAt = new Date().toISOString();
    report({stepId:step.id, stepName:`清理 · ${step.name || step.id}`, phase:'cleanup', status:'running', startedAt});
    let row;
    try {
      const output = await execute(step);
      if (output?.success === false || output?.branch === 'error' || output?.meta?.branch === 'error' || output?.meta?.assertion?.passed === false) {
        throw Object.assign(new Error(output.stderr || '清理节点未通过'), {code:'WORKFLOW_CLEANUP_STEP_FAILED', ...output});
      }
      row = {stepId:step.id, stepName:`清理 · ${step.name || step.id}`, phase:'cleanup', status:'success', startedAt,
        completedAt:output?.completedAt || new Date().toISOString(), endedAt:new Date().toISOString(),
        command:output?.command, stdout:output?.stdout, stderr:output?.stderr, meta:output?.meta};
    } catch (error) {
      row = {stepId:step.id, stepName:`清理 · ${step.name || step.id}`, phase:'cleanup', status:'failed', startedAt,
        completedAt:new Date().toISOString(), endedAt:new Date().toISOString(), error:error.message,
        errorCode:error.errorCode || error.code || '', command:error.command, stdout:error.stdout, stderr:error.stderr, meta:error.meta};
    }
    results.push(row);
    report(row);
  }
  return {status:results.some(r => r.status === 'failed') ? 'failed' : 'success', results, ...(warnings.length ? {warnings} : {})};
}

function attachCleanupResult(result, cleanup) {
  if (!result) return;
  result.cleanup = cleanup;
  result.results.push(...cleanup.results.filter(row => !result.results.includes(row)));
  if (cleanup.status === 'failed' && result.success) {
    result.success = false;
    result.error = '业务流程完成，但清理失败；请查看清理区域结果。';
    result.errorCode = 'WORKFLOW_CLEANUP_FAILED';
  }
}

// Legacy graphs sometimes routed their terminal paths through a cleanup node.
// Preserve those paths when cleanup becomes an independent finally region.
// Ambiguous ordering stays untouched for explicit review, never silently erased.
function migrateLegacyCleanupEdges(testCase, edges = []) {
  const unchanged = message => ({edges, changed:false, errors:[{code:'WORKFLOW_CLEANUP_MIGRATION_UNSAFE', message}]});
  let regions;
  try { regions = partitionWorkflowSteps(testCase.steps || [], []); }
  catch(error) { return {edges, changed:false, errors:[{code:error.code, message:error.message}]}; }
  const cleanup = new Set(regions.cleanup.map(step => step.id));
  const source = edge => edge.source || edge.from;
  const target = edge => edge.target || edge.to;
  if (!cleanup.size || !edges.some(edge => cleanup.has(source(edge)) || cleanup.has(target(edge)))) return {edges, changed:false, errors:[]};
  const nodes = new Map((testCase.steps || []).map(step => [step.id, step]));
  const outgoing = new Map();
  for (const edge of edges) {
    if (!nodes.has(source(edge)) || !nodes.has(target(edge))) return unchanged('清理连线引用了不存在的节点，未自动修改原图。');
    if (!cleanup.has(source(edge))) continue;
    const handle = edge.sourceHandle ?? edge.handle ?? edge.condition;
    if (handle != null && String(handle).trim() && String(handle).toLowerCase() !== 'default') return unchanged('清理节点仍有条件分支，需确认执行区域，未自动修改原图。');
    outgoing.set(source(edge), [...(outgoing.get(source(edge)) || []), edge]);
  }
  for (const links of outgoing.values()) if (links.length > 1) return unchanged('清理节点仍有多个后继，未自动选择分支或修改原图。');
  const exits = new Map();
  for (const id of cleanup) {
    const seen = new Set();
    let at = id, last;
    while (cleanup.has(at)) {
      if (seen.has(at)) return unchanged('清理连线形成环，未自动修改原图。');
      seen.add(at);
      const edge = (outgoing.get(at) || [])[0];
      if (!edge) { at = null; break; }
      last = edge;
      at = target(edge);
    }
    if (at && nodes.get(at)?.type !== 'end') return unchanged('清理节点仍连接后续业务操作，需确认执行顺序，未自动修改原图。');
    exits.set(id, at ? {id:at, edge:last} : null);
  }
  const migrated = [], keys = new Set();
  const add = edge => {
    const key = JSON.stringify([source(edge), target(edge), edge.sourceHandle ?? edge.handle ?? edge.condition ?? '', edge.targetHandle ?? '']);
    if (!keys.has(key)) { keys.add(key); migrated.push(edge); }
  };
  for (const edge of edges) {
    if (cleanup.has(source(edge))) continue;
    if (!cleanup.has(target(edge))) { add(edge); continue; }
    const exit = exits.get(target(edge));
    if (!exit) continue;
    const bridge = {...edge, id:`${edge.id || source(edge)}--finally--${exit.id}`, source:source(edge), target:exit.id};
    delete bridge.targetHandle;
    if (exit.edge.targetHandle != null) bridge.targetHandle = exit.edge.targetHandle;
    if (Object.hasOwn(edge, 'to')) bridge.to = exit.id;
    add(bridge);
  }
  const main = new Set(regions.main.map(step => step.id));
  const starts = regions.main.filter(step => step.type === 'start');
  if (starts.length !== 1) return unchanged('业务图开始节点不唯一，未自动修改原图。');
  const next = new Map(), incoming = new Map([...main].map(id => [id, 0]));
  for (const edge of migrated) {
    next.set(source(edge), [...(next.get(source(edge)) || []), target(edge)]);
    incoming.set(target(edge), incoming.get(target(edge)) + 1);
  }
  const reached = new Set(), pending = [starts[0].id];
  while (pending.length) {
    const id = pending.pop();
    if (reached.has(id)) continue;
    reached.add(id); pending.push(...(next.get(id) || []));
  }
  if (reached.size !== main.size) return unchanged('迁移后业务图仍有不可达节点，未自动覆盖原图。');
  const ready = [...incoming].filter(([, count]) => count === 0).map(([id]) => id);
  let processed = 0;
  while (ready.length) {
    const id = ready.pop(); processed++;
    for (const targetId of next.get(id) || []) {
      incoming.set(targetId, incoming.get(targetId) - 1);
      if (incoming.get(targetId) === 0) ready.push(targetId);
    }
  }
  if (processed !== main.size) return unchanged('迁移后业务图存在环，未自动覆盖原图。');
  return {edges:migrated, changed:true, errors:[]};
}

function moveWorkflowStepToPhase(testCase, edges, stepId, phase) {
  const step = testCase.steps.find(s => s.id === stepId);
  if (!step || !['main', 'cleanup'].includes(phase) || ['start','end','if','parallel','join'].includes(step.type)) throw new Error('请选择一个操作节点移动执行区域。');
  if ((step.phase || 'main') === phase) return {steps:testCase.steps, edges};
  let nextEdges = [...edges];
  let steps = testCase.steps.filter(s => s.id !== stepId);
  const moved = {...step, phase};
  if (phase === 'cleanup') {
    const incoming = edges.filter(e => e.target === stepId), outgoing = edges.filter(e => e.source === stepId);
    if (incoming.length > 1 || outgoing.length > 1) throw new Error('请先解除该节点的分支连线，再移动执行区域。');
    nextEdges = edges.filter(e => e.source !== stepId && e.target !== stepId);
    if (incoming.length && outgoing.length) nextEdges.push({...incoming[0], id:`${incoming[0].source}-${outgoing[0].target}`, target:outgoing[0].target});
    steps.push(moved);
  } else {
    const endIndex = steps.findIndex(s => s.type === 'end');
    const end = steps[endIndex];
    const incoming = nextEdges.filter(e => e.target === end?.id);
    if (incoming.length > 1) throw new Error('结束节点有多个分支，请先选择明确的插入位置。');
    steps.splice(endIndex < 0 ? steps.length : endIndex, 0, moved);
    if (incoming.length) nextEdges = nextEdges.filter(e => e !== incoming[0]).concat({...incoming[0], target:stepId}, {id:`${stepId}-${end.id}`, source:stepId, target:end.id});
  }
  partitionWorkflowSteps(steps, nextEdges);
  return {steps, edges:nextEdges};
}

module.exports = {partitionWorkflowSteps, runCleanupSteps, attachCleanupResult, moveWorkflowStepToPhase, migrateLegacyCleanupEdges};
