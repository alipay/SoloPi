'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { acquireConfigurationLock } = require('../configuration-lock.js');
const { ConnectorError } = require('./transport.cjs');
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
function installationId() {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let time = BigInt(Date.now()), prefix = '';
  for (let i = 0; i < 10; i++) { prefix = alphabet[Number(time & 31n)] + prefix; time >>= 5n; }
  return prefix + [...crypto.randomBytes(16)].map(n => alphabet[n & 31]).join('');
}
function privatePath(file, directory = false) {
  const st = fs.lstatSync(file);
  if (st.isSymbolicLink() || (directory ? !st.isDirectory() : !st.isFile()) || (process.platform !== 'win32' && ((st.mode & 0o077) !== 0 || st.uid !== process.getuid()))) throw new ConnectorError('STATE_PERMISSIONS');
}
function openIdentity(directory) {
  if (process.platform === 'win32') throw new ConnectorError('WINDOWS_CREDENTIAL_ADAPTER_REQUIRED');
  directory = path.resolve(directory);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); privatePath(directory, true);
  const release = acquireConfigurationLock(directory, { ignoreSingleton: true });
  const file = path.join(directory, 'identity.json');
  try {
    let state;
    if (fs.existsSync(file) || (() => { try { fs.lstatSync(file); return true; } catch { return false; } })()) {
      privatePath(file); state = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (state.version !== 1 || !ULID.test(state.installationId)) throw new ConnectorError('STATE_INVALID');
      if (!['new', 'pending', 'approved', 'rejected', 'revoked'].includes(state.phase) || (state.enrollmentId && !ULID.test(state.enrollmentId)) || (state.clientId && !ULID.test(state.clientId)) || (state.lastEpoch !== undefined && (!Number.isSafeInteger(state.lastEpoch) || state.lastEpoch < 1))) throw new ConnectorError('STATE_INVALID');
      if (crypto.createPrivateKey(state.privateKeyPem).asymmetricKeyType !== 'ed25519') throw new ConnectorError('STATE_INVALID');
      const pub = crypto.createPublicKey(crypto.createPrivateKey(state.privateKeyPem)).export({ type: 'spki', format: 'pem' });
      if (pub !== state.publicKeyPem) throw new ConnectorError('STATE_INVALID');
    } else {
      const pair = crypto.generateKeyPairSync('ed25519');
      state = { version: 1, installationId: installationId(), publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }), privateKeyPem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), phase: 'new' };
    }
    function save() {
      const tmp = `${file}.${crypto.randomBytes(12).toString('hex')}.tmp`;
      const fd = fs.openSync(tmp, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(state)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      try { fs.renameSync(tmp, file); const dirFd = fs.openSync(directory, 'r'); try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); } } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
    }
    save();
    return { state, save, close: release, fingerprint: () => 'sha256:' + crypto.createHash('sha256').update(crypto.createPublicKey(state.publicKeyPem).export({ type: 'spki', format: 'der' })).digest('base64url'), sign: (purpose, challenge) => crypto.sign(null, Buffer.from(purpose + '|' + challenge), state.privateKeyPem).toString('base64') };
  } catch (e) { release(); throw e; }
}
module.exports = { openIdentity, ULID };
