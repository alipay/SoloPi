const { parentPort } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
parentPort.on('message', ({ id, file, task }) => {
  const temporary = `${file}.${process.pid}.${id}.pending`;
  try {
    const started = performance.now();
    const serialized = JSON.stringify(task);
    const serializedAt = performance.now();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temporary, serialized, { mode: 0o600 });
    fs.renameSync(temporary, file);
    parentPort.postMessage({ id, metrics: { serializeMs: serializedAt - started,
      diskWriteMs: performance.now() - serializedAt, bytes: Buffer.byteLength(serialized) } });
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch (_) {}
    parentPort.postMessage({ id, error: { message: error.message, code: error.code } });
  }
});
