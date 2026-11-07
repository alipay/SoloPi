const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MEDIA_RUNTIME_SCHEMA_VERSION = 'glassbox.media-runtime.v1';

function getPlatformArchKey(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

function getBundledMediaRoot(options = {}) {
  const resourcesPath = String(options.resourcesPath || process.resourcesPath || '').trim();
  if (!resourcesPath) return '';
  return path.join(resourcesPath, 'media-runtime', getPlatformArchKey(options.platform, options.arch));
}

function getBundledMediaPaths(options = {}) {
  const root = getBundledMediaRoot(options);
  const executableSuffix = (options.platform || process.platform) === 'win32' ? '.exe' : '';
  return {
    root,
    manifest: root ? path.join(root, 'manifest.json') : '',
    scrcpy: root ? path.join(root, 'bin', `scrcpy${executableSuffix}`) : '',
    ffmpeg: root ? path.join(root, 'bin', `ffmpeg${executableSuffix}`) : '',
    adb: root ? path.join(root, 'bin', `adb${executableSuffix}`) : '',
    scrcpyServer: root ? path.join(root, 'share', 'scrcpy', 'scrcpy-server') : '',
  };
}

function readBundledMediaManifest(options = {}) {
  const paths = getBundledMediaPaths(options);
  if (!paths.manifest || !fs.existsSync(paths.manifest)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(paths.manifest, 'utf8'));
    return manifest?.schemaVersion === MEDIA_RUNTIME_SCHEMA_VERSION ? manifest : null;
  } catch (_error) {
    return null;
  }
}

function firstExistingFile(candidates = []) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || '';
}

function resolveMediaRuntime(options = {}) {
  const bundled = getBundledMediaPaths(options);
  const isPackaged = options.isPackaged === true;
  const env = options.env || process.env;
  // A distributable build must execute only the runtime that was sealed into
  // the signed app. External overrides are intentionally development-only.
  const allowExternal = !isPackaged;
  const platform = options.platform || process.platform;
  const home = options.homeDir || os.homedir();
  const explicitScrcpy = String(env.SCRCPY_PATH || '').trim();
  const explicitFfmpeg = String(env.FFMPEG_PATH || '').trim();
  const explicitServer = String(env.SCRCPY_SERVER_PATH || '').trim();
  const systemScrcpy = platform === 'win32' ? [] : platform === 'linux' ? ['/usr/bin/scrcpy', '/usr/local/bin/scrcpy'] : ['/opt/homebrew/bin/scrcpy', '/usr/local/bin/scrcpy'];
  const systemFfmpeg = platform === 'win32' ? [] : platform === 'linux' ? ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'] : ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'];

  const scrcpy = firstExistingFile([
    allowExternal ? explicitScrcpy : '',
    bundled.scrcpy,
    ...(isPackaged ? [] : systemScrcpy),
  ]);
  const ffmpeg = firstExistingFile([
    allowExternal ? explicitFfmpeg : '',
    bundled.ffmpeg,
    ...(isPackaged ? [] : systemFfmpeg),
  ]);
  const scrcpyServer = firstExistingFile([
    allowExternal ? explicitServer : '',
    bundled.scrcpyServer,
    ...(isPackaged ? [] : [
      '/opt/homebrew/share/scrcpy/scrcpy-server',
      '/usr/local/share/scrcpy/scrcpy-server',
      path.join(home, '.local', 'share', 'scrcpy', 'scrcpy-server'),
    ]),
  ]);
  const adb = firstExistingFile([bundled.adb]);

  return {
    schemaVersion: MEDIA_RUNTIME_SCHEMA_VERSION,
    source: scrcpy.startsWith(bundled.root || '\0') && ffmpeg.startsWith(bundled.root || '\0')
      ? 'bundled'
      : 'development-fallback',
    root: bundled.root,
    scrcpy,
    ffmpeg,
    adb,
    scrcpyServer,
    manifest: readBundledMediaManifest(options),
    complete: Boolean(scrcpy && ffmpeg && scrcpyServer && (!isPackaged || adb)),
  };
}

function getScrcpyEnvironment(runtime = {}, baseEnv = process.env, { headless = false } = {}) {
  const env = runtime.scrcpyServer
    ? { ...baseEnv, SCRCPY_SERVER_PATH: runtime.scrcpyServer }
    : { ...baseEnv };
  // Recording has no presentation. Avoid initializing Cocoa/activating a Dock app,
  // even when scrcpy initializes SDL despite --no-window. Cover SDL2 and SDL3.
  if (headless) Object.assign(env, {
    SDL_VIDEO_DRIVER: 'dummy', SDL_VIDEODRIVER: 'dummy',
    SDL_AUDIO_DRIVER: 'dummy', SDL_AUDIODRIVER: 'dummy',
    SDL_MAC_BACKGROUND_APP: '1',
  });
  return env;
}

module.exports = {
  MEDIA_RUNTIME_SCHEMA_VERSION,
  getBundledMediaPaths,
  getBundledMediaRoot,
  getPlatformArchKey,
  getScrcpyEnvironment,
  readBundledMediaManifest,
  resolveMediaRuntime,
};
