// Encrypted ownership capabilities are available only to the desktop main process.
const fs = require('node:fs');
const path = require('node:path');
const { privateFile } = require('./credential-storage');

function createVirtualRecoveryStore({ directory, storage }) {
  function location(owner, create = false) {
    // Code security: the identifier is an internally generated conversation ID, never a path.
    if (typeof owner !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(owner)) throw Error('invalid_virtual_owner');
    const root = path.resolve(directory(), 'virtual-recovery');
    if (create) fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(root)) throw Object.assign(Error('virtual_recovery_unavailable'), {code:'ENOENT'});
    privateFile(root, { directory:true });
    const file = path.resolve(root, owner + '.bin');
    if (path.dirname(file) !== root) throw Error('invalid_virtual_owner');
    return file;
  }
  function save(owner, value) {
    const file = location(owner, true);
    if (!value || !value.config || typeof value.ownerToken !== 'string' || !/^[0-9a-f]{64}$/.test(value.ownerToken))
      throw Error('virtual_recovery_unavailable');
    const bytes = storage.encryptString(JSON.stringify({ version:1, owner, config:value.config, ownerToken:value.ownerToken }));
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > 65536) throw Error('virtual_recovery_storage_unavailable');
    // Code security: write before device dispatch; do not overwrite a prior uncertain owner.
    const fd = fs.openSync(file, 'wx', 0o600);
    let saved = false;
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); saved = true; }
    finally {
      fs.closeSync(fd);
      // No start can have been sent yet; an incomplete new record must not block a later attempt.
      if (!saved) try { fs.unlinkSync(file); } catch { /* Caller still receives the write failure. */ }
    }
  }
  function load(owner) {
    const file = location(owner);
    const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    let bytes;
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > 65536 || (process.platform !== 'win32' &&
          ((stat.mode & 0o077) || stat.uid !== process.getuid()))) throw Error('virtual_recovery_unavailable');
      bytes = fs.readFileSync(fd);
    } finally { fs.closeSync(fd); }
    let value;
    try { value = JSON.parse(storage.decryptString(bytes)); }
    catch { throw Error('virtual_recovery_unavailable'); }
    if (!value || value.version !== 1 || value.owner !== owner || !value.config
        || typeof value.ownerToken !== 'string' || !/^[0-9a-f]{64}$/.test(value.ownerToken))
      throw Error('virtual_recovery_unavailable');
    return { config:value.config, ownerToken:value.ownerToken };
  }
  function remove(owner) {
    const file = location(owner);
    // Code security: do not follow a substituted link when discarding a capability.
    privateFile(file);
    fs.unlinkSync(file);
  }
  return { save, load, remove };
}
module.exports = { createVirtualRecoveryStore };
