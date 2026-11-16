import {verifyFFmpegCompliance} from './ffmpeg-compliance.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export function verifyLinuxRuntime(root,arch){
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
 if(manifest.schemaVersion!=='glassbox.media-runtime.v1'||manifest.platform!=='linux'||manifest.arch!==arch)throw Error('Linux runtime manifest platform/architecture mismatch');
 const required=['bin/scrcpy','bin/ffmpeg','bin/adb','share/scrcpy/scrcpy-server','provenance.json'];
 const files=manifest.files||{};
 for(const file of required)if(!files[file])throw Error(`Runtime manifest missing ${file}`);
 if(!Object.keys(files).some(p=>p.startsWith('LICENSES/')))throw Error('Linux runtime lacks license records');
 for(const [relative,record] of Object.entries(files)){
  const target=path.resolve(root,relative),realRoot=fs.realpathSync(root);
  if(!target.startsWith(path.resolve(root)+path.sep)||!fs.realpathSync(target).startsWith(realRoot+path.sep))throw Error('Runtime path escapes root');
  const stat=fs.statSync(target);if(!stat.isFile())throw Error(`Runtime is not a file: ${relative}`);
  const hash=crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  if(hash!==record.sha256||stat.size!==record.sizeBytes)throw Error(`Runtime hash/size mismatch: ${relative}`);
  const header=fs.readFileSync(target).subarray(0,20);
  if(header.subarray(0,4).equals(Buffer.from([0x7f,0x45,0x4c,0x46]))){const machine=header.readUInt16LE(18);if(machine!==(arch==='x64'?62:183))throw Error(`Runtime ELF architecture mismatch: ${relative}`);}
 }
 for(const file of required.slice(0,3)){
  if(!(fs.statSync(path.join(root,file)).mode&0o111))throw Error(`Runtime not executable: ${file}`);
  const header=fs.readFileSync(path.join(root,file)).subarray(0,80);
  if(!header.subarray(0,4).equals(Buffer.from([0x7f,0x45,0x4c,0x46]))&&header.subarray(0,2).toString()!=='#!')throw Error(`Runtime is not ELF or launcher (possibly LFS pointer): ${file}`);
 }
 const serverHeader=fs.readFileSync(path.join(root,'share/scrcpy/scrcpy-server')).subarray(0,2);
 if(serverHeader.toString()!=='PK')throw Error('scrcpy-server is not a JAR/APK archive (possibly LFS pointer)');
 verifyFFmpegCompliance(root);
 return {platform:'linux',arch,files:Object.keys(files).length};
}
