const fs = require('node:fs');
const path = require('node:path');
const { privateFile } = require('./credential-storage');

const ID = /^[0-9a-f]{32}$/;
const OWNER = /^reply-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function createReplyEvidenceStore({ index, artifactDirectory }) {
  function records() {
    const value = index.load();
    if (value === null) return [];
    if (!value || !Array.isArray(value.records) || value.records.length > 10000) throw Error('reply_evidence_unavailable');
    const seen = new Set();
    for (const record of value.records) {
      if (!record || !ID.test(record.id) || !OWNER.test(record.owner) || seen.has(record.id) ||
          !['reserved', 'bound', 'complete'].includes(record.status) || typeof record.createdAt !== 'string' ||
          !Number.isFinite(Date.parse(record.createdAt))) throw Error('reply_evidence_unavailable');
      seen.add(record.id);
    }
    return value.records;
  }
  function begin(owner, id) {
    if (!OWNER.test(owner) || !ID.test(id)) throw Error('reply_evidence_unavailable');
    const list = records();
    if (list.length >= 10000 || list.some(item => item.id === id || item.owner === owner))
      throw Error('reply_evidence_unavailable');
    // Code security: persist the exact owner/run mapping before device dispatch.
    index.save({ records:[...list, {owner, id, status:'reserved', createdAt:new Date().toISOString()}] });
  }
  function bind(owner, id) {
    const list = records();
    const item = list.find(record => record.id === id && record.owner === owner && record.status === 'reserved');
    if (!item) throw Error('reply_evidence_unavailable');
    // Code security: only a verified successful start can claim the newly created directory.
    item.status = 'bound';
    index.save({records:list});
  }
  function complete(owner, id) {
    const list = records();
    const item = list.find(record => record.id === id && record.owner === owner);
    if (!item) throw Error('reply_evidence_unavailable');
    if (item.status === 'complete' || item.status === 'reserved') return;
    item.status = 'complete';
    index.save({records:list});
  }
  function list() {
    return records().filter(item => item.status === 'complete').map(({id, createdAt}) => ({id, createdAt}));
  }
  function inspectTree(target) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) ||
        (process.platform !== 'win32' && stat.uid !== process.getuid())) throw Error('reply_evidence_unsafe');
    if (stat.isDirectory()) for (const item of fs.readdirSync(target)) inspectTree(path.join(target, item));
  }
  function remove(id) {
    if (typeof id !== 'string' || !ID.test(id)) throw Error('reply_evidence_unavailable');
    const list = records();
    const item = list.find(record => record.id === id && record.status === 'complete');
    if (!item) throw Error('reply_evidence_unavailable');
    const root = path.resolve(artifactDirectory());
    const target = path.resolve(root, 'virtual-' + id);
    if (path.dirname(target) !== root) throw Error('reply_evidence_unsafe');
    // Code security: only indexed, completed runs in the private artifact root may be removed.
    try {
      privateFile(root, {directory:true});
      inspectTree(target);
      fs.rmSync(target, {recursive:true});
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    index.save({records:list.filter(record => record.id !== id)});
  }
  return {begin, bind, complete, list, remove};
}
module.exports = {createReplyEvidenceStore};
