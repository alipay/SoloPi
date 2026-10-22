const path = require('node:path');
// UI and CLI must use the same explicit data root. Command-line wins over env.
function resolveDataDirectory(argv = process.argv, env = process.env, cwd = process.cwd()) {
  const modernIndex = argv.indexOf('--solopi-desktop-data-dir');
  const previousIndex = argv.indexOf('--solopi-harness-desktop-data-dir');
  const index = modernIndex >= 0 ? modernIndex : previousIndex >= 0 ? previousIndex : argv.indexOf('--glassbox-cli-data-dir');
  if (index >= 0) {
    const value = String(argv[index + 1] || '').trim();
    if (!value || value.startsWith('--')) throw Error(`${argv[index]} requires a directory`);
    return path.resolve(cwd, value);
  }
  const value = String(env.SOLOPI_DESKTOP_DATA_DIR || env.SOLOPI_HARNESS_DESKTOP_DATA_DIR || env.GLASSBOX_CLI_DATA_DIR || '').trim();
  return value ? path.resolve(cwd, value) : '';
}
module.exports = { resolveDataDirectory };
