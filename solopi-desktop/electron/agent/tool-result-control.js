'use strict';
// Archiving a large payload must not discard the operation's continuation contract.
function toolResultControl(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return {};
  const control = {};
  for (const key of ['taskId', 'commandId', 'operationId', 'requestId', 'receiptId', 'clientId', 'status']) {
    if (typeof result[key] === 'string') control[key] = result[key];
  }
  if (result.waiting && typeof result.waiting === 'object' && !Array.isArray(result.waiting)) {
    control.waiting = structuredClone(result.waiting);
  }
  return control;
}
module.exports = { toolResultControl };
