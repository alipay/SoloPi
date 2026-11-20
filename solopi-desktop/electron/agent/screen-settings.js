// Screen settings are independent of model transport/retry policy.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
function validateScreenSettings(input = {}) {
  const { screenMode = 'main', virtualChecks = [] } = input;
  if (Object.keys(input).some(k => !['screenMode', 'virtualChecks'].includes(k)) || !['main', 'virtual'].includes(screenMode)) throw Error('无效的屏幕模式设置');
  if (!Array.isArray(virtualChecks) || virtualChecks.length > 10 || virtualChecks.some(c =>
    !c || Object.keys(c).some(k => !['selectorKey', 'selectorValue', 'operator', 'expected'].includes(k)) ||
    !['resourceId', 'text', 'description'].includes(c.selectorKey) || !['equals', 'contains'].includes(c.operator) ||
    typeof c.selectorValue !== 'string' || !c.selectorValue.trim() || c.selectorValue.length > 512 ||
    typeof c.expected !== 'string' || c.expected.length > 4096)) throw Error('副屏验收条件无效');
  return { screenMode, virtualChecks: virtualChecks.map(c => ({ ...c })) };
}
function createScreenSettings(directory) {
  const file = () => path.join(directory(), 'agent', 'screen-settings.json');
  return {
    load: () => fs.existsSync(file()) ? validateScreenSettings(JSON.parse(fs.readFileSync(file(), 'utf8'))) : validateScreenSettings(),
    save(input) {
      const setting = validateScreenSettings(input), target = file(), temp = target + '.' + randomUUID() + '.tmp';
      fs.mkdirSync(path.dirname(target), { recursive: true });
      try { fs.writeFileSync(temp, JSON.stringify(setting), { flag: 'wx', mode: 0o600 }); fs.renameSync(temp, target); }
      finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
      return setting;
    },
  };
}
module.exports = { createScreenSettings, validateScreenSettings };
