const { digest, libraryOf } = require('./case-edit-guard');
const { normalizeCaseFailurePolicy } = require('./workflow-failure-policy');

function captureUpload(payload) {
  if (!payload.libraryId || !Array.isArray(payload.sourceCases)) return null;
  const state = { components: payload.sourceComponents || [], caseEdges: payload.sourceCaseEdges || {}, cases: payload.sourceCases };
  const ids = (payload.cases || []).map(c => c.id).sort();
  if (JSON.stringify(ids) !== JSON.stringify(payload.sourceCases.map(c => c.id).sort()) || new Set(ids).size !== ids.length) {
    throw Error('上传源快照与导出用例集合不一致，未开始上传');
  }
  return { libraryId: payload.libraryId, digests: Object.fromEntries(payload.sourceCases.map(c => [c.id, digest(state, c)])) };
}

// Call only after a confirmed push and verification of the written workspace.
// Synchronize the exact exported representation, never a newer editor revision.
function reconcileUpload(state, snapshot, uploadedCases) {
  if (!snapshot) return { state, synchronizedCaseIds: [], skippedCaseIds: [], cases: [] };
  const uploaded = new Map(uploadedCases.map(c => [c.id, c]));
  const expected = Object.keys(snapshot.digests).sort();
  if (JSON.stringify([...uploaded.keys()].sort()) !== JSON.stringify(expected)) throw Error('上传回读的用例集合不一致，未确认本地同步');
  const synchronizedCaseIds = [], skippedCaseIds = [], replacements = new Map();
  for (const id of expected) {
    const current = state.cases?.find(c => c.id === id);
    if (!current || libraryOf(state, current) !== snapshot.libraryId || digest(state, current) !== snapshot.digests[id]) {
      skippedCaseIds.push(id); continue;
    }
    // Retain local ownership/base metadata; exported config/components/edges are authoritative for this receipt.
    replacements.set(id, { ...uploaded.get(id), libraryId: current.libraryId, folderId: current.folderId, assetBaseDir: current.assetBaseDir });
    synchronizedCaseIds.push(id);
  }
  const guards = { ...state.caseEditGuards };
  const caseEdges = { ...state.caseEdges };
  for (const id of synchronizedCaseIds) {
    delete guards[id];
    const c = normalizeCaseFailurePolicy(replacements.get(id), state.components || []);
    replacements.set(id, c);
    if (Array.isArray(c.edges)) caseEdges[id] = c.edges;
  }
  return {
    state: synchronizedCaseIds.length ? { ...state, cases: state.cases.map(c => replacements.get(c.id) || c), caseEditGuards: guards, caseEdges } : state,
    synchronizedCaseIds, skippedCaseIds, cases: [...replacements.values()],
  };
}
module.exports = { captureUpload, reconcileUpload };
