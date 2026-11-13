#!/usr/bin/env node
// Device-free native checks for the codecs used by audio and recording workflows.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const binary=path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw Error('Usage: verify-ffmpeg-capabilities.mjs <ffmpeg> [existing-h264.mp4]');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'media-capabilities-'));
const passed=[];
const run=args=>execFileSync(binary,['-v','error','-nostdin','-y',...args],{cwd:directory,timeout:30000,stdio:['ignore','pipe','pipe']});
const exists=file=>{if(!fs.statSync(path.join(directory,file)).size)throw Error(`Empty media output: ${file}`);};
try {
 const samples=16000,wav=Buffer.alloc(44+samples*2);
 wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
 for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(8000*Math.sin(i*2*Math.PI*440/16000)),44+i*2);
 fs.writeFileSync(path.join(directory,'input.wav'),wav);
 for(const [codec,extension] of [['libopus','opus'],['libspeex','spx'],['libmp3lame','mp3'],['aac','m4a']]) {
  const out=`audio.${extension}`,decoded=`${codec}.pcm`;
  run(['-i','input.wav','-c:a',codec,out]);exists(out);
  run(['-i',out,'-c:a','pcm_s16le','-f','s16le',decoded]);exists(decoded);
  passed.push(`${codec}:encode/decode`);
 }
 const rgb=Buffer.alloc(64*64*3*5);for(let i=0;i<rgb.length;i++)rgb[i]=i%255;
 fs.writeFileSync(path.join(directory,'frames.rgb'),rgb);
 run(['-f','rawvideo','-pixel_format','rgb24','-video_size','64x64','-framerate','5','-i','frames.rgb','-c:v','mpeg4','-pix_fmt','yuv420p','video.mp4']);exists('video.mp4');
 run(['-i','video.mp4','-frames:v','1','frame.png']);exists('frame.png');
 run(['-i','video.mp4','-t','0.5','-c','copy','clip.mp4']);exists('clip.mp4');
 passed.push('mpeg4:encode/decode/png/copy-cut');
 if(process.argv[3]) {
  run(['-i',path.resolve(process.argv[3]),'-t','1','-c','copy','h264-clip.mp4']);exists('h264-clip.mp4');
  run(['-i','h264-clip.mp4','-frames:v','1','h264.png']);exists('h264.png');
  passed.push('existing-video:copy-cut/decode/png');
 }
 console.log(JSON.stringify({success:true,checks:passed},null,2));
} finally {fs.rmSync(directory,{recursive:true,force:true});}
