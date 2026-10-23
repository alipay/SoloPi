#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifySoloPiRuntime} from './verify-solopi-runtime.mjs';
import {verifyLinuxRuntime} from './linux-runtime.mjs';
import {linuxBuildConfig} from './linux-build-config.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args=process.argv.slice(2);
const arch=args.includes('--arm64')?'arm64':'x64';
if(args.some(a=>!['--arm64','--x64','--deb','--dir','--check'].includes(a)))throw Error('Usage: package-linux.mjs [--x64|--arm64] [--deb|--dir] [--check]');
if(args.includes('--arm64')&&args.includes('--x64'))throw Error('Choose one architecture');
const config=linuxBuildConfig(root,arch);
if(process.env.LENSWIPER_ELECTRON_DIST)config.electronDist=path.resolve(process.env.LENSWIPER_ELECTRON_DIST);
if(args.includes('--check')){console.log(JSON.stringify(config,null,2));process.exit(0);}
const runtime=path.join(root,'resources/media-runtime',`linux-${arch}`);
for(const file of ['bin/scrcpy','bin/ffmpeg','bin/adb','share/scrcpy/scrcpy-server','manifest.json','LICENSES'])if(!fs.existsSync(path.join(runtime,file)))throw Error(`Linux bundled runtime missing: ${file}; prepare the complete target runtime before packaging`);
verifyLinuxRuntime(runtime,arch);
verifySoloPiRuntime(path.join(root,'resources/solopi-recording'));
const lock=path.join(root,'.solopi-desktop-package-linux.lock');
fs.mkdirSync(lock);fs.writeFileSync(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid,arch,startedAt:new Date().toISOString()}));
try{
  const run=(cmd,params,options={})=>execFileSync(cmd,params,{cwd:root,stdio:'inherit',...options});
  run(process.execPath,[path.join(root,'scripts/verify-git-runtime.mjs')],{env:{...process.env,GLASSBOX_GIT_PLATFORM:'linux',GLASSBOX_GIT_ARCH:arch}});
  run(process.execPath,[path.join(root,'scripts/prepare-packaged-app.mjs')]);
  run(process.execPath,[path.join(root,'node_modules/webpack-cli/bin/cli.js'),'--mode','production']);
  const generated=path.join(lock,'builder.json');fs.writeFileSync(generated,JSON.stringify(config));
  run(process.execPath,[path.join(root,'node_modules/electron-builder/out/cli/cli.js'),'--linux',args.includes('--deb')?'deb':'dir',`--${arch}`,'--publish','never','--config',generated]);
  verifySoloPiRuntime(path.join(config.directories.output,arch==='x64'?'linux-unpacked':'linux-arm64-unpacked','resources','solopi-recording'));
  run(process.execPath,[path.join(root,'scripts/verify-linux-package.mjs'),path.join(config.directories.output,arch==='x64'?'linux-unpacked':'linux-arm64-unpacked')]);
  if(!args.includes('--dir')&&!args.includes('--deb')){
    const unpacked=arch==='x64'?'linux-unpacked':'linux-arm64-unpacked';
    const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
    const artifact=path.join(config.directories.output,`solopi-desktop-${version}-linux-${arch}.tar.gz`);
    if(fs.existsSync(artifact))throw Error(`Artifact already exists; preserve it before rebuilding: ${artifact}`);
    const temporary=artifact+`.partial-${process.pid}`;
    try{run('tar',['-czf',temporary,'-C',config.directories.output,unpacked],{env:{...process.env,COPYFILE_DISABLE:'1'}});fs.renameSync(temporary,artifact);}
    finally{fs.rmSync(temporary,{force:true});}
    const sha256=crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
    fs.writeFileSync(artifact+'.sha256',`${sha256}  ${path.basename(artifact)}\n`,{flag:'wx'});
    console.log(`Linux package ready: ${artifact} (SHA256 ${sha256})`);
  }

}finally{fs.rmSync(lock,{recursive:true,force:true});}
