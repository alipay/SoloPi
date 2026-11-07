#!/usr/bin/env node

import { verifyFFmpegCompliance } from './ffmpeg-compliance.mjs';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platform = process.env.GLASSBOX_MEDIA_PLATFORM || process.platform;
const arch = process.env.GLASSBOX_MEDIA_ARCH || process.arch;
const runtimeRoot = path.join(root, 'resources', 'media-runtime', `${platform}-${arch}`);
const suffix = platform === 'win32' ? '.exe' : '';
const required = [
  path.join(runtimeRoot, 'bin', `scrcpy${suffix}`),
  path.join(runtimeRoot, 'bin', `ffmpeg${suffix}`),
  path.join(runtimeRoot, 'bin', `adb${suffix}`),
  path.join(runtimeRoot, 'share', 'scrcpy', 'scrcpy-server'),
];

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(absolute) : [absolute];
  });
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const missing = required.filter((file) => !fs.existsSync(file) || !fs.statSync(file).isFile());
if (missing.length) {
  throw new Error(`Bundled media runtime is incomplete:\n${missing.join('\n')}`);
}
const licensesDir = path.join(runtimeRoot, 'LICENSES');
if (!fs.existsSync(licensesDir) || listFiles(licensesDir).length === 0) {
  throw new Error(`Bundled media runtime has no license notices: ${licensesDir}`);
}
const runtimeFiles = listFiles(runtimeRoot).filter((file) => path.basename(file) !== 'manifest.json');
const totalSizeBytes = runtimeFiles.reduce((total, file) => total + fs.statSync(file).size, 0);
const maxSizeBytes = Number(process.env.GLASSBOX_MEDIA_RUNTIME_MAX_BYTES || 80 * 1024 * 1024);
if (!Number.isFinite(maxSizeBytes) || totalSizeBytes > maxSizeBytes) {
  throw new Error(`Bundled media runtime is ${totalSizeBytes} bytes; limit is ${maxSizeBytes} bytes.`);
}

const nativeChecks = platform === process.platform && arch === process.arch;
if (!nativeChecks && process.env.GLASSBOX_MEDIA_REQUIRE_NATIVE === '1') throw Error('Media runtime native checks require the target OS and architecture');

if (platform === 'darwin' && nativeChecks) {
  const libDir = path.join(runtimeRoot, 'lib');
  const candidates = [
    ...required.slice(0, 3),
    ...(fs.existsSync(libDir) ? fs.readdirSync(libDir, { withFileTypes: true }) : [])
      .filter((entry) => entry.isFile() && entry.name.endsWith('.dylib'))
      .map((entry) => path.join(libDir, entry.name)),
  ];
  for (const file of candidates) {
    const links = execFileSync('otool', ['-L', file], { encoding: 'utf8' });
    if (/\/opt\/homebrew|\/usr\/local\/(?:Cellar|opt)/.test(links)) {
      throw new Error(`Media runtime still references a package-manager path: ${file}`);
    }
  }
}

verifyFFmpegCompliance(runtimeRoot);

if (nativeChecks) {
  const encoders = execFileSync(required[1], ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  for (const codec of ['libopus', 'libspeex']) {
    if (!encoders.split(/\s+/).includes(codec)) throw new Error(`Bundled FFmpeg is missing encoder: ${codec}`);
  }
}

const manifestPath = path.join(runtimeRoot, 'manifest.json');
let existingManifest = null;
try {
  existingManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (_error) {
  existingManifest = null;
}
const stableManifest = {
  schemaVersion: 'glassbox.media-runtime.v1',
  platform,
  arch,
  totalSizeBytes,
  files: Object.fromEntries(runtimeFiles.map((file) => [
    path.relative(runtimeRoot, file).split(path.sep).join('/'),
    { sizeBytes: fs.statSync(file).size, sha256: sha256(file) },
  ])),
};
const existingStableManifest = existingManifest ? {
  schemaVersion: existingManifest.schemaVersion,
  platform: existingManifest.platform,
  arch: existingManifest.arch,
  totalSizeBytes: existingManifest.totalSizeBytes,
  files: existingManifest.files,
} : null;
const runtimeUnchanged = JSON.stringify(existingStableManifest) === JSON.stringify(stableManifest);
const manifest = {
  schemaVersion: stableManifest.schemaVersion,
  platform: stableManifest.platform,
  arch: stableManifest.arch,
  generatedAt: runtimeUnchanged && existingManifest?.generatedAt
    ? existingManifest.generatedAt
    : new Date().toISOString(),
  totalSizeBytes: stableManifest.totalSizeBytes,
  files: stableManifest.files,
};
const serializedManifest = `${JSON.stringify(manifest, null, 2)}\n`;
if (!fs.existsSync(manifestPath) || fs.readFileSync(manifestPath, 'utf8') !== serializedManifest) {
  fs.writeFileSync(manifestPath, serializedManifest);
}
console.log(JSON.stringify({
  success: true,
  nativeChecks: nativeChecks ? 'passed' : 'requires-target-host',
  runtimeRoot,
  manifestPath,
  totalSizeBytes,
  manifestChanged: !runtimeUnchanged,
  files: manifest.files,
}, null, 2));
