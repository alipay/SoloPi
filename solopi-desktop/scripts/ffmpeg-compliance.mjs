import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// Distribution gate: a license label alone cannot establish which binary was built.
export function verifyFFmpegCompliance(root) {
  const metadataPath = path.join(root, 'ffmpeg-build.json');
  if (!fs.existsSync(metadataPath)) throw Error('FFmpeg lacks LGPL source/build records; rebuild and run record-ffmpeg-build.mjs before packaging');
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  if (metadata.schemaVersion !== 'media.ffmpeg-build.v1' || metadata.license !== 'LGPL-2.1-or-later') {
    throw Error('FFmpeg must have an audited LGPL build record');
  }
  if (!Array.isArray(metadata.configure) || !metadata.configure.includes('--disable-gpl') ||
      !metadata.configure.includes('--disable-nonfree') ||
      metadata.configure.some(flag => /^--enable-(gpl|nonfree|version3)(?:=|$)/.test(flag))) {
    throw Error('FFmpeg GPL/nonfree configuration is not allowed in this distribution');
  }
  const verify = record => {
    if (!record || typeof record.path !== 'string' || !/^[a-f0-9]{64}$/.test(record.sha256 || '')) throw Error('Invalid FFmpeg source/file record');
    const file = path.resolve(root, record.path);
    const base = fs.realpathSync(root) + path.sep;
    if (!file.startsWith(path.resolve(root) + path.sep) || !fs.realpathSync(file).startsWith(base)) throw Error('FFmpeg compliance path escapes runtime');
    if (digest(file) !== record.sha256) throw Error(`FFmpeg compliance hash mismatch: ${record.path}`);
    return file;
  };
  if (metadata.binary?.path !== (metadata.platform === 'win32' ? 'bin/ffmpeg.exe' : 'bin/ffmpeg')) throw Error('Invalid FFmpeg binary path');
  const binary = verify(metadata.binary);
  // Catch a relabelled GPL executable even if its digest was updated.
  if (/--enable-(?:gpl|nonfree|version3)(?:[=\s\x00]|$)/.test(fs.readFileSync(binary).toString('latin1'))) throw Error('FFmpeg executable embeds GPL/nonfree build flags');
  if (!metadata.sources?.length || !metadata.sources.some(source => source.name === 'ffmpeg')) throw Error('FFmpeg corresponding source is missing');
  for (const [flag, name] of [['--enable-libopus', 'opus'], ['--enable-libspeex', 'speex'], ['--enable-libmp3lame', 'lame']]) {
    if (metadata.configure.includes(flag) && !metadata.sources.some(source => source.name === name)) throw Error(`FFmpeg corresponding dependency source is missing: ${name}`);
  }
  for (const source of metadata.sources) {
    if (!source.version || !source.url || !source.archive?.path?.startsWith('sources/')) throw Error('FFmpeg corresponding source needs version, URL and archive');
    verify(source.archive);
    verify(source.license);
    if (source.name !== 'ffmpeg') verify(source.buildRecipe);
  }
  verify(metadata.recipe);
  for (const file of metadata.buildFiles || []) verify(file);
  return { version: metadata.version, license: metadata.license, sources: metadata.sources.length };
}
