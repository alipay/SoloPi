import {verifyStagedCliFile} from '../scripts/verify-staged-cli.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import test from 'node:test';
import {exportPublicSource,isPublicSourceFile,publicSourceBytes,checkPublicFile,listPublicFiles,sourceRoot,publicSourceDigest,publicSourcePath} from '../scripts/export-public-source.mjs';
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
 assert.equal(isPublicSourceFile('skills/solopi-lab-task-ops/SKILL.md'),true);
 assert.equal(isPublicSourceFile('skills/solopi-lab-agent/SKILL.md'),true);
 assert.equal(isPublicSourceFile('.private-local/skills/solopi-enterprise-test-integration/SKILL.md'),false);
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
  fs.mkdirSync(path.join(root,'.private-local'),{recursive:true});
  fs.writeFileSync(path.join(root,'.private-local/runtime-adapter.cjs'),'// '+localAddress);
  fs.writeFileSync(path.join(root,'skills/private/SKILL.md'),'private');
  const output=path.join(root,'candidate');exportPublicSource(output,root);
  assert.ok(fs.existsSync(path.join(output,'electron/main.js')));
  assert.ok(!fs.existsSync(path.join(output,'.private-local')));
  assert.ok(!fs.existsSync(path.join(output,'skills/private/SKILL.md')));
  assert.ok(fs.existsSync(path.join(root,'skills/private/SKILL.md')));
  assert.throws(()=>exportPublicSource(output,root),/must not exist/);
  fs.writeFileSync(path.join(root,'electron/main.js'),'const ip='+JSON.stringify(localAddress)+';');
  assert.throws(()=>exportPublicSource(path.join(root,'rejected'),root));
  assert.ok(!fs.existsSync(path.join(root,'rejected')));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('every selected source file passes privacy gate',()=>{
 for(const file of listPublicFiles()) checkPublicFile(file,publicSourceBytes(file,fs.readFileSync(publicSourcePath(sourceRoot,file))));
});
test('CLI Skill can be installed without private companion Skills',()=>{
 const result=spawnSync(process.execPath,['scripts/verify-glassbox-skill-distribution.mjs'],{cwd:sourceRoot,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout).skills,['solopi-desktop-cli','solopi-lab-task-ops','solopi-lab-agent']);
});
test('public entry documents link only to included files',()=>{
 for(const file of ['README.md','docs/configuration.md','docs/public-source.md','docs/agent/glassbox-cli-usage.md']) {
  const source=fs.readFileSync(path.join(sourceRoot,file),'utf8');
  for(const match of source.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)){
   const href=match[1].split('#')[0];if(!href||/^(https?:|mailto:)/.test(href))continue;
   let target=path.relative(sourceRoot,path.resolve(sourceRoot,path.dirname(file),href)).replaceAll('\\','/');
   if(target.startsWith('../solopi-lab-server/'))target='lab-server/'+target.slice('../solopi-lab-server/'.length);
   assert.equal(isPublicSourceFile(target),true,file+' -> '+href);
  }
 }
});

test('latest generic Agent regressions accompany the public source snapshot',()=>{
 for(const name of ['agent-progress-policy.test.mjs','agent-skill-scope.test.mjs','agent-case-evidence-export.test.mjs']) assert.equal(isPublicSourceFile('tests/'+name),true,name);
});

test('README declares the existing SoloPi Apache license without obsolete pending-authorization text',()=>{
 const readme=fs.readFileSync(path.join(sourceRoot,'README.md'),'utf8');
 assert.match(readme,/遵循 SoloPi 项目的 \*\*Apache License 2\.0\*\*/);
 assert.match(readme,/\[LICENSE\]\(LICENSE\)/);
 assert.doesNotMatch(readme,/拟采用|尚未提供正式|许可证待办|不能把这段说明视为已经完成/);
 assert.match(fs.readFileSync(path.join(sourceRoot,'LICENSE'),'utf8'),/Apache License[\s\S]*Version 2\.0/);
});

test('public generic regressions include their Node/Harness fixture dependencies and transport evidence tests',()=>{
 for(const name of ['fixtures/native-harness.mjs','fixtures/harness-lifecycle.mjs','fixtures/node-broker.mjs','model-transport-trace.test.mjs','platform-tool-parity.test.mjs'])assert.equal(isPublicSourceFile('tests/'+name),true,name);
 const sidebar=fs.readFileSync(path.join(sourceRoot,'src/components/Sidebar.vue'),'utf8');assert.match(sidebar,/>用户<\/span>/);
});

test('cluster connection documentation and CommonJS implementation accompany public source',()=>{
 for(const file of ['docs/cluster-client.md','electron/cluster-client/identity.cjs','electron/cluster-client/desktop-service.cjs']) assert.equal(isPublicSourceFile(file),true,file);
 assert.equal(isPublicSourceFile('electron/cluster-client/identity.json.private'),false);
});

test('public runtime core has configurable adapters and no enterprise catalog dependency',()=>{
 assert.equal(fs.existsSync(path.join(sourceRoot,'electron/agent/antcc-models.cjs')),false);
 for(const name of ['electron/agent/runtime-registry.cjs','electron/agent/local-runtime.cjs','electron/agent/harness-host.mjs']){
  const bytes=fs.readFileSync(path.join(sourceRoot,name));assert.doesNotThrow(()=>checkPublicFile(name,bytes));assert.doesNotMatch(bytes.toString(),/antcc|antcodex|cfuse|codefuse|antchat/i);
 }
 assert.equal(isPublicSourceFile('.private-local/runtime-adapters/model-catalog.cjs'),false);
});


test('public Web test command retains its setup, regressions and fixture dependencies',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'public-web-tests-'));
 try{
  const files=['lab-web/test/setup.ts','lab-web/test/fixtures.ts','lab-web/test/nested/sample.test.tsx','lab-web/test/nested/fixture.json'];
  for(const file of files){assert.equal(isPublicSourceFile(file),true,file);fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),file.endsWith('.json')?'{}':'// generic fixture\n');}
  for(const file of ['lab-web/test/.env','lab-web/test/report.log','lab-web/test/credentials.pem'])assert.equal(isPublicSourceFile(file),false,file);
  const output=path.join(root,'export');exportPublicSource(output,root);
  const exported=JSON.parse(fs.readFileSync(path.join(output,'PUBLIC_SOURCE_MANIFEST.json'),'utf8')).files.map(f=>f.path);
  for(const file of files)assert.ok(exported.includes(file),file);
  fs.writeFileSync(path.join(root,files[0]),'const endpoint="http://'+localAddress+'";');
  assert.throws(()=>exportPublicSource(path.join(root,'rejected'),root),/Private reference/);
  assert.equal(fs.existsSync(path.join(root,'rejected')),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('packaging fingerprint reads shared contracts from both supported directory layouts', t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-source-hash-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 for(const split of [false,true]){
  const root=path.join(dir,split?'split/solopi-desktop':'flat');
  const server=split?path.join(root,'../solopi-lab-server'):path.join(root,'lab-server');
  const contracts=split?path.join(server,'contracts'):path.join(root,'contracts');
  fs.mkdirSync(root,{recursive:true});fs.mkdirSync(server,{recursive:true});fs.writeFileSync(path.join(root,'package.json'),'{}');fs.writeFileSync(path.join(server,'package.json'),'{}');
  const schema=path.join(contracts,'v0.1.0/schemas/cli-output.schema.json');fs.mkdirSync(path.dirname(schema),{recursive:true});fs.writeFileSync(schema,'{}');
  const before=publicSourceDigest(root);assert.match(before,/^[a-f0-9]{64}$/);
  fs.writeFileSync(schema,'{"changed":true}');assert.notEqual(publicSourceDigest(root),before);
 }
});

test('packaging verifies bundled CLI bytes against pre-sign output and rejects tampering',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-staged-cli-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const root=path.join(dir,'source'),resources=path.join(dir,'package');
 fs.mkdirSync(path.join(root,'build/packaged-cli'),{recursive:true});fs.mkdirSync(path.join(resources,'cli'),{recursive:true});fs.mkdirSync(path.join(root,'electron'),{recursive:true});
 fs.writeFileSync(path.join(root,'electron/diagnostics.js'),'require("./support")');
 fs.writeFileSync(path.join(root,'build/packaged-cli/diagnostics.cjs'),'bundled code including support');fs.writeFileSync(path.join(resources,'cli/diagnostics.cjs'),'bundled code including support');
 assert.doesNotThrow(()=>verifyStagedCliFile(resources,root,'diagnostics.cjs'));
 fs.appendFileSync(path.join(resources,'cli/diagnostics.cjs'),'tampered');assert.throws(()=>verifyStagedCliFile(resources,root,'diagnostics.cjs'),/differs from pre-sign/);
 fs.rmSync(path.join(root,'build/packaged-cli/diagnostics.cjs'));assert.throws(()=>verifyStagedCliFile(resources,root,'diagnostics.cjs'),/ENOENT/);
});

test('public export preserves executable launchers without granting execute to data',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-export-mode-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=path.join(dir,'source'),out=path.join(dir,'output');fs.mkdirSync(path.join(source,'resources/bin'),{recursive:true});
 fs.writeFileSync(path.join(source,'package.json'),'{}',{mode:0o644});fs.writeFileSync(path.join(source,'resources/bin/solopi-desktop'),'#!/bin/sh\nexit 0\n',{mode:0o755});
 exportPublicSource(out,source);
 assert.equal(fs.statSync(path.join(out,'resources/bin/solopi-desktop')).mode&0o777,0o755);
 assert.equal(fs.statSync(path.join(out,'package.json')).mode&0o777,0o644);
});

test('public export includes the local security fork and reproducible Web install options',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'public-security-fork-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const root=path.join(dir,'source');fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'package.json'),'{}');
 const vendor='vendor/picomatch';fs.cpSync(path.join(sourceRoot,vendor),path.join(root,vendor),{recursive:true});
 fs.mkdirSync(path.join(root,'lab-web'),{recursive:true});fs.writeFileSync(path.join(root,'lab-web/.npmrc'),'registry=https://registry.npmjs.org\ninstall-links=true\n');
 const output=path.join(dir,'output');exportPublicSource(output,root);
 for(const name of ['LICENSE','package.json','patch-provenance.json','SECURITY_PATCH.md','lib/parse.js','index.js']){assert.ok(fs.readFileSync(path.join(output,vendor,name)).equals(fs.readFileSync(path.join(root,vendor,name))),name);}
 assert.match(fs.readFileSync(path.join(output,'lab-web/.npmrc'),'utf8'),/install-links=true/);
 assert.equal(isPublicSourceFile('vendor/picomatch/.env'),false);assert.equal(isPublicSourceFile('vendor/picomatch/private.key'),false);
});
