#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifyPinnedFFmpegSources} from './prepare-ffmpeg-sources.mjs';
import {verifyFFmpegCompliance} from './ffmpeg-compliance.mjs';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [runtimeArg,archivesArg,buildArg]=process.argv.slice(2);
if(!runtimeArg||!archivesArg||!buildArg)throw Error('Usage: record-ffmpeg-macos-build.mjs <runtime> <archives> <build>');
const runtime=path.resolve(runtimeArg),archives=path.resolve(archivesArg),build=path.resolve(buildArg);
const sources=verifyPinnedFFmpegSources(archives).map(item=>({name:item.name,version:item.version,url:item.url,archive:path.join(archives,item.archive),license:path.join(build,item.name==='ffmpeg'?'src':'codec-src',`${item.name}-${item.version}`,item.license),...(item.name==='ffmpeg'?{}:{buildRecipe:path.join(project,'scripts/build-ffmpeg-codecs.sh')})}));
const list=path.join(build,'source-records.json');fs.writeFileSync(list,JSON.stringify(sources));
execFileSync(process.execPath,[path.join(project,'scripts/record-ffmpeg-build.mjs'),runtime,list,path.join(project,'scripts/build-ffmpeg-macos.sh')],{stdio:'inherit'});
const metadata=JSON.parse(fs.readFileSync(path.join(runtime,'ffmpeg-build.json'),'utf8'));
metadata.platform='darwin';metadata.arch=process.arch;
metadata.toolchain={compiler:execFileSync('clang',['--version'],{encoding:'utf8'}).split('\n')[0],sdk:execFileSync('xcrun',['--show-sdk-version'],{encoding:'utf8'}).trim(),deploymentTarget:process.env.MACOSX_DEPLOYMENT_TARGET||'compiler-default'};
const buildFiles=['scripts/build-ffmpeg-codecs.sh','scripts/media-runtime-pkg-config.mjs','scripts/prepare-ffmpeg-sources.mjs','scripts/record-ffmpeg-build.mjs','scripts/record-ffmpeg-macos-build.mjs','scripts/ffmpeg-compliance.mjs','scripts/verify-ffmpeg-capabilities.mjs','resources/third-party/ffmpeg-sources.json'];
metadata.buildFiles=buildFiles.map(file=>{
 const relative=`sources/build-support/${file}`;const destination=path.join(runtime,relative);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(path.join(project,file),destination);
 return {path:relative,sha256:crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex')};
});
fs.writeFileSync(path.join(runtime,'ffmpeg-build.json'),JSON.stringify(metadata,null,2)+'\n');
console.log(JSON.stringify(verifyFFmpegCompliance(runtime)));
