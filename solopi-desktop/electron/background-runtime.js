const fs = require('node:fs');
const path = require('node:path');

function hasDisplaySession(env = process.env, exists = fs.existsSync) {
  if (env.WAYLAND_DISPLAY && (path.isAbsolute(env.WAYLAND_DISPLAY)
    ? exists(env.WAYLAND_DISPLAY) : env.XDG_RUNTIME_DIR && exists(path.join(env.XDG_RUNTIME_DIR,env.WAYLAND_DISPLAY)))) return true;
  const local = /^:(\d+)(?:\.\d+)?$/.exec(env.DISPLAY || '');
  if (local) return exists(`/tmp/.X11-unix/X${local[1]}`);
  // Explicit remote X11 sessions are owned by the caller, never replaced or killed.
  return Boolean(env.DISPLAY);
}
function backgroundBackend(platform = process.platform, env = process.env, exists = fs.existsSync) {
  return platform === 'linux' && !hasDisplaySession(env,exists) ? 'headless' : 'desktop';
}
function backgroundArguments(args = [], options = {}) {
  if (backgroundBackend(options.platform, options.env, options.exists) !== 'headless') return args;
  return [...args.filter(arg=>!arg.startsWith('--ozone-platform=')), '--ozone-platform=headless'];
}
function configureBackgroundRuntime(app, {platform=process.platform,argv=process.argv,env=process.env} = {}) {
  const background=argv.includes('--glassbox-background') || env.GLASSBOX_BACKGROUND === '1';
  const headless=platform==='linux' && background && argv.includes('--ozone-platform=headless');
  if (headless) app.disableHardwareAcceleration();
  return {headless};
}
module.exports = {hasDisplaySession,backgroundBackend,backgroundArguments,configureBackgroundRuntime};
