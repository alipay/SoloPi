const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const defaults = { device: '', contacts: [], textModel: '', visionModel: '', role: '', contextCount: 6 };

function normalizeSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_settings');
  const valid = (v, max) => typeof v === 'string' && v.length <= max;
  if (!valid(value.device, 256) || !valid(value.textModel, 256) || !valid(value.visionModel, 256) || !valid(value.role, 4000) || !Number.isInteger(value.contextCount) || value.contextCount < 0 || value.contextCount > 20 || !Array.isArray(value.contacts) || value.contacts.length > 20 || !value.contacts.every(v => valid(v, 100) && v.trim())) throw new Error('invalid_settings');
  return { device: value.device, contacts: [...new Set(value.contacts.map(v => v.trim()))], textModel: value.textModel, visionModel: value.visionModel, role: value.role, contextCount: value.contextCount };
}

function createReplySettings({ directory }) {
  if (!path.isAbsolute(directory)) throw new Error('invalid_directory');
  const file = path.join(directory, 'settings.json');
  const ensure = async () => {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== 'win32' && (stat.uid !== process.getuid() || (stat.mode & 0o077)))) throw new Error('unsafe_directory');
  };
  return {
    async load() {
      await ensure();
      try {
        const handle = await fs.open(file, require('node:fs').constants.O_RDONLY | (require('node:fs').constants.O_NOFOLLOW || 0));
        try {
          const stat = await handle.stat();
          if (!stat.isFile() || stat.size > 65536 || (process.platform !== 'win32' && (stat.uid !== process.getuid() || (stat.mode & 0o077)))) throw new Error('unsafe_settings');
          return normalizeSettings(JSON.parse(await handle.readFile('utf8')));
        } finally { await handle.close(); }
      } catch (error) { if (error.code === 'ENOENT') return { ...defaults, contacts: [] }; throw error; }
    },
    async save(value) {
      const result = normalizeSettings(value);
      await ensure();
      const temp = path.join(directory, `.${crypto.randomBytes(16).toString('hex')}.tmp`);
      try { await fs.writeFile(temp, JSON.stringify(result), { flag: 'wx', mode: 0o600 }); await fs.rename(temp, file); }
      finally { await fs.unlink(temp).catch(() => {}); }
      return result;
    },
  };
}
module.exports = { createReplySettings };
