// Passive observer for scrcpy 3.x/4.0 and 4.1 video protocols. Never consumes or
// rewrites bytes sent to the native client. A complete media packet, rather
// than stdout or container flushing, proves that capture has started.
function observeScrcpyVideo(onFrame, onError = () => {}) {
  let header = Buffer.alloc(0), skip = 65, state = 'identity', remaining = 0, media = false, done = false, legacy = false;
  function push(chunk) {
    if (done) return;
    try {
      let offset = 0;
      while (offset < chunk.length && !done) {
        if (skip) {
          const count = Math.min(skip, chunk.length - offset); skip -= count; offset += count;
          if (!skip) state = 'codec';
          continue;
        }
        if (remaining) {
          const count = Math.min(remaining, chunk.length - offset); remaining -= count; offset += count;
          if (!remaining && media) { done = true; onFrame(); }
          continue;
        }
        const size = state === 'codec' ? 4 : state === 'geometry' ? 8 : 12;
        const count = Math.min(size - header.length, chunk.length - offset);
        header = Buffer.concat([header, chunk.subarray(offset, offset + count)]); offset += count;
        if (header.length !== size) continue;
        if (state === 'codec') {
          const codec = header.toString('ascii');
          if (!['h264', 'h265', '\0av1'].includes(codec)) throw Error('Unsupported scrcpy video codec metadata');
          state = 'geometry';
        } else if (state === 'geometry') {
          // Older servers put width/height immediately after the codec id;
          // 4.1 uses a session packet whose high flag bit identifies it.
          legacy = !(header.readUInt32BE() & 0x80000000);
          state = 'packet';
          if (!legacy) continue;
          if (!header.readUInt32BE() || !header.readUInt32BE(4)) throw Error('Invalid scrcpy video dimensions');
        } else {
          const flags = header.readBigUInt64BE();
          if (!legacy && (flags & (1n << 63n))) {
            if (!header.readUInt32BE(4) || !header.readUInt32BE(8)) throw Error('Invalid scrcpy video dimensions');
          } else {
            remaining = header.readUInt32BE(8);
            if (!remaining || remaining > 64 * 1024 * 1024) throw Error('Invalid scrcpy video packet size');
            media = !(flags & (1n << (legacy ? 63n : 62n)));
          }
        }
        header = Buffer.alloc(0);
      }
    } catch (error) { done = true; onError(error); }
  }
  return { push };
}
module.exports = { observeScrcpyVideo };
