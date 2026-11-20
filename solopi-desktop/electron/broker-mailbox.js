// Transport CLI requests to the configuration owner when Electron's singleton
// discovery differs between desktop and headless display sessions.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');

const directoryName = '.broker-requests';

function forwardRequest(directory, request) {
  const owner = JSON.parse(fs.readFileSync(path.join(directory, '.configuration-owner.json'), 'utf8'));
  if (owner.host !== os.hostname() || !Number.isInteger(owner.pid) || owner.pid < 1) return false;
  process.kill(owner.pid, 0);
  if (!owner.mailbox || request.dataDir !== directory) return false;
  const inbox = path.join(directory, directoryName);
  const stat = fs.lstatSync(inbox);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
  const id = crypto.randomUUID();
  const temporary = path.join(inbox, `${id}.tmp`);
  fs.writeFileSync(temporary, JSON.stringify({ ownerPid: owner.pid, request }), { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, path.join(inbox, `${id}.json`));
  return true;
}

function serveRequests(directory, dispatch, { intervalMs = 100 } = {}) {
  const inbox = path.join(directory, directoryName);
  fs.mkdirSync(inbox, { recursive: true, mode: 0o700 });
  const inboxStat = fs.lstatSync(inbox);
  if (!inboxStat.isDirectory() || inboxStat.isSymbolicLink()) throw Error('Invalid broker mailbox directory');
  const ownerPath = path.join(directory, '.configuration-owner.json');
  const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
  if (owner.pid !== process.pid || owner.host !== os.hostname()) throw Error('Broker mailbox requires the configuration lease');
  fs.writeFileSync(ownerPath, JSON.stringify({ ...owner, mailbox: true }), { mode: 0o600 });
  function drain() {
    for (const name of fs.readdirSync(inbox)) {
      if (!/^[a-f0-9-]+\.json$/.test(name)) continue;
      const file = path.join(inbox, name);
      try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) continue;
        const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
        const request = envelope.request;
        if (envelope.ownerPid !== process.pid || request?.dataDir !== directory) {
          fs.unlinkSync(file);
          continue;
        }
        // Claim before dispatch. A failed or unknown outcome must be reconciled
        // through the caller's original acknowledgment, never replayed here.
        fs.unlinkSync(file);
        dispatch(request);
      } catch (error) {
        console.error('[broker-mailbox]', error.message);
      }
    }
  }
  const watcher = fs.watch(inbox, drain);
  const timer = setInterval(drain, intervalMs);
  return () => {
    watcher.close();
    clearInterval(timer);
  };
}

module.exports = { forwardRequest, serveRequests };
