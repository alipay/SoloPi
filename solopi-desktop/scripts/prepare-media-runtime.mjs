#!/usr/bin/env node

import { verifyFFmpegCompliance } from './ffmpeg-compliance.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceArgIndex = process.argv.indexOf('--source');
const source = path.resolve(
  sourceArgIndex >= 0 ? String(process.argv[sourceArgIndex + 1] || '') : String(process.env.GLASSBOX_MEDIA_RUNTIME_SOURCE || '')
);
const platform = process.env.GLASSBOX_MEDIA_PLATFORM || process.platform;
const arch = process.env.GLASSBOX_MEDIA_ARCH || process.arch;
const destination = path.join(root, 'resources', 'media-runtime', `${platform}-${arch}`);

if (!source || source === path.parse(source).root || !fs.existsSync(source)) {
  throw new Error('Provide a self-contained runtime with --source <dir> or GLASSBOX_MEDIA_RUNTIME_SOURCE.');
}
if (!fs.existsSync(path.join(source, 'LICENSES'))) {
  throw new Error('Media runtime source must include LICENSES/ for scrcpy, FFmpeg and bundled libraries.');
}

if (platform === 'linux') verifyFFmpegCompliance(source);

const staging = `${destination}.staging-${process.pid}`;
fs.rmSync(staging, { recursive: true, force: true });
fs.cpSync(source, staging, { recursive: true, dereference: true });
fs.rmSync(destination, { recursive: true, force: true });
fs.renameSync(staging, destination);
execFileSync(process.execPath, [path.join(root, 'scripts', 'verify-media-runtime.mjs')], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, GLASSBOX_MEDIA_PLATFORM: platform, GLASSBOX_MEDIA_ARCH: arch },
});
