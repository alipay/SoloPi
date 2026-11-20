const fs = require('node:fs');
// Keep startup context and the latest evidence even for long recordings. The
// sidecar is written synchronously so an application crash retains the last event.
function createRecordingDiagnostics(recordingPath, identity = {}, options = {}) {
  const events = [], started = process.hrtime.bigint();
  const diagnosticPath = recordingPath ? `${recordingPath}.diagnostics.jsonl` : '';
  const maxBytes = options.maxBytes || 4 * 1024 * 1024;
  let sequence = 0, bytes = 0, writeError = '';
  function record(entry) {
    const event = { ...identity, ...entry, sequence: ++sequence, time: new Date().toISOString(), elapsedMs: Number(process.hrtime.bigint() - started) / 1e6 };
    require('./diagnostics').record({event:'recording.phase',taskId:identity.taskId,stage:entry.phase,code:entry.errorCode,durationMs:event.elapsedMs});
    events.push(event);
    if (events.length > 256) events.splice(64, 1);
    if (!diagnosticPath) return event;
    try {
      const line = JSON.stringify(event) + '\n';
      if (bytes + Buffer.byteLength(line) > maxBytes) {
        fs.renameSync(diagnosticPath, `${diagnosticPath}.previous`); bytes = 0;
      }
      fs.appendFileSync(diagnosticPath, line, {mode:0o600}); bytes += Buffer.byteLength(line);
    } catch (error) { writeError = `${error.code || 'WRITE_ERROR'}: ${error.message}`; }
    return event;
  }
  record({phase:'diagnostics-start',schemaVersion:'glassbox.recording-diagnostics.v1',platform:process.platform});
  return {events,record,path:diagnosticPath,get writeError(){return writeError;}};
}
module.exports = {createRecordingDiagnostics};
