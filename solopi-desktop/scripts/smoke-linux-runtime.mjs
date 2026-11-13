#!/usr/bin/env node
// Run on target Linux with the package's Electron in ELECTRON_RUN_AS_NODE mode.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
const runtime=path.resolve(process.argv[2]||'');
const output=path.resolve(process.argv[3]||'');
if(process.platform!=='linux'||process.argv.length!==4)throw Error('Usage on Linux: smoke-linux-runtime.mjs <bundled-runtime-directory> <new-output-directory>');
fs.mkdirSync(output,{recursive:false});
const invoke=(tool,args)=>execFileSync(path.join(runtime,'bin',tool),args,{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024,env:{...process.env}});
const result={startedAt:new Date().toISOString(),platform:process.platform,arch:process.arch,checks:[]};
try{
 for(const [tool,args] of [['scrcpy',['--version']],['ffmpeg',['-version']],['adb',['version']]]){
  const version=invoke(tool,args).split('\n').filter(Boolean).slice(0,2).join(' ');result.checks.push({name:`${tool}-startup`,passed:true,version});
 }
 const rate=16000,frames=rate,buffer=Buffer.alloc(44+frames*2);
 buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(rate,24);buffer.writeUInt32LE(rate*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(frames*2,40);
 for(let i=0;i<frames;i++)buffer.writeInt16LE(Math.round(8000*Math.sin(i*2*Math.PI*440/rate)),44+i*2);
 const wav=path.join(output,'tone.wav');fs.writeFileSync(wav,buffer,{flag:'wx'});
 for(const [codec,ext] of [['libopus','opus'],['libspeex','spx']]){
  const encoded=path.join(output,`tone.${ext}`),decoded=path.join(output,`${codec}.pcm`);
  invoke('ffmpeg',['-hide_banner','-loglevel','error','-i',wav,'-c:a',codec,encoded]);
  if(fs.statSync(encoded).size<64)throw Error(`${codec} produced empty media`);
  invoke('ffmpeg',['-hide_banner','-loglevel','error','-i',encoded,'-f','s16le','-ar',String(rate),'-ac','1',decoded]);
  if(fs.statSync(decoded).size<rate)throw Error(`${codec} decode produced insufficient PCM`);
  result.checks.push({name:`${codec}-encode-decode`,passed:true,encodedBytes:fs.statSync(encoded).size,decodedBytes:fs.statSync(decoded).size,encodedSha256:crypto.createHash('sha256').update(fs.readFileSync(encoded)).digest('hex')});
 }
 result.success=true;
}catch(error){result.success=false;result.error=error.message;process.exitCode=1;}
result.endedAt=new Date().toISOString();fs.writeFileSync(path.join(output,'runtime-smoke.json'),JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result,null,2));
