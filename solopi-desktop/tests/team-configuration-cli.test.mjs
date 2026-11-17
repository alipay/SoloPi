import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const source=fs.readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
const definition=source.match(/async function processCliControlPayload\([^]*?\n\}/)[0];
for(const dryRun of [true,false])test(`team CLI uses the shared ${dryRun?'validation':'import'} service and acknowledges its actual result`,async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lw-team-cli-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const manifest={schemaVersion:'lenswiper.team-config.v1',id:'test',name:'Team',version:'1'};
 const file=path.join(root,'payload.json'),ack=path.join(root,'ack.json');fs.writeFileSync(file,JSON.stringify({action:'team-config',manifest,dryRun,dataDir:root,ackPath:ack}));
 const calls=[];
 const handler=Function('fs','path','app','invokeApplicationHandler','writeJsonFileAtomic',definition+';return processCliControlPayload;')(fs,path,{getPath:()=>root},async(channel,event,input)=>{calls.push({channel,event,input});return{success:true,receipt:'persisted'};},(f,data)=>fs.writeFileSync(f,JSON.stringify(data)));
 const result=await handler(file);assert.equal(result.receipt,'persisted');assert.equal(calls.length,1);assert.equal(calls[0].channel,dryRun?'team-config:validate':'team-config:import');assert.deepEqual(calls[0].input,{manifest,overwrite:true});assert.equal(JSON.parse(fs.readFileSync(ack)).receipt,'persisted');
});
test('invalid team CLI options and JSON fail before starting a broker',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lw-team-cli-invalid-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'bad.json');fs.writeFileSync(file,'invalid');
 for(const args of [['--unknown'],['--file'],['--file',file]]){
  const r=spawnSync(process.execPath,['scripts/glassbox-cli.mjs','config','import-team',...args,'--json'],{encoding:'utf8',env:{...process.env,GLASSBOX_CLI_DATA_DIR:path.join(root,'data')}});
  assert.equal(r.status,1);assert.equal(JSON.parse(r.stdout).success,false);assert.equal(fs.existsSync(path.join(root,'data')),false);
 }
});
test('Linux bundle includes the public CLI Skill and only target Git runtime',async()=>{
 const {linuxBuildConfig}=await import('../scripts/linux-build-config.mjs');const config=linuxBuildConfig('/fixture','x64');
 assert.ok(config.extraResources.some(x=>x.from==='skills/solopi-desktop-cli'&&x.to==='skills/solopi-desktop-cli'));
 assert.ok(config.extraResources.some(x=>x.from==='resources/git-runtime/linux-x64'&&x.to==='git-runtime/linux-x64'));
 assert.ok(config.extraResources.find(x=>x.from==='resources').filter.includes('!git-runtime{,/**}'));
});

test('locked storage rejects the configuration before notifying or changing the editor',async()=>{
 const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);
 const {createConfigurationBridge}=require('../electron/agent/configuration');const {protectSecrets,prepareSecretsForDisplay}=require('../electron/secret-storage');
 let messages=0;const pending=new Map();const bridge=createConfigurationBridge({readState:()=>({}),sender:()=>({send(){messages++;}}),pending,preparePatch:()=>prepareSecretsForDisplay(protectSecrets({llmProviders:[{apiKey:'fixture'}]},{isEncryptionAvailable:()=>false}))});
 await assert.rejects(bridge(null),/系统安全存储不可用/);assert.equal(messages,0);assert.equal(pending.size,0);
 assert.match(source,/preparePatch: state => prepareSecretsForDisplay\(protectSecrets\(preparePatch\(state\),safeStorage\)\)/);
});
test('Linux distribution includes executable Skill helpers as well as references',async()=>{
 const {linuxBuildConfig}=await import('../scripts/linux-build-config.mjs');assert.ok(linuxBuildConfig('/fixture','x64').extraResources.find(x=>x.from==='skills/solopi-desktop-cli').filter.includes('**/*'));
});
