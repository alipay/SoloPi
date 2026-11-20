import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const require=createRequire(import.meta.url);
const {VERSION,validateManifest,configurationPatch,exportManifest,createImporter}=require('../electron/team-configuration');
const {installTeamConfiguration}=require('../electron/team-configuration-ipc');
const {readQuickActionDefinition}=require('../electron/quick-actions');
const {requestModel}=require('../electron/agent/model');
const base=()=>({schemaVersion:VERSION,id:'fixture',name:'测试团队',version:'1'});
const model=()=>({id:'one',name:'Test',model:'model',baseUrl:'https://example.test/v1',protocol:'openai-compatible'});
function fixture(t,overrides={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lw-team-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  let state={},environment={},actions=[],saved='',net=0;const handlers=new Map();const events=[];
  const deps={register:(k,f)=>handlers.set(k,f),directory:()=>root,readState:()=>state,readEnvironment:()=>environment,savePatch:async prepare=>{state={...state,...prepare(state)};return {success:true};},saveEnvironment:async tts=>{environment={...environment,ttsProvider:tts};return {success:true};},pullCases:async()=>{net++;return {success:true};},loadCaseCodec:async()=>({parseCaseLibraryFilesForCli:()=>({cases:[]}),mergePulledCaseLibraryIntoStateForCli:()=>({})}),readActions:()=>actions,writeActions:a=>{actions=a;},readDefinition:readQuickActionDefinition,importScripts:async()=>{net++;return {success:true};},saveFile:async content=>{saved=content;return {success:true};},notify:(e,p)=>events.push([e,p]),...overrides};
  installTeamConfiguration(deps);
  return {call:(k,p)=>handlers.get('team-config:'+k)(null,p),setState:s=>{state=s;},state:()=>state,environment:()=>environment,actions:()=>actions,saved:()=>saved,events,root,net:()=>net};
}
test('validates all sections and does not require credentials',()=>{
  const m={...base(),caseRepositories:[{id:'lib',repoUrl:'git@example.test:team/cases.git',branch:'main'}],shortcutRepositories:[{id:'short',repoUrl:'https://example.test/scripts.git',directory:'scripts'}],llmProviders:[model()],selectedLlmProviderId:'one',ttsProvider:{enabled:true,url:'https://example.test/tts',headersText:'{}'},deviceBindings:{phoneSerials:['A'],glassesSerials:['B'],phoneDefaultPackage:'com.example.phone'}};
  assert.deepEqual(validateManifest(m),m);
  const patch=configurationPatch({},m);assert.equal(patch.llmProviders[0].apiKey,'');assert.deepEqual(patch.deviceBindings.glassesSerials,['B']);
});
test('rejects malformed schema, duplicate IDs, traversal, invalid role and unknown fields before effects',async t=>{
  const f=fixture(t);
  for(const bad of [{...base(),schemaVersion:'future'}, {...base(),llmProviders:[model(),model()]}, {...base(),deviceBindings:{phoneSerials:['A'],glassesSerials:['A']}}, {...base(),shortcutRepositories:[{id:'x',repoUrl:'https://example.test/x',directory:'../outside'}]}, {...base(),quickActions:[{id:'x',fileName:'../x.sh',content:'echo hi'}]}, {...base(),llmProviders:[{...model(),something:'unknown'}]}]) {
    assert.throws(()=>validateManifest(bad));assert.equal((await f.call('import',{manifest:bad})).success,false);
  }
  assert.equal(f.net(),0);assert.deepEqual(f.state(),{});
});
test('imported keys are used, omitted keys clear referenced credentials, unrelated models remain',async t=>{
  const f=fixture(t);f.setState({llmProviders:[{...model(),apiKey:'OLD'},{...model(),id:'other',apiKey:'KEEP'}]});
  assert.equal((await f.call('import',{manifest:{...base(),llmProviders:[{...model(),apiKey:'NEW'}]}})).success,true);assert.equal(f.state().llmProviders[0].apiKey,'NEW');
  await f.call('import',{manifest:{...base(),llmProviders:[model()],ttsProvider:{url:'https://example.test/tts'}}});
  assert.equal(f.state().llmProviders[0].apiKey,'');assert.equal(f.state().llmProviders[1].apiKey,'KEEP');assert.equal(f.environment().ttsProvider.headersText,'');
});
test('preserve mode keeps existing providers/device defaults without blocking new entries',()=>{
  const s={llmProviders:[{...model(),apiKey:'LOCAL'}],deviceBindings:{phoneDefaultPackage:'com.local.app',phoneSerials:['LOCAL']}};
  const m={...base(),llmProviders:[{...model(),apiKey:'TEAM'},{...model(),id:'two'}],deviceBindings:{phoneDefaultPackage:'com.team.app',glassesSerials:['GLASSES']}};
  const p=configurationPatch(s,m,false);assert.equal(p.llmProviders[0].apiKey,'LOCAL');assert.equal(p.llmProviders.length,2);assert.equal(p.deviceBindings.phoneDefaultPackage,'com.local.app');assert.deepEqual(p.deviceBindings.glassesSerials,['GLASSES']);
});
test('export include/exclude keys is explicit, reloadable and excludes machine paths',async t=>{
  const f=fixture(t);f.setState({llmProviders:[{...model(),apiKey:'TOP_SECRET',contextWindowTokens:65536}],deviceBindings:{phoneSerials:['A'],glassesDefaultPackage:'com.example.glasses'},caseLibraries:[{id:'lib',name:'Lib',repoUrl:'https://example.test/cases.git',gitBranch:'main',authToken:'GIT_SECRET',repoPath:'/private/not-portable'}]});
  await f.call('import',{manifest:{...base(),ttsProvider:{url:'https://example.test/tts',headersText:'{"Authorization":"Bearer TTS_SECRET"}'}}});
  for (const includeKeys of [false,true]) {
    assert.equal((await f.call('export',{includeKeys})).success,true);const m=validateManifest(f.saved());
    assert.equal(f.saved().includes('TOP_SECRET'),includeKeys);assert.equal(f.saved().includes('GIT_SECRET'),includeKeys);assert.equal(f.saved().includes('TTS_SECRET'),includeKeys);assert.equal(f.saved().includes('/private/not-portable'),false);assert.equal(m.llmProviders[0].contextWindowTokens,65536);
  }
});
test('inline scripts import without execution and reimport uses the same ID, including exported roundtrip',async t=>{
  const f=fixture(t);const marker=path.join(f.root,'MUST_NOT_RUN');
  const m={...base(),quickActions:[{id:'action',fileName:'sample.sh',content:`#!/bin/sh\ntouch '${marker}'\n`,configuration:{name:'Sample',usageInstructions:'Creates a marker only when explicitly run. Verify file; clean the same marker.',inputs:[],args:[]},showInToolbar:true}]};
  await f.call('import',{manifest:m});const id=f.actions()[0].id;
  await f.call('import',{manifest:m});assert.equal(f.actions().length,1);assert.equal(f.actions()[0].id,id);assert.equal(fs.existsSync(marker),false);
  await f.call('export',{includeKeys:false,id:'fixture'});const exported=JSON.parse(f.saved());assert.equal(exported.quickActions[0].id,'action');assert.equal(exported.quickActions[0].configuration.usageInstructions,m.quickActions[0].configuration.usageInstructions);await f.call('import',{manifest:exported});assert.equal(f.actions().length,1);
});
test('partial failure preserves completed configuration, reports source step without leaking key, and can retry',async t=>{
  let fail=true;const f=fixture(t,{importScripts:async()=>{if(fail)throw Error('TOP_SECRET raw network error');return {success:true};}});
  const m={...base(),llmProviders:[{...model(),apiKey:'TOP_SECRET'}],shortcutRepositories:[{id:'scripts',repoUrl:'https://example.test/repo'}]};
  const r=await f.call('import',{manifest:m});assert.equal(r.success,false);assert.equal(f.state().llmProviders[0].apiKey,'TOP_SECRET');assert.equal(r.steps.at(-1).id,'shortcuts:scripts');assert.equal(JSON.stringify(r).includes('TOP_SECRET'),false);
  assert.equal(fs.readFileSync(path.join(f.root,'team-configuration','state.json'),'utf8').includes('TOP_SECRET'),false);fail=false;assert.equal((await f.call('import',{manifest:m})).success,true);assert.equal(f.state().llmProviders.length,1);
});
test('editor save rejection preserves independent TTS but prevents Git imports',async t=>{
  let envCalls=0,net=0;
  const f=fixture(t,{savePatch:async()=>({success:false,error:'no ACK'}),saveEnvironment:()=>{envCalls++;},pullCases:()=>{net++;}});
  const r=await f.call('import',{manifest:{...base(),llmProviders:[model()],ttsProvider:{url:'https://example.test/tts'},caseRepositories:[{id:'lib',repoUrl:'https://example.test/cases'}]}});
  assert.equal(r.success,false);assert.equal(envCalls,1);assert.equal(net,0);
  assert.equal(r.steps.find(s=>s.id==='tts').status,'success');
});
test('first-run guide also introduces preconfigured defaults, resumes state and remains dismissed after service reload',async t=>{
  const f=fixture(t);assert.equal((await f.call('status')).showWelcome,true);
  f.setState({llmProviders:[model()]});assert.equal((await f.call('status')).showWelcome,true);
  await f.call('onboarding',{step:1,status:'active'});assert.equal((await f.call('status')).onboarding.step,1);
  await f.call('onboarding',{step:1,status:'dismissed'});assert.equal((await f.call('status')).showWelcome,false);
  const m=JSON.parse(fs.readFileSync(path.join(f.root,'team-configuration','state.json')));assert.equal(m.onboarding.status,'dismissed');
});
test('device-only confirmation persists a complete mapping, rejects role duplication and makes no network request',async t=>{
  const f=fixture(t);const r=await f.call('devices',{deviceBindings:{phoneSerials:['A'],glassesSerials:['B']}});assert.equal(r.success,true);assert.equal(f.state().deviceBindings.phoneDefaultPackage,'');
  await assert.rejects(f.call('devices',{deviceBindings:{phoneSerials:['A'],glassesSerials:['A']}}));assert.equal(f.net(),0);
});
test('single-flight imports reject concurrent duplicate invocation',async()=>{
  let release;let entered;const started=new Promise(r=>entered=r);const waiting=new Promise(r=>release=r);
  const importer=createImporter({readState:()=>({}),savePatch:async()=>{entered();await waiting;return {success:true};},readEnvironment:()=>({})});
  const one=importer(base());await started;assert.equal((await importer(base())).errorCode,'TEAM_IMPORT_BUSY');release();assert.equal((await one).success,true);
});
test('model request without a key sends no authorization header; supplied key is used',async()=>{
  for(const apiKey of ['',undefined,'fixture-key']) {
    let headers;
    const r=await requestModel({provider:{...model(),apiKey},messages:[{role:'user',content:'hello'}],tools:[],fetchImpl:async(_url,opts)=>{headers=opts.headers;return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'ok'}}]})};}});
    assert.equal(r.content,'ok');assert.equal(headers.Authorization,apiKey?'Bearer fixture-key':undefined);
  }
});
test('actual case codec import preserves workflow graphs, library paths, latest credentials and unrelated cases',async t=>{
  const codec=await import('../scripts/glassbox-cli.mjs');
  const testCase={id:'case-fixture',name:'Generic PC fixture',folderId:'fixture-folder',steps:[{id:'start',type:'start',name:'Start'},{id:'end',type:'end',name:'End'}]};
  const workspace={schemaVersion:'glassbox.case-library.workspace.v1',name:'Fixture',folders:[{id:'fixture-folder',name:'Fixture'}],cases:[testCase],caseEdges:{'case-fixture':[{id:'edge',source:'start',target:'end'}]}};
  const payload={success:true,repoId:'fixture',repoPath:'/isolated/fixture',manifest:{name:'Fixture'},files:[{name:'workspace.json',relativePath:'workspace.json',content:JSON.stringify(workspace)}],gitInfo:{branch:'main'}};
  const f=fixture(t,{loadCaseCodec:async()=>codec,pullCases:async()=>payload});
  f.setState({cases:[{id:'local',name:'Local',steps:[],folderId:'local-folder'}],caseFolders:[{id:'local-folder',libraryId:'local-library',name:'Local'}],caseLibraries:[],components:[]});
  const m={...base(),caseRepositories:[{id:'lib',repoUrl:'https://example.test/cases.git',branch:'main',authToken:'NEW'}]};
  assert.equal((await f.call('import',{manifest:m})).success,true);assert.equal(f.state().cases.length,2);assert.equal(f.state().caseEdges['case-fixture'][0].target,'end');assert.equal(f.state().caseLibraries.find(l=>l.id==='lib').localRepoPath,'/isolated/fixture');
  assert.equal((await f.call('import',{manifest:m})).success,true);assert.equal(f.state().cases.length,2);assert.equal(f.state().caseLibraries.filter(l=>l.id==='lib').length,1);assert.equal(f.state().caseLibraries.find(l=>l.id==='lib').authToken,'NEW');
});
test('git shortcut export retains per-script arguments and toolbar settings without local paths',()=>{
  const a={id:'local-action',scriptPath:'/local/not-portable/example.sh',name:'Example',inputs:[],args:['--check'],showInToolbar:true,gitSource:{key:'source',repoUrl:'https://example.test/scripts.git',branch:'main',directory:'scripts',relativePath:'scripts/example.sh'}};
  const m=exportManifest({state:{},environment:{},actions:[a],readScript:()=>{throw Error('must not read cloned script when exporting source reference');}});
  assert.equal(m.shortcutRepositories[0].overrides[0].configuration.args[0],'--check');assert.equal(m.shortcutRepositories[0].overrides[0].showInToolbar,true);assert.equal(JSON.stringify(m).includes('/local/'),false);
});
test('imported case IDs may not overwrite an unrelated local library',async t=>{
  const codec=await import('../scripts/glassbox-cli.mjs');
  const f=fixture(t,{loadCaseCodec:async()=>codec,pullCases:async()=>({success:true,repoId:'r',files:[{name:'workspace.json',relativePath:'workspace.json',content:JSON.stringify({schemaVersion:'glassbox.case-library.workspace.v1',cases:[{id:'collision',name:'Remote',steps:[]}]})}]})});
  f.setState({cases:[{id:'collision',name:'Local',folderId:'local',steps:[]}],caseFolders:[{id:'local',libraryId:'other'}],caseLibraries:[]});
  const r=await f.call('import',{manifest:{...base(),caseRepositories:[{id:'lib',repoUrl:'https://example.test/repo'}]}});assert.equal(r.success,false);assert.equal(f.state().cases[0].name,'Local');
});
test('libraries sharing component IDs retain independent defaults and case overrides',async t=>{
  const codec=await import('../scripts/glassbox-cli.mjs');
  const oldComponent={id:'shared',name:'Generic command',command:'old-default'};
  const newComponent={...oldComponent,command:'new-default'};
  const override={...newComponent,command:'case-override'};
  const oldCase={id:'existing',name:'Existing',folderId:'old-folder',steps:[{id:'old-step',componentId:'shared'}]};
  const workspace={schemaVersion:'glassbox.case-library.workspace.v1',components:[newComponent],folders:[{id:'new-folder',name:'New'}],cases:[
    {id:'incoming',name:'Incoming',folderId:'new-folder',steps:[{id:'new-step',componentId:'shared'}]},
    {id:'overridden',name:'Overridden',folderId:'new-folder',steps:[{id:'override-step',componentId:'shared'}],components:[override]},
  ]};
  const f=fixture(t,{loadCaseCodec:async()=>codec,pullCases:async()=>({success:true,repoId:'new',repoPath:'/isolated/new',files:[{name:'workspace.json',relativePath:'workspace.json',content:JSON.stringify(workspace)}]})});
  f.setState({cases:[oldCase],caseFolders:[{id:'old-folder',libraryId:'old-library'}],caseLibraries:[{id:'old-library'}],components:[oldComponent]});
  const manifest={...base(),caseRepositories:[{id:'new-library',repoUrl:'https://example.test/new'}]};
  for(let i=0;i<2;i++) {
    assert.equal((await f.call('import',{manifest})).success,true);
    assert.deepEqual(f.state().cases.find(c=>c.id==='existing'),oldCase);
    assert.deepEqual(f.state().components.find(c=>c.id==='shared'),oldComponent);
    assert.deepEqual(f.state().cases.find(c=>c.id==='incoming').components,[newComponent]);
    assert.deepEqual(f.state().cases.find(c=>c.id==='overridden').components,[override]);
    assert.equal(f.state().cases.length,3);
  }
});

test('manual guide persists its branch and progress, validates metadata before writes',async t=>{
 const f=fixture(t);
 await f.call('onboarding',{step:0,status:'active',route:'manual',demoIndex:3});
 assert.deepEqual((await f.call('status')).onboarding,{step:0,status:'active',version:2,route:'manual',demoIndex:3});
 for(const patch of [{route:'arbitrary'},{demoIndex:-1},{demoIndex:1.5},{demoIndex:101}])await assert.rejects(f.call('onboarding',{step:0,status:'active',...patch}));
 assert.equal((await f.call('status')).onboarding.demoIndex,3);assert.deepEqual(f.state(),{});assert.equal(f.net(),0);
 await f.call('onboarding',{step:0,status:'completed',route:'manual',demoIndex:6});assert.equal((await f.call('status')).showWelcome,false);
});

test('local settings and actions finish before slow Git case import, preserving receipts on case failure',async t=>{
 let release,entered;const waiting=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve),order=[];
 const f=fixture(t,{importScripts:async()=>{order.push('shortcuts');return{success:true};},pullCases:async()=>{order.push('cases');entered();await gate;return{success:false,error:'private network failure'};}});
 const manifest={...base(),llmProviders:[model()],ttsProvider:{url:'https://example.test/tts'},quickActions:[{id:'local',fileName:'local.sh',content:'#!/bin/sh\nexit 99\n',configuration:{name:'Local action',inputs:[],args:[]}}],shortcutRepositories:[{id:'scripts',repoUrl:'https://example.test/scripts'}],caseRepositories:[{id:'cases',repoUrl:'https://example.test/cases'}]};
 const pending=f.call('import',{manifest});await waiting;
 try{
  assert.equal(f.state().llmProviders.length,1);assert.equal(f.environment().ttsProvider.url,manifest.ttsProvider.url);assert.equal(f.actions().length,1);
  assert.deepEqual(order,['shortcuts','cases']);
  const finished=f.events.filter(([name,r])=>name==='team-config:progress'&&r.status==='success').map(([,r])=>r.id);
  assert.deepEqual(finished.slice(0,-1).sort(),['action:local','configuration','tts']);
  assert.equal(finished.at(-1),'shortcuts:scripts');
  assert.equal((await f.call('import',{manifest})).errorCode,'TEAM_IMPORT_BUSY');
 }finally{release();}
 const result=await pending;assert.equal(result.success,false);assert.equal(result.steps.at(-1).id,'cases:cases');assert.equal(f.actions().length,1);assert.equal(JSON.stringify(result).includes('private network failure'),false);
});


test('configuration categories start independently and merge field patches without losing state',async()=>{
 const gates=new Map(),started=[];let state={untouched:42},queue=Promise.resolve(),network=0;
 const pause=id=>new Promise(resolve=>{started.push(id);gates.set(id,resolve);});
 const importer=createImporter({readState:()=>state,savePatch:async prepare=>{
   const fields=prepare(state);const id=fields.deviceBindings?'devices':'model';
   await pause(id);
   queue=queue.then(()=>{state={...state,...prepare(state)};return {success:true};});return queue;
 },readEnvironment:()=>({}),saveEnvironment:()=>pause('tts'),importAction:()=>pause('actions'),importScripts:()=>{network++;return {success:true};},pullCases:()=>{throw Error('unexpected');}});
 const pending=importer({...base(),llmProviders:[model()],selectedLlmProviderId:'one',deviceBindings:{phoneSerials:['PHONE']},ttsProvider:{url:'https://example.test/tts'},quickActions:[{id:'a',fileName:'a.sh',content:'echo ok'}],shortcutRepositories:[{id:'repo',repoUrl:'https://example.test/scripts'}]});
 assert.deepEqual(started,['model','devices','tts','actions']);assert.equal(network,0);
 gates.get('devices')();gates.get('tts')();gates.get('actions')();
 await new Promise(resolve=>setImmediate(resolve));assert.equal(network,0);
 gates.get('model')();const result=await pending;
 assert.equal(result.success,true);assert.equal(state.untouched,42);assert.deepEqual(state.deviceBindings.phoneSerials,['PHONE']);assert.equal(state.selectedLlmProviderId,'one');assert.equal(state.llmProviders[0].id,'one');assert.equal(network,1);
});

test('failed category waits for siblings and keeps import busy until all receipts settle',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve);let network=0;
 const importer=createImporter({readState:()=>({}),savePatch:async()=>({success:false,error:'private detail'}),readEnvironment:()=>({}),saveEnvironment:()=>gate,importScripts:()=>{network++;}});
 const manifest={...base(),ttsProvider:{url:'https://example.test/tts'},shortcutRepositories:[{id:'repo',repoUrl:'https://example.test/scripts'}]};
 let settled=false;const pending=importer(manifest).then(r=>{settled=true;return r;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);assert.equal((await importer(manifest)).errorCode,'TEAM_IMPORT_BUSY');assert.equal(network,0);
 release({success:true});const result=await pending;
 assert.equal(result.success,false);assert.equal(result.steps.find(s=>s.id==='tts').status,'success');assert.equal(result.steps.find(s=>s.id==='configuration').status,'failed');assert.equal(network,0);assert.equal(JSON.stringify(result).includes('private detail'),false);
});

test('runtime definitions roundtrip through team configuration without execution or unrelated state changes',async t=>{
 const f=fixture(t);f.setState({llmProviders:[{...model(),apiKey:'KEEP'}],deviceBindings:{phoneSerials:['LOCAL']}});
 const marker=path.join(f.root,'MUST_NOT_EXECUTE'),definitions=[{id:'custom-cli',name:'Custom CLI',command:process.execPath,args:['-e',`require('node:fs').writeFileSync(${JSON.stringify(marker)},'ran')`],family:'claude'}];
 assert.equal((await f.call('validate',{manifest:{...base(),localRuntimes:definitions}})).summary.localRuntimes,1);
 const result=await f.call('import',{manifest:{...base(),localRuntimes:definitions}});assert.equal(result.success,true);assert.ok(result.steps.some(x=>x.id==='runtimes'&&x.status==='success'));assert.equal(fs.existsSync(marker),false);assert.equal(f.state().llmProviders[0].apiKey,'KEEP');assert.deepEqual(f.state().deviceBindings,{phoneSerials:['LOCAL']});
 await f.call('export',{includeKeys:false});assert.deepEqual(validateManifest(f.saved()).localRuntimes,definitions);assert.ok(!f.saved().includes('KEEP'));
});
