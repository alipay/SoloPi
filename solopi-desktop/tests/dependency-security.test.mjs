import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url),quote=require('shell-quote'),tar=require('tar'),semver=require('semver');
const root=path.resolve(import.meta.dirname,'..');
test('lockfile resolves every affected dependency to a patched version',()=>{
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'))),lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json')));
 const minimum={electron:'44.9.1','shell-quote':'1.12.0',tar:'7.5.19'};
 for(const [name,min] of Object.entries(minimum)){
  const entries=Object.entries(lock.packages).filter(([p])=>p.endsWith('node_modules/'+name));assert.ok(entries.length,name);
  for(const [p,v] of entries)assert.ok(semver.gte(v.version,min),`${p}@${v.version} is vulnerable`);
 }
 assert.equal(pkg.overrides['shell-quote'],'1.12.0');
 assert.equal(lock.packages[''].devDependencies.electron,pkg.devDependencies.electron);
 assert.equal(lock.packages[''].devDependencies.tar,pkg.devDependencies.tar);
});
test('shell quoting rejects all line terminators after comment tokens',()=>{
 for(const newline of ['\n','\r','\u2028','\u2029'])assert.throws(()=>quote.quote(['echo','ok',{comment:'x'},`a${newline}id;#`]),TypeError);
});
test('shell quoting retains literal metacharacters for ordinary arguments',()=>{
 const value='spaces $(echo INJECTED); & "quotes"';
 const command=quote.quote(['printf','%s',value]);
 assert.equal(execFileSync('/bin/sh',['-c',command],{encoding:'utf8'}),value);
});
test('tar rejects a bounded high-ratio gzip fixture and still reads ordinary archives',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-tar-security-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.writeFileSync(path.join(dir,'normal.txt'),'ordinary source content');
 const normal=path.join(dir,'normal.tar.gz');await tar.c({file:normal,cwd:dir,gzip:true},['normal.txt']);
 const names=[];await tar.t({file:normal,onReadEntry:entry=>{names.push(entry.path);entry.resume();}});assert.deepEqual(names,['normal.txt']);
 // One MiB in an isolated temporary directory: exercise the guard without an unbounded DoS payload.
 fs.writeFileSync(path.join(dir,'zeros'),Buffer.alloc(1024*1024));
 const bomb=path.join(dir,'ratio.tar.gz');await tar.c({file:bomb,cwd:dir,gzip:true},['zeros']);
 await assert.rejects(tar.t({file:bomb,maxDecompressionRatio:10,onReadEntry:entry=>entry.resume()}),/max decompression ratio exceeded/);
});

test('installed Electron binary matches the patched lockfile runtime',()=>{
 const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json')));
 const actual=execFileSync(require('electron'),['-e','process.stdout.write(process.versions.electron)'],{encoding:'utf8',env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},timeout:15000}).trim();
 assert.equal(actual,lock.packages['node_modules/electron'].version);
 assert.ok(semver.gte(actual,'44.9.1'));
});
