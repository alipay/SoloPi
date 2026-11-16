// Single-case updates deliberately do not modify libraries or global components.
function mergeCaseUpdate(state, caseId, document, options = {}) {
  const patch = document?.case || document;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Expected a case JSON object');
  if (patch.id !== caseId) throw new Error('JSON case id must match the requested caseId');
  const existing = state.cases?.find((item) => item.id === caseId);
  if (options.create) {
    if (typeof caseId !== 'string' || !caseId.trim()) throw new Error('Case id is required');
    if (existing) throw new Error(`Case already exists: ${caseId}`);
    if (!state.caseLibraries?.some((item) => item.id === options.libraryId)) throw new Error('Target library not found');
    if (options.folderId && !state.caseFolders?.some((item) => item.id === options.folderId && item.libraryId === options.libraryId)) throw new Error('Target folder not found in library');
  } else if (!existing) throw new Error(`Case not found: ${caseId}`);
  const nextCase = require('./workflow-failure-policy').normalizeCaseFailurePolicy({ ...existing, ...patch }, state.components || []);
  if (options.create) {
    nextCase.libraryId = options.libraryId;
    nextCase.folderId = options.folderId || undefined;
  }
  if (!Array.isArray(nextCase.steps) || !nextCase.steps.length) throw new Error('Case steps must not be empty');
  const ids = new Set(nextCase.steps.map((step) => step?.id));
  if (ids.has(undefined) || ids.has('') || ids.size !== nextCase.steps.length) throw new Error('Step ids must be non-empty and unique');
  if (!nextCase.steps.some((step) => step.type === 'start') || !nextCase.steps.some((step) => step.type === 'end')) throw new Error('Case requires start and end steps');
  const edges = document?.case ? (document.edges ?? patch.edges) : patch.edges;
  const effectiveEdges = edges ?? state.caseEdges?.[caseId] ?? existing?.edges;
  if (effectiveEdges !== undefined && (!Array.isArray(effectiveEdges) || effectiveEdges.some((edge) => !ids.has(edge.source) || !ids.has(edge.target)))) throw new Error('Edges must reference existing steps; supply updated edges when removing steps');
  if (effectiveEdges !== undefined) nextCase.edges = effectiveEdges;
  if (nextCase.components !== undefined && !Array.isArray(nextCase.components)) throw new Error('Case components must be an array');
  const positions = document?.nodePositions;
  if (positions !== undefined && (!positions || typeof positions !== 'object' || Array.isArray(positions))) throw new Error('nodePositions must be an object');
  return {
    ...state,
    cases: options.create ? [...(state.cases || []), nextCase] : state.cases.map((item) => item.id === caseId ? nextCase : item),
    ...(effectiveEdges !== undefined ? { caseEdges: { ...state.caseEdges, [caseId]: effectiveEdges } } : {}),
    ...(positions !== undefined ? { nodePositions: { ...state.nodePositions, [caseId]: positions } } : {}),
  };
}

module.exports = { mergeCaseUpdate };
