const fs = require('fs');
const path = require('path');

// Per-round disk retention: the UI ring is only a preview, never an assertion's authority.
function createWorkflowLogJournal(root, maxBytes = 512 * 1024 * 1024) {
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'stream-'));
  const file = path.join(directory, 'lines.jsonl');
  let fd = fs.openSync(file, 'wx+', 0o600), size = 0;
  let pending = [], pendingBytes = 0;
  const flush = () => {
    if (!pendingBytes) return;
    const data = Buffer.concat(pending, pendingBytes);
    let written = 0;
    while (written < data.length) written += fs.writeSync(fd, data, written, data.length - written, size + written);
    size += data.length; pending = []; pendingBytes = 0;
  };
  return {
    append(lines, firstSequence) {
      if (fd === null) throw new Error('日志留存已关闭。');
      const data = Buffer.from(lines.map((line, index) => JSON.stringify([firstSequence + index, line]) + '\n').join(''));
      if (size + pendingBytes + data.length > maxBytes) throw new Error('本轮日志留存超过容量限制，停止断言以避免遗漏日志。');
      pending.push(data); pendingBytes += data.length;
      if (pendingBytes >= 65536) flush();
    },
    *entriesAfter(sequence) {
      if (fd === null) throw new Error('日志留存已关闭。');
      flush();
      let end = size, carry = Buffer.alloc(0);
      while (end > 0) {
        const start = Math.max(0, end - 65536);
        const block = Buffer.alloc(end - start);
        fs.readSync(fd, block, 0, block.length, start);
        const data = Buffer.concat([block, carry]);
        let tail = data.length;
        for (let index = data.length - 1; index >= 0; index--) {
          if (data[index] !== 10) continue;
          if (index + 1 < tail) {
            const [seq, line] = JSON.parse(data.subarray(index + 1, tail).toString('utf8'));
            if (seq <= sequence) return;
            yield { line, sequence: seq };
          }
          tail = index;
        }
        carry = data.subarray(0, tail); end = start;
      }
      if (carry.length) {
        const [seq, line] = JSON.parse(carry.toString('utf8'));
        if (seq > sequence) yield { line, sequence: seq };
      }
    },
    reset() {
      if (fd === null) throw new Error('日志留存已关闭。');
      fs.ftruncateSync(fd, 0); size = 0; pending = []; pendingBytes = 0;
    },
    close() {
      if (fd === null) return;
      fs.closeSync(fd); fd = null; pending = []; pendingBytes = 0;
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}
module.exports = { createWorkflowLogJournal };
