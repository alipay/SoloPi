import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {createFFmpegSourceArchive,verifyFFmpegSourceArchive} from '../scripts/create-ffmpeg-source-archive.mjs';
import {verifyFFmpegCompliance} from '../scripts/ffmpeg-compliance.mjs';
import {verifyPinnedFFmpegSources,ffmpegSourceLock} from '../scripts/prepare-ffmpeg-sources.mjs';
const tar=createRequire(import.meta.url)('tar');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
function fixture(t,platform='darwin') {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'source-dist-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const runtime=path.join(root,'runtime');
 const put=(relative,data,mode)=>{const file=path.join(runtime,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,data);if(mode)fs.chmodSync(file,mode);return {path:relative,sha256:hash(data)};};
 const metadata={schemaVersion:'media.ffmpeg-build.v1',version:'fixture',platform,arch:'arm64',license:'LGPL-2.1-or-later',configure:['--disable-gpl','--disable-nonfree',`--prefix=${runtime}/build/output`],binary:put(platform==='win32'?'bin/ffmpeg.exe':'bin/ffmpeg','isolated fixture binary'),recipe:put('sources/build-ffmpeg.sh','echo build\n',0o755),buildFiles:[put('sources/helper.mjs','console.log("build")\n',0o755)],sources:[{name:'ffmpeg',version:'fixture',url:'https://ffmpeg.org/releases/',archive:put('sources/ffmpeg.tar.xz','original upstream archive bytes'),license:put('LICENSES/ffmpeg.txt','original LGPL text')}]};
 const save=()=>put('ffmpeg-build.json',JSON.stringify(metadata));save();
 return {root,runtime,put,metadata,save,options:{runtimeRoot:runtime,outputFile:path.join(root,'sources.tar.gz'),platform,arch:'arm64'}};
}
for(const platform of ['darwin','linux','win32'])test(`source attachment retains sources/licenses and verifies ${platform}`,async t=>{
 const f=fixture(t,platform);const result=await createFFmpegSourceArchive(f.options);assert.equal(result.platform,platform);
 assert.equal(result.sha256,(await verifyFFmpegSourceArchive(f.options.outputFile)).sha256);
 const directory=path.join(f.root,'extracted');fs.mkdirSync(directory);await tar.x({file:f.options.outputFile,cwd:directory});
 assert.equal(fs.readFileSync(path.join(directory,'sources/ffmpeg.tar.xz'),'utf8'),'original upstream archive bytes');
 assert.equal(fs.readFileSync(path.join(directory,'LICENSES/ffmpeg.txt'),'utf8'),'original LGPL text');
 assert.ok(fs.statSync(path.join(directory,'sources/helper.mjs')).mode&0o111);
 assert.doesNotMatch(fs.readFileSync(path.join(directory,'ffmpeg-build.json'),'utf8'),new RegExp(f.root));
 await assert.rejects(createFFmpegSourceArchive(f.options),/already exists/);
});
test('native sources and every build support file are checked before archiving',async t=>{
 const f=fixture(t);fs.appendFileSync(path.join(f.runtime,'sources/helper.mjs'),'changed');
 assert.throws(()=>verifyFFmpegCompliance(f.runtime),/hash mismatch/);
 await assert.rejects(createFFmpegSourceArchive(f.options),/hash mismatch/);assert.equal(fs.existsSync(f.options.outputFile),false);
});
test('a missing source or wrong platform cannot produce an attachment',async t=>{
 const f=fixture(t);await assert.rejects(createFFmpegSourceArchive({...f.options,platform:'linux'}),/target mismatch/);
 fs.rmSync(path.join(f.runtime,'sources/ffmpeg.tar.xz'));await assert.rejects(createFFmpegSourceArchive(f.options),/ENOENT/);
});
test('source lock rejects substituted inputs instead of accepting a version label',t=>{
 const f=fixture(t);for(const source of ffmpegSourceLock.sources)f.put(`archives/${source.archive}`,'wrong source');
 assert.throws(()=>verifyPinnedFFmpegSources(path.join(f.runtime,'archives')),/hash mismatch/);
});
test('tampered archive content and extra unlisted files are rejected',async t=>{
 const f=fixture(t);await createFFmpegSourceArchive(f.options);
 const directory=path.join(f.root,'extract');fs.mkdirSync(directory);await tar.x({file:f.options.outputFile,cwd:directory});
 fs.appendFileSync(path.join(directory,'sources/ffmpeg.tar.xz'),'changed');
 const bad=path.join(f.root,'bad.tar.gz');
 const files=JSON.parse(fs.readFileSync(path.join(directory,'SOURCE-MANIFEST.json'))).files.map(f=>f.path);
 await tar.c({file:bad,cwd:directory,gzip:true},[...files,'SOURCE-MANIFEST.json']);
 await assert.rejects(verifyFFmpegSourceArchive(bad),/integrity mismatch/);
});
test('Mac recipe builds pinned codecs and explicitly excludes GPL/nonfree',()=>{
 const script=fs.readFileSync(new URL('../scripts/build-ffmpeg-macos.sh',import.meta.url),'utf8');
 assert.match(script,/build-ffmpeg-codecs\.sh/);assert.match(script,/--disable-gpl --disable-nonfree --disable-version3/);
 assert.doesNotMatch(script,/\/opt\/homebrew|OPUS_PREFIX=.*homebrew/);
});

test('missing checksum or changed checksum blocks final release verification',async t=>{
 const f=fixture(t);await createFFmpegSourceArchive(f.options);
 await verifyFFmpegSourceArchive(f.options.outputFile,{requireChecksum:true});
 fs.writeFileSync(f.options.outputFile+'.sha256','wrong');
 await assert.rejects(verifyFFmpegSourceArchive(f.options.outputFile,{requireChecksum:true}),/checksum mismatch/);
 fs.rmSync(f.options.outputFile+'.sha256');
 await assert.rejects(verifyFFmpegSourceArchive(f.options.outputFile,{requireChecksum:true}),/ENOENT/);
});
