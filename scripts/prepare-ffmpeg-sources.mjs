#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const ffmpegSourceLock=JSON.parse(fs.readFileSync(path.join(root,'resources/third-party/ffmpeg-sources.json'),'utf8'));
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
export function verifyPinnedFFmpegSources(directory) {
  for(const item of ffmpegSourceLock.sources) {
    if(path.basename(item.archive)!==item.archive)throw Error('Unsafe pinned source filename');
    if(digest(fs.readFileSync(path.join(directory,item.archive)))!==item.sha256)throw Error(`Pinned source hash mismatch: ${item.archive}`);
  }
  return ffmpegSourceLock.sources;
}
export async function prepareFFmpegSources(directory,{fetchFile=async url=>Buffer.from(await (await fetch(url,{signal:AbortSignal.timeout(120000)})).arrayBuffer())}={}) {
  fs.mkdirSync(directory,{recursive:true});
  for(const item of ffmpegSourceLock.sources) {
    const destination=path.join(directory,item.archive);
    if(fs.existsSync(destination))continue; // Existing mismatches fail; never replace silently.
    const cached=path.join(root,'resources/media-runtime/linux-x64/sources',item.archive);
    const data=fs.existsSync(cached)?fs.readFileSync(cached):await fetchFile(item.url);
    if(digest(data)!==item.sha256)throw Error(`Downloaded source hash mismatch: ${item.archive}`);
    fs.writeFileSync(destination,data,{flag:'wx'});
  }
  verifyPinnedFFmpegSources(directory);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const directory=process.argv[2];if(!directory)throw Error('Usage: prepare-ffmpeg-sources.mjs <archive-directory> [--verify]');
  if(process.argv[3]==='--verify')verifyPinnedFFmpegSources(directory);else await prepareFFmpegSources(directory);
  console.log('FFmpeg and codec source archives match the reviewed lock');
}
