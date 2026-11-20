const { createHash } = require('node:crypto');

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, stable(value[k])]));
  return value;
}
function libraryOf(state, item) {
  return item?.libraryId || state.caseFolders?.find(f => f.id === item?.folderId)?.libraryId || '';
}
function normalizeStep(step) {
  const config = { ...(step.config || {}) };
  for (const [oldKey, key] of [['captureGlassLog', 'captureGlassesLog'], ['recordGlassScreen', 'recordGlassesScreen'], ['showGlassScreen', 'showGlassesScreen']]) {
    if (config[key] === undefined && config[oldKey] !== undefined) config[key] = config[oldKey];
    delete config[oldKey];
  }
  return { ...step, device: step.device === 'glass' ? 'glasses' : step.device, config };
}
function digest(state, item, normalizeAssets) {
  if (!item) return null;
  item = require('./workflow-failure-policy').normalizeCaseFailurePolicy(item, state.components || []);
  const components = new Map((state.components || []).map(c => [c.id, c]));
  for (const component of item.components || []) components.set(component.id, component);
  const used = [...new Set((item.steps || []).map(s => s.componentId).filter(Boolean))].sort();
  const edges = [...(state.caseEdges?.[item.id] || item.edges || [])].map(e => ({ source: e.source, target: e.target, handle: e.sourceHandle ?? e.handle ?? e.condition ?? '' }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const content = { name: item.name, description: item.description, tags: item.tags, steps: (item.steps || []).map(normalizeStep), variables: item.variables || {}, defaults: item.defaults || {},
    components: used.map(id => components.get(id) || { id }), edges };
  const base = item.assetBaseDir || state.caseLibraries?.find(l=>l.id===libraryOf(state,item))?.localRepoPath;
  return createHash('sha256').update(JSON.stringify(stable(normalizeAssets ? normalizeAssets(content,base) : content))).digest('hex');
}
function conflict(caseIds, libraryId) {
  return Object.assign(new Error('用例库文件与已保存的本地用例修改冲突，已保留当前版本。请先比较差异并将当前版本同步到用例库，不能用刷新覆盖。'), {
    code: 'CASE_LIBRARY_LOCAL_EDITS_CONFLICT', caseIds, libraryId,
  });
}
function assertLibraryApplySafe(state, request) {
  const current = new Map((state.cases || []).map(c => [c.id, c]));
  const incoming = new Map((request.cases || []).map(c => [c.id, c]));
  const candidate = { ...state, components: request.components || state.components, caseEdges: request.caseEdges || {} };
  const normalizeAssets = require('./case-asset-identity').createAssetIdentity();
  const caseIds = Object.entries(state.caseEditGuards || {}).filter(([id, guard]) => guard.libraryId === request.libraryId
    && digest(state, current.get(id),normalizeAssets) !== digest(candidate, incoming.get(id),normalizeAssets)).map(([id]) => id);
  if (caseIds.length) throw conflict(caseIds, request.libraryId);
  const synchronizedCaseIds = Object.entries(state.caseEditGuards || {}).filter(([, g]) => g.libraryId === request.libraryId).map(([id]) => id);
  return { success: true, protectedCaseCount: synchronizedCaseIds.length, synchronizedCaseIds };
}
function guardStateWrite(next, previous, options = {}) {
  // A library cannot disappear while its folders/cases remain. This is not a
  // deletion: it merely hides live data from the library tree and selectors.
  const nextLibraries = new Set((next.caseLibraries || []).map(l => l.id));
  for (const library of previous.caseLibraries || []) {
    if (nextLibraries.has(library.id)) continue;
    if ((next.caseFolders || []).some(f => f.libraryId === library.id)
      || (next.cases || []).some(c => libraryOf(next, c) === library.id)) {
      throw Object.assign(new Error(`用例库「${library.name || library.id}」仍有关联目录或用例，不能仅移除库配置；已保留磁盘版本。`), {
        code: 'CASE_LIBRARY_REGISTRATION_MISSING', libraryId: library.id,
      });
    }
  }
  const guards = { ...(previous.caseEditGuards || {}) };
  // Task/status/layout saves do not edit business content. Avoid canonicalizing
  // every component and case again on those frequent renderer saves.
  if (!(options.caseIds || []).length
    && JSON.stringify([next.cases, next.components, next.caseEdges, next.caseFolders, next.caseLibraries])
      === JSON.stringify([previous.cases, previous.components, previous.caseEdges, previous.caseFolders, previous.caseLibraries])) {
    return { ...next, caseEditGuards: guards };
  }
  const oldCases = new Map((previous.cases || []).map(c => [c.id, c]));
  const newCases = new Map((next.cases || []).map(c => [c.id, c]));
  const refreshing = new Set((next.caseLibraries || []).filter(l => {
    const old = previous.caseLibraries?.find(p => p.id === l.id);
    return old && l.localRevision !== old.localRevision;
  }).map(l => l.id));
  const explicit = new Set(options.caseIds || []);
  const normalizeAssets = refreshing.size ? require('./case-asset-identity').createAssetIdentity() : undefined;
  for (const id of new Set([...oldCases.keys(), ...newCases.keys()])) {
    const old = oldCases.get(id), item = newCases.get(id);
    const libraryId = libraryOf(next, item) || libraryOf(previous, old);
    if (!libraryId) continue;
    const before = digest(previous, old), after = digest(next, item);
    if (before === after && !explicit.has(id)) continue;
    if (refreshing.has(libraryId) && !explicit.has(id)) {
      if (guards[id] && before !== after && digest(previous,old,normalizeAssets)!==digest(next,item,normalizeAssets)) throw conflict([id], libraryId);
      continue;
    }
    guards[id] = { libraryId, digest: after, source: options.source || 'editor', updatedAt: new Date().toISOString() };
  }
  return { ...next, caseEditGuards: guards };
}
module.exports = { digest, libraryOf, conflict, assertLibraryApplySafe, guardStateWrite };
