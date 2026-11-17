// Browser-safe optimistic concurrency guard: compare editor values, not React references.
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter(key => value[key] !== undefined).map(key => [key, stable(value[key])]));
  return value;
}
function captureLibraryRefreshState(state) {
  return JSON.stringify(stable({ cases: state.cases, caseEdges: state.caseEdges,
    components: state.components, caseFolders: state.caseFolders, nodePositions: state.nodePositions,
    // Sync receipts/timestamps/revision metadata may change without any editor changes.
    caseLibraries: (state.caseLibraries || []).map(library => ({ id: library.id, repoUrl: library.repoUrl,
      branch: library.branch, gitBranch: library.gitBranch, localRepoPath: library.localRepoPath,
      localComponentIds: library.localComponentIds })) }));
}
function assertLibraryRefreshState(snapshot, latest) {
  if (snapshot !== captureLibraryRefreshState(latest)) throw Object.assign(
    new Error('检查期间页面内容已更新，已保留当前版本。请重新比较更新。'),
    { code: 'CASE_LIBRARY_EDITOR_CHANGED' });
}
module.exports = { captureLibraryRefreshState, assertLibraryRefreshState };
