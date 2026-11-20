const fs = require('node:fs');
const zlib = require('node:zlib');
const LIMITS = { archive: 512 * 1024 ** 2, entry: 256 * 1024 ** 2, total: 1024 ** 3, count: 10000, ratio: 300 };
const crcTable = Array.from({ length: 256 }, (_, i) => { for (let j = 0; j < 8; j++) i = i & 1 ? 0xedb88320 ^ (i >>> 1) : i >>> 1; return i >>> 0; });
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function inspectZip(bytes, limits = LIMITS) {
  if (bytes.length > limits.archive) throw Error('ZIP 超过 512 MiB 限制');
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  if (end < 0) throw Error('无效 ZIP 目录');
  const count = bytes.readUInt16LE(end + 10), offset = bytes.readUInt32LE(end + 16), size = bytes.readUInt32LE(end + 12);
  if (count === 65535 || count > limits.count || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 8) !== count || offset + size !== end) throw Error('不支持多卷、ZIP64 或超限 ZIP');
  const entries = [], names = new Set(), ranges = []; let cursor = offset, total = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) throw Error('ZIP 目录损坏');
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10), crc = bytes.readUInt32LE(cursor + 16);
    const compressed = bytes.readUInt32LE(cursor + 20), length = bytes.readUInt32LE(cursor + 24), n = bytes.readUInt16LE(cursor + 28), extra = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32);
    const mode = bytes.readUInt32LE(cursor + 38) >>> 16, local = bytes.readUInt32LE(cursor + 42);
    if (cursor + 46 + n + extra + comment > end) throw Error('ZIP 条目越界');
    const name = bytes.toString('utf8', cursor + 46, cursor + 46 + n), key = name.normalize('NFC').toLowerCase().replace(/\/$/, '');
    if (!name || /[\\\x00-\x1f]/.test(name) || name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').some(p => p === '.' || p === '..') || names.has(key)) throw Error('ZIP 包含不安全或重复路径');
    names.add(key);
    if ((flags & 1) || ![0, 8].includes(method) || ((mode & 0xf000) && ![0x8000, 0x4000].includes(mode & 0xf000))) throw Error('ZIP 不支持加密、链接、特殊文件或此压缩格式');
    total += length;
    if (length > limits.entry || total > limits.total || length / Math.max(1, compressed) > limits.ratio) throw Error('ZIP 解压大小或压缩比超限');
    if (local + 30 > offset || bytes.readUInt32LE(local) !== 0x04034b50) throw Error('ZIP 本地头损坏');
    const ln = bytes.readUInt16LE(local + 26), le = bytes.readUInt16LE(local + 28), start = local + 30 + ln + le;
    if (start + compressed > offset || bytes.toString('utf8', local + 30, local + 30 + ln) !== name || bytes.readUInt16LE(local + 8) !== method || bytes.readUInt16LE(local + 6) !== flags) throw Error('ZIP 本地头与目录不一致');
    if (!(flags & 8) && (bytes.readUInt32LE(local + 18) !== compressed || bytes.readUInt32LE(local + 22) !== length || bytes.readUInt32LE(local + 14) !== crc)) throw Error('ZIP 大小或校验字段不一致');
    ranges.push([local, start + compressed]); entries.push({ name, start, compressed, length, method, crc }); cursor += 46 + n + extra + comment;
  }
  if (cursor !== end) throw Error('ZIP 目录长度不一致');
  ranges.sort((a,b) => a[0]-b[0]); for(let i=1;i<ranges.length;i++) if(ranges[i][0]<ranges[i-1][1]) throw Error('ZIP 条目重叠');
  return entries;
}
function readEntry(bytes, entry) {
  const compressed = bytes.subarray(entry.start, entry.start + entry.compressed);
  const data = entry.method === 0 ? compressed : zlib.inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.length) });
  if (data.length !== entry.length || crc32(data) !== entry.crc) throw Error(`ZIP 内容校验失败：${entry.name}`);
  return data.toString('utf8');
}
function readBugreport(file) {
  if (fs.statSync(file).size > LIMITS.archive) throw Error('ZIP 超过 512 MiB 限制');
  const bytes = fs.readFileSync(file), entries = inspectZip(bytes);
  // Choose a single authoritative dump, avoiding overlapping secondary log buffers/files.
  const candidates = entries.filter(e => /(?:^|\/)bugreport[^/]*\.txt$/i.test(e.name));
  if (candidates.length !== 1) throw Error('ZIP 必须包含一份 bugreport*.txt 主报告（不合并多个报告）');
  return { name: candidates[0].name, text: readEntry(bytes, candidates[0]), entries: entries.length };
}
module.exports = { LIMITS, inspectZip, readEntry, readBugreport, crc32 };
