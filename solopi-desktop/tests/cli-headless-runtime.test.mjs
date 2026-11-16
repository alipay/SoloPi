import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const policy=require('../electron/background-runtime');
const cli=new URL('../scripts/glassbox-cli.mjs',import.meta.url).pathname;
test('Linux background runtime chooses no-display backend without starting or installing X11 tools',()=>{
 assert.equal(policy.backgroundBackend('linux',{},()=>false),'headless');
 assert.equal(policy.backgroundBackend('linux',{DISPLAY:':99'},()=>false),'headless');
 assert.deepEqual(policy.backgroundArguments(['--glassbox-background'],{platform:'linux',env:{},exists:()=>false}),['--glassbox-background','--ozone-platform=headless']);
});
test('valid desktop sessions and non-Linux launch policy are preserved',()=>{
 for(const platform of ['darwin','win32'])assert.deepEqual(policy.backgroundArguments(['main.js'],{platform,env:{},exists:()=>false}),['main.js']);
 assert.equal(policy.backgroundBackend('linux',{DISPLAY:':3'},p=>p==='/tmp/.X11-unix/X3'),'desktop');
 assert.equal(policy.backgroundBackend('linux',{WAYLAND_DISPLAY:'wayland-1',XDG_RUNTIME_DIR:'/run/example'},p=>p==='/run/example/wayland-1'),'desktop');
 assert.equal(policy.backgroundBackend('linux',{DISPLAY:'remote.example:1'},()=>false),'desktop');
});
test('headless mode disables acceleration before app readiness and leaves desktop mode unchanged',()=>{
 let count=0;const app={disableHardwareAcceleration:()=>count++};
 assert.deepEqual(policy.configureBackgroundRuntime(app,{platform:'linux',argv:['--glassbox-background','--ozone-platform=headless'],env:{}}),{headless:true});
 assert.equal(count,1);
 policy.configureBackgroundRuntime(app,{platform:'linux',argv:[],env:{}});
 policy.configureBackgroundRuntime(app,{platform:'darwin',argv:['--glassbox-background'],env:{}});
 assert.equal(count,1);
 const source=fs.readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
 assert.ok(source.indexOf('configureBackgroundRuntime(app)')<source.indexOf("require('./agent/configuration')"));
});
test('unbound state fails discovery and library execution with a configuration error and no task side effects',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-unbound-'));
 try {
  const env={...process.env,SOLOPI_DESKTOP_DATA_DIR:dir,GLASSBOX_CLI_DATA_DIR:dir,GLASSBOX_WORKFLOW_STATE_PATH:path.join(dir,'workflow-editor-state.json')};
  for(const args of [['cases','show','example'],['cases','list'],['cases','libraries'],['run','case','example'],['run','task','--case-id','example']]) {
   const r=spawnSync(process.execPath,[cli,...args,'--json'],{env,encoding:'utf8'});assert.equal(r.status,1,r.stderr);
   const d=JSON.parse(r.stdout);assert.equal(d.errorCode,'WORKFLOW_STATE_UNAVAILABLE');
   if(args[0]==='run'){assert.equal(d.taskId,null);assert.equal(d.submitted,false);}
  }
  const r=spawnSync(process.execPath,[cli,'doctor','--json'],{env,encoding:'utf8'});const d=JSON.parse(r.stdout);
  assert.equal(d.success,false);assert.equal(d.readiness.stateReadable,false);assert.equal(d.readiness.executionVerified,false);
  const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url)));assert.equal(d.version,pkg.version);assert.match(d.build.sourceSha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(fs.readdirSync(dir),[]);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('missing case in a valid state is distinguished from an unbound data directory',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-case-missing-'));
 try {
  const file=path.join(dir,'workflow-editor-state.json');fs.writeFileSync(file,JSON.stringify({cases:[]}));
  const r=spawnSync(process.execPath,[cli,'cases','show','absent','--json'],{env:{...process.env,SOLOPI_DESKTOP_DATA_DIR:dir,GLASSBOX_WORKFLOW_STATE_PATH:file},encoding:'utf8'});
  assert.equal(JSON.parse(r.stdout).errorCode,'CASE_NOT_FOUND');assert.deepEqual(fs.readdirSync(dir),['workflow-editor-state.json']);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('native no-display package fixtures pass the real executable selection gate before launching a broker',async()=>{
 const {createHeadlessSmokeFixture}=await import('../scripts/verify-linux-headless.mjs');
 const {validateExecutableTaskSelectionForCli}=await import('../scripts/glassbox-cli.mjs');
 for(const kind of ['success','failure','stop']){
  const fixture=createHeadlessSmokeFixture(kind);
  const r=validateExecutableTaskSelectionForCli({cases:[fixture],caseEdges:{},nodePositions:{},payloadComponents:[]});
  assert.equal(r.success,true,JSON.stringify(r.validationErrors));
  assert.equal(fixture.steps.every(step=>step.device==='pc'),true);
 }
});

test('invalid stress arguments retain their error before checking library readiness',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-invalid-stress-'));
 try {
  for(const args of [['run','task','--stress-rounds','0'],['run','case','example','--stress-rounds','2']]){
   const r=spawnSync(process.execPath,[cli,...args,'--json'],{env:{...process.env,SOLOPI_DESKTOP_DATA_DIR:dir,GLASSBOX_CLI_DATA_DIR:dir},encoding:'utf8'});
   assert.equal(r.status,2,r.stderr);assert.equal(JSON.parse(r.stdout).errorCode,'INVALID_STRESS_OPTIONS');
  }
  assert.deepEqual(fs.readdirSync(dir),[]);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
