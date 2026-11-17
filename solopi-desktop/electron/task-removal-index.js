const fs = require('node:fs');

// Retain only deletion IDs, never the large workflow document. Atomic replacement
// and in-place writes both invalidate the index before it can hide a new deletion.
function createTaskRemovalIndex({ io = fs, limit = 32 } = {}) {
  const entries = new Map();
  return file => {
    let stat;
    try { stat = io.statSync(file); }
    catch (error) {
      entries.delete(file);
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const revision = [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
    const cached = entries.get(file);
    if (cached?.revision === revision) return cached.ids;
    const state = JSON.parse(io.readFileSync(file, 'utf8'));
    const ids = Object.freeze((state.removedAutomationTasks || []).map(item => item.id));
    entries.delete(file);
    entries.set(file, { revision, ids });
    if (entries.size > limit) entries.delete(entries.keys().next().value);
    return ids;
  };
}
module.exports = { createTaskRemovalIndex };
