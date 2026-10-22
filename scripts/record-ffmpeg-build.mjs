#!/usr/bin/env node
// Run on the build host after native verification, before importing a runtime.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifyFFmpegCompliance} from './ffmpeg-compliance.mjs';
const [rootArg, sourceRecordsArg, recipeArg] = process.argv.slice(2);
if (!rootArg || !sourceRecordsArg || !recipeArg) throw Error('Usage: record-ffmpeg-build.mjs <runtime-root> <source-records.json> <build-recipe>');
const binaryRelative=process.platform==='win32'?'bin/ffmpeg.exe':'bin/ffmpeg';
const root=path.resolve(rootArg), binary=path.join(root,binaryRelative);
const versionText=execFileSync(binary,['-version'],{encoding:'utf8'});
const licenseText=execFileSync(binary,['-L'],{encoding:'utf8'});
if (!/GNU\s+Lesser\s+General\s+Public\s+License/.test(licenseText) || /GNU\s+General\s+Public\s+License/.test(licenseText)) throw Error('Native FFmpeg is not LGPL');
const configureLine=versionText.split('\n').find(line=>line.startsWith('configuration: '));
if (!configureLine) throw Error('Native FFmpeg build configuration is missing');
// FFmpeg prints quoted build paths; licensing switches are independent tokens.
const configure=configureLine.slice('configuration: '.length).match(/(?:[^\s'"]+|'[^']*'|"[^"]*")+/g);
const record=(relative)=>({path:relative,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,relative))).digest('hex')});
fs.mkdirSync(path.join(root,'sources'),{recursive:true});fs.mkdirSync(path.join(root,'LICENSES'),{recursive:true});
const sources=JSON.parse(fs.readFileSync(sourceRecordsArg,'utf8')).map(source=>{
 for (const field of ['name','version','url','archive','license']) if(!source[field])throw Error(`Missing source ${field}`);
 const archive=`sources/${path.basename(source.archive)}`,license=`LICENSES/${source.name}-${path.basename(source.license)}`;
 fs.copyFileSync(source.archive,path.join(root,archive));fs.copyFileSync(source.license,path.join(root,license));
 let buildRecipe;
 if(source.buildRecipe){const target=`sources/${source.name}-${path.basename(source.buildRecipe)}`;fs.copyFileSync(source.buildRecipe,path.join(root,target));buildRecipe=record(target);}
 return {name:source.name,version:source.version,url:source.url,archive:record(archive),license:record(license),...(buildRecipe?{buildRecipe}: {})};
});
fs.copyFileSync(recipeArg,path.join(root,'sources',path.basename(recipeArg)));
fs.writeFileSync(path.join(root,'ffmpeg-build.json'),JSON.stringify({schemaVersion:'media.ffmpeg-build.v1',version:versionText.split('\n')[0].split(' ')[2],license:'LGPL-2.1-or-later',configure,binary:record(binaryRelative),recipe:record('sources/'+path.basename(recipeArg)),sources},null,2)+'\n');
console.log(JSON.stringify(verifyFFmpegCompliance(root)));
