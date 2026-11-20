'use strict';

// A readable execution report is independent of the portable archive export.
async function finalizeTaskReport(task, {persist, flush, exportPackage, onReady = async () => {}, finalizeArtifacts = async value => value}) {
  const ready = {...task, reportPackageStatus:'exporting'};
  persist(ready);
  await flush();
  // Let result transport acknowledge the readable execution before archive work can occupy the event loop.
  await onReady(ready);
  const finalized = await finalizeArtifacts(ready);
  if (finalized !== ready) { persist(finalized); await flush(); }
  const exported = await exportPackage(finalized);
  const complete = {...exported, reportPackageStatus:exported.reportPackage?.success ? 'ready' : 'failed'};
  persist(complete);
  await flush();
  return complete;
}

module.exports = {finalizeTaskReport};
