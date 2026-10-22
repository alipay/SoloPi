import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import test from 'node:test';
import {exportPublicSource,isPublicSourceFile,checkPublicFile,listPublicFiles,sourceRoot} from '../scripts/export-public-source.mjs';
import {linuxBuildConfig} from '../scripts/linux-build-config.mjs';
const require=createRequire(import.meta.url);
const localAddress=[192,168,10,11].join('.');
test('only CLI Skill is in either desktop distribution',()=>{
 const pkg=require('../package.json');
 const mac=pkg.build.extraResources.filter(x=>String(x.from).startsWith('skills'));
 const linux=linuxBuildConfig(sourceRoot).extraResources.filter(x=>String(x.from).startsWith('skills'));
 assert.equal(mac.length,1);assert.equal(mac[0].from,'skills/solopi-desktop-cli');
 assert.equal(linux.length,1);assert.equal(linux[0].from,'skills/solopi-desktop-cli');
 assert.ok(linuxBuildConfig(sourceRoot).extraResources.find(x=>x.from==='resources').filter.includes('!**/*.jar'));
});
test('source boundary excludes history, records, private Skills and native binaries',()=>{
 for(const file of ['.git/config','AGENTS.md','cert.pem','artifacts/run/report.json','issues/record.md','skills/private-skill/SKILL.md','resources/media-runtime/linux-x64/bin/ffmpeg','resources/quick-actions/private.sh','build/app-update.yml']) assert.equal(isPublicSourceFile(file),false,file);
 assert.equal(isPublicSourceFile('skills/solopi-desktop-cli/SKILL.md'),true);
 assert.equal(isPublicSourceFile('electron/main.js'),true);
});
test('privacy rejection checks values without disclosing them',()=>{
 assert.throws(()=>checkPublicFile('example.json',Buffer.from(JSON.stringify({host:'http://'+localAddress+'/service'}))),e=>e.message.includes('example.json')&&!e.message.includes('192.168'));
 assert.throws(()=>checkPublicFile('example.json',Buffer.from('-----BEGIN '+'PRIVATE KEY-----')));
});
test('export includes Electron declarations required by renderer type checking',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'public-export-types-'));
 try {
  fs.mkdirSync(path.join(root,'electron'));
  fs.writeFileSync(path.join(root,'electron/generic-action.js'),'exports.run = () => true;\n');
  fs.writeFileSync(path.join(root,'electron/generic-action.d.ts'),'export function run(): boolean;\n');
  const output=path.join(root,'candidate');exportPublicSource(output,root);
  assert.equal(fs.readFileSync(path.join(output,'electron/generic-action.d.ts'),'utf8'),'export function run(): boolean;\n');
  const manifest=JSON.parse(fs.readFileSync(path.join(output,'PUBLIC_SOURCE_MANIFEST.json'),'utf8'));
  assert.ok(manifest.files.some(entry=>entry.path==='electron/generic-action.d.ts'));
  for(const name of fs.readdirSync(path.join(sourceRoot,'electron')).filter(name=>name.endsWith('.d.ts')))
   assert.equal(isPublicSourceFile('electron/'+name),true,name);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('export validates before writing, preserves source, and refuses replacement',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'public-export-fixture-'));
 try {
  fs.mkdirSync(path.join(root,'electron'));fs.mkdirSync(path.join(root,'skills/private'),{recursive:true});
  fs.writeFileSync(path.join(root,'electron/main.js'),'// generic source\n');
  fs.writeFileSync(path.join(root,'skills/private/SKILL.md'),'private');
  const output=path.join(root,'candidate');exportPublicSource(output,root);
  assert.ok(fs.existsSync(path.join(output,'electron/main.js')));
  assert.ok(!fs.existsSync(path.join(output,'skills/private/SKILL.md')));
  assert.ok(fs.existsSync(path.join(root,'skills/private/SKILL.md')));
  assert.throws(()=>exportPublicSource(output,root),/must not exist/);
  fs.writeFileSync(path.join(root,'electron/main.js'),'const ip='+JSON.stringify(localAddress)+';');
  assert.throws(()=>exportPublicSource(path.join(root,'rejected'),root));
  assert.ok(!fs.existsSync(path.join(root,'rejected')));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('every selected source file passes privacy gate',()=>{
 for(const file of listPublicFiles()) checkPublicFile(file,fs.readFileSync(path.join(sourceRoot,file)));
});
test('CLI Skill can be installed without private companion Skills',()=>{
 const result=spawnSync(process.execPath,['scripts/verify-glassbox-skill-distribution.mjs'],{cwd:sourceRoot,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout).skills,['solopi-desktop-cli']);
});
test('public entry documents link only to included files',()=>{
 for(const file of ['README.md','docs/configuration.md','docs/public-source.md','docs/agent/glassbox-cli-usage.md']) {
  const source=fs.readFileSync(path.join(sourceRoot,file),'utf8');
  for(const match of source.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)){
   const href=match[1].split('#')[0];if(!href||/^(https?:|mailto:)/.test(href))continue;
   const target=path.relative(sourceRoot,path.resolve(sourceRoot,path.dirname(file),href)).replaceAll('\\','/');
   assert.equal(isPublicSourceFile(target),true,file+' -> '+href);
  }
 }
});

test('latest generic Agent regressions accompany the public source snapshot',()=>{
 for(const name of ['agent-progress-policy.test.mjs','agent-skill-scope.test.mjs','agent-case-evidence-export.test.mjs']) assert.equal(isPublicSourceFile('tests/'+name),true,name);
});
