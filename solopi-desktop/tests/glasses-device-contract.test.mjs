import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {prepareWorkflowExecution}=require('../electron/workflow-execution-gate');
const {collectRequiredDeviceRoles}=require('../electron/task-device-selection');
const {performanceOptionsSchema}=require('../electron/workflow-performance');
const {createTools}=require('../electron/agent/tools');
const Ajv=require('ajv');
const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const fixture=()=>({cases:[{id:'generic-case',steps:[{id:'action',type:'adb_command',device:'glasses'}]}],devices:{glasses:{serial:'glasses-fixture',packageName:'org.example.device'}}});
test('glasses roles propagate through execution defaults, device leases and performance schema',()=>{
 const input=fixture(),p=prepareWorkflowExecution(input);
 assert.deepEqual([...collectRequiredDeviceRoles(p)],['glasses']);
 assert.equal(p.cases[0].defaults.glassesSerial,'glasses-fixture');
 assert.equal(p.cases[0].defaults.glassesPackage,'org.example.device');
 assert.deepEqual(p.reservedDeviceSerials,['glasses-fixture']);assert.equal(input.cases[0].defaults,undefined);
 const validate=new Ajv({strict:false}).compile(performanceOptionsSchema);
 assert.equal(validate({glasses:true,targets:{glasses:{serial:'glasses-fixture',packageName:'org.example.device'}}}),true);
 assert.equal(validate({glass:true,targets:{glass:{serial:'glasses-fixture'}}}),false);
});
test('obsolete device roles fail explicitly before task dispatch; native tools expose only canonical keys',async()=>{
 const old=fixture();old.devices={glass:{serial:'fixture'}};
 assert.throws(()=>prepareWorkflowExecution(old),{code:'INVALID_DEVICE_ROLE'});
 const badStep=fixture();badStep.cases[0].steps[0].device='glass';
 assert.throws(()=>prepareWorkflowExecution(badStep),{code:'INVALID_DEVICE_ROLE'});
 const tools=await createTools({invoke:()=>assert.fail('schema validation must not execute'),readState:()=>({}),skillsRoots:()=>[],config:()=>({}),mcp:{}})({});
 const submit=tools.find(t=>t.name==='submit_task');
 const validate=new Ajv({strict:false}).compile(submit.schema);
 assert.equal(validate({caseIds:['generic'],devices:{glasses:{serial:'fixture'}},startOptions:{recordGlassesScreen:true}}),true);
 assert.equal(validate({caseIds:['generic'],devices:{glass:{serial:'fixture'}}}),false);
 assert.equal(validate({caseIds:['generic'],startOptions:{recordGlassScreen:true}}),false);
 assert.match(tools.find(t=>t.name==='list_devices').description,/smart glasses/);
});
test('CLI advertises canonical device flags and rejects obsolete arguments without starting a runtime',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'glasses-contract-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const run=args=>spawnSync(process.execPath,['scripts/glassbox-cli.mjs',...args],{encoding:'utf8',env:{...process.env,GLASSBOX_CLI_DATA_DIR:path.join(dir,'data')}});
 const help=run(['run','task','--help']);assert.equal(help.status,0);assert.match(help.stdout,/--glasses/);assert.doesNotMatch(help.stdout,/--glass(?:\s|-)/);
 for(const args of [['--glass','fixture'],['--glass-package','org.example.device'],['--record-glass-screen'],['--show-glass-screen']]){
  const r=run(['run','task','--case-id','generic',...args,'--json']);assert.equal(r.status,2,r.stdout+r.stderr);
  assert.equal(JSON.parse(r.stdout).errorCode,'INVALID_RUN_ARGUMENTS');
 }
 assert.equal(fs.existsSync(path.join(dir,'data')),false);
});
test('sidebar and device headers use the requested brand and unambiguous glasses terminology',()=>{
 for(const file of ['src/components/Sidebar.tsx','src/components/Sidebar.vue']){
  const text=read(file);assert.match(text,/>SoloPi</);assert.match(text,/Smart Device Test Harness/);assert.doesNotMatch(text,/AI Glass(?:es)? Tester/);
 }
 for(const file of ['src/components/DeviceHeader.tsx','src/components/DeviceHeader.vue'])assert.match(read(file),/眼镜设备 \/ Glasses/);
 assert.match(read('skills/solopi-desktop-cli/SKILL.md'),/smart glasses/);
});
test('system icon artwork is centered within transparent native-size margins on every packaged platform',async()=>{
 const png=fs.readFileSync(new URL('../resources/branding/solopi-desktop-app-icon.png',import.meta.url));
 assert.equal(png.readUInt32BE(16),1024);assert.equal(png.readUInt32BE(20),1024);assert.equal(png[25],6);
 const chunks=[];for(let i=8;i<png.length;){const size=png.readUInt32BE(i),type=png.toString('ascii',i+4,i+8);if(type==='IDAT')chunks.push(png.subarray(i+8,i+8+size));i+=size+12;}
 const raw=zlib.inflateSync(Buffer.concat(chunks)),stride=4096;let previous=Buffer.alloc(stride),minX=1024,minY=1024,maxX=-1,maxY=-1;
 for(let y=0;y<1024;y++){
  const filter=raw[y*(stride+1)],row=Buffer.from(raw.subarray(y*(stride+1)+1,(y+1)*(stride+1)));
  for(let x=0;x<stride;x++){
   const a=x>=4?row[x-4]:0,b=previous[x],c=x>=4?previous[x-4]:0;
   const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
   const predictor=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):pa<=pb&&pa<=pc?a:pb<=pc?b:c;
   row[x]=(row[x]+predictor)&255;
  }
  for(let x=0;x<1024;x++)if(row[x*4+3]){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
  previous=row;
 }
 assert.deepEqual([minX,minY,maxX,maxY],[100,100,923,923]);
 const manifest=JSON.parse(read('package.json'));
 assert.equal(manifest.build.extraResources.find(x=>x.to==='dock-icon.png').from,'resources/branding/solopi-desktop-app-icon.png');
 const {linuxBuildConfig}=await import('../scripts/linux-build-config.mjs');
 for(const arch of ['x64','arm64'])assert.equal(linuxBuildConfig('/fixture',arch).extraResources.find(x=>x.to==='dock-icon.png').from,'resources/branding/solopi-desktop-app-icon.png');
});
test('one-time data upgrade updates device metadata and templates while preserving external contracts and audit text',async()=>{
 const {upgradeGlassesContract}=await import('../scripts/upgrade-glasses-contract.mjs');
 const old={devices:{glass:{serial:'fixture'}},defaults:{glassSerial:'fixture',glassPackage:'org.vendor.glass.app'},
  steps:[{device:'glass',config:{pushDevice:'glass',command:'adb -s ${defaults.glassSerial} shell echo {{glassPackage}}'}}],
  params:[{key:'pushDevice',defaultValue:'glass'}],messages:[{content:'original glass terminology'}],stdout:'com.alipay.glass.autotest'};
 const before=JSON.stringify(old),r=upgradeGlassesContract(old);assert.ok(r.changes>0);assert.deepEqual(r.conflicts,[]);
 assert.equal(r.value.defaults.glassesPackage,'org.vendor.glass.app');assert.equal(r.value.devices.glasses.serial,'fixture');
 assert.equal(r.value.steps[0].device,'glasses');assert.equal(r.value.params[0].defaultValue,'glasses');
 assert.match(r.value.steps[0].config.command,/defaults.glassesSerial/);assert.match(r.value.steps[0].config.command,/\{\{glassesPackage\}\}/);
 assert.deepEqual(r.value.messages,old.messages);assert.equal(r.value.stdout,old.stdout);assert.equal(JSON.stringify(old),before);
 assert.equal(upgradeGlassesContract(r.value).changes,0);
 assert.deepEqual(upgradeGlassesContract({glassSerial:'old',glassesSerial:'new'}).conflicts,['$.glassSerial']);
});
test('offline upgrade backs up exact input bytes and is idempotent without adding a runtime alias',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'glasses-upgrade-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'state.json'),raw='{ "deviceBindings": { "glassSerials": ["fixture"] } }';fs.writeFileSync(file,raw);
 const run=()=>spawnSync(process.execPath,['scripts/upgrade-glasses-contract.mjs',file],{encoding:'utf8'});
 const first=run();assert.equal(first.status,0,first.stderr);const receipt=JSON.parse(first.stdout).files[0];
 assert.equal(fs.readFileSync(receipt.backup,'utf8'),raw);assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')).deviceBindings,{glassesSerials:['fixture']});
 const second=run();assert.equal(JSON.parse(second.stdout).files[0].changes,0);assert.equal(fs.readdirSync(dir).length,2);
});
