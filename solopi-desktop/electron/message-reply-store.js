const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { privateFile } = require('./credential-storage');

function createMessageReplyStore({ directory, storage, kind = 'state' }) {
  if (!['state', 'session', 'evidence'].includes(kind)) throw Error('invalid_reply_store');
  const root = path.resolve(directory, 'message-reply');
  const file = path.join(root, `${kind}.bin`);
  function prepare(create) {
    if (create) fs.mkdirSync(root, { recursive:true, mode:0o700 });
    if (!fs.existsSync(root)) return false;
    privateFile(root, { directory:true });
    return true;
  }
  function load() {
    if (!prepare(false)) return null;
    let fd;
    try { fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > 1024 * 1024 || (process.platform !== 'win32' &&
          ((stat.mode & 0o077) || stat.uid !== process.getuid()))) throw Error('reply_store_unavailable');
      const record = JSON.parse(storage.decryptString(fs.readFileSync(fd)));
      if (record?.version !== 1 || !record.state || typeof record.state !== 'object') throw Error('reply_store_unavailable');
      return record.state;
    } finally { fs.closeSync(fd); }
  }
  function save(state) {
    prepare(true);
    // Code security: encrypted, owner-only state is durable before dispatch.
    const bytes = storage.encryptString(JSON.stringify({ version:1, state }));
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 1024 * 1024) throw Error('reply_store_unavailable');
    const temporary = path.join(root, `.${randomBytes(16).toString('hex')}.tmp`);
    let fd;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      fs.renameSync(temporary, file);
      const dir = fs.openSync(root, 'r');
      try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  function history() {
    const state = load();
    if (!state) return { history:[], pending:null };
    const project = item => item && typeof item === 'object' ? {
      id:typeof item.id === 'string' ? item.id.slice(0, 256) : '',
      status:typeof item.status === 'string' ? item.status.slice(0, 40) : '',
      ...(item.reason === 'image_model_not_configured' ? {reason:item.reason} : {}),
      ...(item.delivery === 'unknown' ? {delivery:'unknown'} : {}),
      ...(Number.isSafeInteger(item.reviewedAt) ? {reviewedAt:item.reviewedAt} : {}),
      ...(typeof item.text === 'string' ? {text:item.text.slice(0, 4000)} : {}),
      ...(typeof item.reply === 'string' ? {reply:item.reply.slice(0, 4000)} : {}),
    } : null;
    return { history:Array.isArray(state.history) ? state.history.slice(-1000).map(project).filter(Boolean) : [],
      pending:project(state.pending) };
  }
  function clearHistory() {
    if (kind !== 'state') throw Error('invalid_reply_store');
    const state = load();
    if (!state) return;
    // Code security: clearing the visible history never removes the uncertain
    // dispatch marker or the baseline used to prevent a duplicate reply.
    save({ ...state, history:[] });
  }
  function reviewPending(expectedId) {
    if (kind !== 'state') throw Error('invalid_reply_store');
    if (typeof expectedId !== 'string' || !expectedId || expectedId.length > 256) throw Error('invalid_review_id');
    const state = load();
    const pending = state?.pending;
    // Code security: compare the exact displayed message to the durable pending intent.
    if (!pending || pending.id !== expectedId || pending.status !== 'dispatching') throw Error('pending_review_changed');
    if (!Array.isArray(state.seen) || !Array.isArray(state.history) ||
        state.seen.some(id => typeof id !== 'string') ||
        (pending.reply !== undefined && (typeof pending.reply !== 'string' || pending.reply.length > 2000)) ||
        (pending.text !== undefined && (typeof pending.text !== 'string' || pending.text.length > 4000)))
      throw Error('invalid_pending_review');
    const reviewed = {id:pending.id,status:'reviewed',delivery:'unknown',reviewedAt:Date.now(),
      ...(typeof pending.reply === 'string' ? {reply:pending.reply} : {}),
      ...(typeof pending.text === 'string' ? {text:pending.text} : {})};
    const seen = state.seen.includes(pending.id) ? [...state.seen] : [...state.seen,pending.id];
    save({...state,seen,pending:null,history:[...state.history,reviewed].slice(-1000)});
    return reviewed;
  }
  return { load, save, history, clearHistory, reviewPending };
}
module.exports = { createMessageReplyStore };
