const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
// Validate central-directory names/types/sizes before invoking the system extractor.
function validateReportArchive(buffer) {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { end = i; break; }
  }
  if (end < 0) throw new Error('Invalid report ZIP');
  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16), total = 0;
  if (count === 65535 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) throw new Error('Multi-volume/ZIP64 reports are unsupported');
  const names = new Set();
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid ZIP directory');
    const size = buffer.readUInt32LE(cursor + 24);
    const length = buffer.readUInt16LE(cursor + 28);
    const extra = buffer.readUInt16LE(cursor + 30), comment = buffer.readUInt16LE(cursor + 32);
    const mode = buffer.readUInt32LE(cursor + 38) >>> 16;
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + length);
    if (name === '.source.glassreport' || !name || /[\\\x00]/.test(name) || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').includes('..') || name.split('/').includes('.')) throw new Error('Unsafe report entry');
    if ((mode & 0xf000) && ![0x8000, 0x4000].includes(mode & 0xf000)) throw new Error('Report links/special files are prohibited');
    if (buffer.readUInt16LE(cursor + 8) & 1) throw new Error('Encrypted report is unsupported');
    const normalized = name.replace(/\/$/, '').toLowerCase();
    if (names.has(normalized)) throw new Error('Duplicate report entry');
    names.add(normalized); total += size;
    if (total > 2 * 1024 ** 3 || size > 1024 ** 3) throw new Error('Report exceeds extraction limit');
    cursor += 46 + length + extra + comment;
  }
  if (cursor !== end || !names.has('manifest.json') || !names.has('report.json')) throw new Error('Invalid report layout');
}
async function importReportPackage(packagePath, cacheDir) {
  if (fs.statSync(packagePath).size > 512 * 1024 ** 2) throw new Error('Report import limit is 512 MiB');
  const bytes = fs.readFileSync(packagePath);
  validateReportArchive(bytes);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  fs.mkdirSync(cacheDir, { recursive: true });
  const reportRoot = fs.mkdtempSync(path.join(cacheDir, 'import-'));
  fs.writeFileSync(path.join(reportRoot, '.metadata_never_index'), '');
  try {
    // Extract a frozen copy: the caller cannot change the validated archive mid-import.
    const archive = path.join(reportRoot, '.source.glassreport');
    fs.writeFileSync(archive, bytes);
    await exec('/usr/bin/unzip', ['-oq', archive, '-d', reportRoot], { timeout: 300000, maxBuffer: 1024 ** 2 });
    for (const name of ['manifest.json','report.json']) if(fs.statSync(path.join(reportRoot,name)).size > 32 * 1024 ** 2) throw new Error('Report JSON too large');
    const manifest = JSON.parse(fs.readFileSync(path.join(reportRoot, 'manifest.json')));
    const report = JSON.parse(fs.readFileSync(path.join(reportRoot, 'report.json')));
    if (manifest.schemaVersion !== 'glassbox.report-package.v1' || !report.task?.id || !Array.isArray(report.task.cases) || !['success','failed','stopped'].includes(report.task.status)) throw new Error('Invalid or non-terminal solopi-desktop report');
    return { manifest, reportRoot, path: archive, task: { ...report.task, id: `imported-${hash.slice(0,24)}`, sourceTaskId: report.task.id, readonly: true, imported: true, importedAt: new Date().toISOString(), reportPackagePath: archive, reportRoot } };
  } catch (error) { fs.rmSync(reportRoot, { recursive: true, force: true }); throw error; }
}
module.exports = { validateReportArchive, importReportPackage };
