#!/usr/bin/env node
// Release attachment containing corresponding sources, not a vendored application tree.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {verifyFFmpegCompliance} from './ffmpeg-compliance.mjs';
const require=createRequire(import.meta.url),tar=require('tar');
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
const safe=file=>typeof file==='string'&&!file.includes('\\')&&!file.includes(':')&&!file.split('/').some(p=>p==='..'||p==='')&&!path.posix.isAbsolute(file);
export async function verifyFFmpegSourceArchive(file,{requireChecksum=false}={}) {
 if(requireChecksum){const expected=fs.readFileSync(file+'.sha256','utf8').trim();if(expected!==`${digest(fs.readFileSync(file))}  ${path.basename(file)}`)throw Error('Source archive checksum mismatch');}
 const entries=new Map();let invalid;const names=new Set();
 await tar.t({file,onReadEntry:entry=>{
   if(!safe(entry.path)||entry.type!=='File'||names.has(entry.path)){invalid=Error('Unsafe or duplicate source archive member');entry.resume();return;}
   names.add(entry.path);
   const chunks=[];entry.on('data',data=>chunks.push(data));entry.on('end',()=>entries.set(entry.path,Buffer.concat(chunks)));
 }});
 if(invalid)throw invalid;
 const manifest=JSON.parse(entries.get('SOURCE-MANIFEST.json')?.toString()||'null');
 if(manifest?.schemaVersion!==1||!Array.isArray(manifest.files)||!manifest.files.length)throw Error('Missing source archive manifest');
 for(const record of manifest.files) {
   const data=entries.get(record.path);
   if(!safe(record.path)||!data||digest(data)!==record.sha256||data.length!==record.bytes)throw Error(`Source archive integrity mismatch: ${record.path}`);
 }
 if(entries.size!==manifest.files.length+1)throw Error('Unlisted source archive member');
 if(!entries.has('ffmpeg-build.json')||!entries.has('REBUILD.md'))throw Error('Source archive lacks build instructions');
 const metadata=JSON.parse(entries.get('ffmpeg-build.json'));
 for(const source of metadata.sources||[])for(const record of [source.archive,source.license,source.buildRecipe].filter(Boolean)) {
   if(digest(entries.get(record.path)||Buffer.alloc(0))!==record.sha256)throw Error('Incomplete source or license record');
 }
 for(const record of [metadata.recipe,...(metadata.buildFiles||[])]) if(!record||digest(entries.get(record.path)||Buffer.alloc(0))!==record.sha256)throw Error('Incomplete build support');
 return {files:manifest.files.length,version:metadata.version,platform:manifest.platform,arch:manifest.arch,sha256:digest(fs.readFileSync(file))};
}
export async function createFFmpegSourceArchive({runtimeRoot,outputFile,platform,arch}) {
 if(!['darwin','linux','win32'].includes(platform)||!['x64','arm64','ia32','arm'].includes(arch))throw Error('Invalid source archive target');
 verifyFFmpegCompliance(runtimeRoot);
 if(fs.existsSync(outputFile)||fs.existsSync(outputFile+'.sha256'))throw Error('Source archive output already exists');
 const metadata=JSON.parse(fs.readFileSync(path.join(runtimeRoot,'ffmpeg-build.json'),'utf8'));
 if(metadata.platform&&metadata.platform!==platform||metadata.arch&&metadata.arch!==arch)throw Error('Source archive target mismatch');
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'ffmpeg-sources-'));
 const temporary=outputFile+`.partial-${process.pid}`;
 try {
  const records=new Map();
  for(const source of metadata.sources)for(const record of [source.archive,source.license,source.buildRecipe].filter(Boolean))records.set(record.path,record);
  for(const record of [metadata.recipe,...(metadata.buildFiles||[])])records.set(record.path,record);
  // Build paths are machine-local, not meaningful source provenance. Keep arguments
  // and recipes, with documented workspace placeholders rather than user home paths.
  const prefix=metadata.configure.find(arg=>arg.startsWith('--prefix='))?.slice(9).replace(/^['"]|['"]$/g,'');
  const base=prefix&&path.posix.isAbsolute(prefix)?path.posix.dirname(prefix):null;
  const normalize=text=>{
   if(base&&base!=='/')text=text.split(base).join('${WORKSPACE}');
   return text.replace(/\/(?:Users|home)\/[^\s/'"<>]+(?:\/[^\s'"<>]*)?/g,'${PROJECT_PATH}');
  };
  const put=(relative,data)=>{const destination=path.join(workspace,relative);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,data);};
  const hashes=new Map();
  for(const [relative] of records) {
   const original=fs.readFileSync(path.join(runtimeRoot,relative));
   const data=/\.(?:sh|mjs|cjs|json|md|txt)$/.test(relative)?Buffer.from(normalize(original.toString('utf8'))):original;
   put(relative,data);fs.chmodSync(path.join(workspace,relative),fs.statSync(path.join(runtimeRoot,relative)).mode&0o777);hashes.set(relative,digest(data));
  }
  const rewrite=record=>{if(record)record.sha256=hashes.get(record.path);};
  for(const source of metadata.sources)for(const record of [source.archive,source.license,source.buildRecipe])rewrite(record);
  rewrite(metadata.recipe);for(const record of metadata.buildFiles||[])rewrite(record);
  metadata.configure=metadata.configure.map(normalize);
  metadata.buildPathsNormalized=true;
  metadata.binaryHashScope='compiled runtime before application code signing; final installer signing can change the file hash';
  put('ffmpeg-build.json',JSON.stringify(metadata,null,2)+'\n');
  put('REBUILD.md',`# FFmpeg corresponding source\n\nTarget: ${platform}-${arch}; FFmpeg ${metadata.version}.\n\nThe source archives and original license texts are unchanged. No upstream source patches were applied by this build. The build record identifies the compiler, SDK (where recorded), configure switches, sources, and scripts. Machine-local paths in build arguments and recipes are replaced by WORKSPACE/PROJECT_PATH placeholders; set them to your extraction/build directories.\n\nThe standalone ffmpeg executable is invoked as a separate process. To replace it, build on the target OS/architecture, replace the runtime's bin/ffmpeg before packaging, run the media capability tests, then sign/package the application normally. Do not alter an already signed application and assume its signature remains valid.\n\nFor macOS, use the included sources/build-support directory as the project root, place sources/build-ffmpeg-macos.sh under its scripts directory, and set GLASSBOX_FFMPEG_ARCHIVES to the extracted sources directory, GLASSBOX_MEDIA_BUILD_ROOT and GLASSBOX_MEDIA_OUTPUT_ROOT to new absolute directories. Run bash scripts/build-ffmpeg-macos.sh. Node.js, Xcode Command Line Tools, make and tar are required; no Homebrew codec libraries are used.\n\nFor Linux, the recorded recipe and codec recipes preserve the build commands used; supply the corresponding source/dependency staging paths indicated by their variables.\n\nSource URLs and SHA256 are in ffmpeg-build.json. SOURCE-MANIFEST.json inventories every attachment file. The binary SHA256 records the compiled runtime before application signing; the application release provides final installer checksums separately. Licenses retain their upstream terms, independently of SoloPi's Apache-2.0 source license.\n`);
  const files=[];
  function walk(dir,relative=''){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=relative?relative+'/'+entry.name:entry.name;if(entry.isDirectory())walk(path.join(dir,entry.name),file);else{const data=fs.readFileSync(path.join(dir,entry.name));files.push({path:file,sha256:digest(data),bytes:data.length});}}}
  walk(workspace);files.sort((a,b)=>a.path.localeCompare(b.path));
  put('SOURCE-MANIFEST.json',JSON.stringify({schemaVersion:1,component:'ffmpeg',platform,arch,version:metadata.version,files},null,2)+'\n');
  fs.mkdirSync(path.dirname(outputFile),{recursive:true});
  await tar.c({file:temporary,cwd:workspace,gzip:true,portable:true,noMtime:true,noDirRecurse:true},[...files.map(r=>r.path),'SOURCE-MANIFEST.json']);
  const result=await verifyFFmpegSourceArchive(temporary);
  fs.renameSync(temporary,outputFile);
  fs.writeFileSync(outputFile+'.sha256',`${result.sha256}  ${path.basename(outputFile)}\n`,{flag:'wx'});
  return {...result,file:outputFile};
 }finally{fs.rmSync(workspace,{recursive:true,force:true});fs.rmSync(temporary,{force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const [runtimeRoot,outputFile,platform,arch]=process.argv.slice(2);
 if(!runtimeRoot||!outputFile||!platform||!arch)throw Error('Usage: create-ffmpeg-source-archive.mjs <runtime> <output.tar.gz> <platform> <arch>');
 console.log(JSON.stringify(await createFFmpegSourceArchive({runtimeRoot:path.resolve(runtimeRoot),outputFile:path.resolve(outputFile),platform,arch}),null,2));
}
