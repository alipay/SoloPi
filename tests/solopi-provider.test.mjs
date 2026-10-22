import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{createSoloPiProvider,validateStatus,request}=require('../electron/solopi-provider');
function fixture(t,{installed=false,versionCode=37,badHash=false,visible=true,cold=false,internalAdb=true,permissions={},preparationFailure=false,preparationForeign=false,recordFailure=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-native-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const apk=Buffer.from('PK synthetic apk');fs.writeFileSync(path.join(dir,'SoloPi.apk'),apk);fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({packageName:'com.alipay.hulu',versionCode:37,sha256:badHash?'0'.repeat(64):createHash('sha256').update(apk).digest('hex')}));
 const calls=[],http=[];let current={success:true,kind:'recording',state:'idle',recording:false,active:false};let providerName='';let probes=0;let connectionRequestId;
 const entry={serial:'phone with space',targetPackage:'org.example.target',providerName:'desktop-fixture'};
 const provider=createSoloPiProvider({resourcesDirectory:()=>dir,runAdb:async(args)=>(await (async()=>{
  const executable='/fixture/adb';
  calls.push({executable,args});assert.equal(executable,'/fixture/adb');assert.equal(args[0],'-s');assert.equal(args[1],entry.serial);
  if(args[2]==='get-state')return{stdout:'device'};
  if(args[2]==='install'){installed=true;return{stdout:'Success'};}
  if(args[2]==='forward')return{stdout:args[3]==='tcp:0'?'45678':''};
  const command=args[3]||'';
  if(args[3]===entry.preparationShell && entry.preparationShell){
   if(preparationFailure)throw Error('synthetic preparation failed');
   if(preparationForeign)current={...current,sessionId:'foreign-session'};
  }
  if(command==="'id' '-u'"||command==="'su' '-c' 'id -u'")return{stdout:'2000'};
  if(command.includes("'resolve-activity'"))return{stdout:'com.alipay.hulu/.activity.IndexActivity'};
  if(command.includes("'pm' 'path'"))return{stdout:command.includes('com.alipay.hulu')&&!installed?'':'package:/fixture/app.apk'};
  if(command.includes("'dumpsys'"))return{stdout:`versionCode=${versionCode}`};
  if(command.includes('type=adb-connect')){connectionRequestId=command.match(/requestId=([a-f0-9-]+)/)[1];internalAdb=true;}
  if(command.includes('recordMode=normal')){const sessionId=command.match(/sessionId=([a-f0-9-]+)/)[1];providerName=entry.providerName;current={success:true,kind:'recording',state:'recording',recording:true,active:true,sessionId,caseName:providerName,targetPackage:entry.targetPackage};if(recordFailure)current={...current,state:'failed',recording:false,active:false,error:'Phone denied recording'};}
  if(command.includes('recordMode=stop'))current={...current,state:'stopped',recording:false,active:false};
  return{stdout:'Starting: Intent'};
 })()).stdout,httpRequest:async(port,action,params)=>{assert.equal(port,45678);http.push({action,params});if(action==='record')return {...current};if(params.type==='capabilities')return{success:!cold || probes++>0};if(params.type==='health')return{success:true,permissions:{adb:internalAdb,float:true,background:true,powerSave:true,accessibility:true,...permissions}};if(action==='config')return{success:true,config:{value:'localhost:5555'}};if(params.type==='adb-connect-status')return{success:true,requestId:connectionRequestId,state:'connected',connected:true,terminal:true};if(params.type==='apps')return{success:true,apps:visible?[{packageName:entry.targetPackage}]:[]};return{success:true,case:{caseName:providerName,targetAppPackage:entry.targetPackage,operationLog:JSON.stringify({steps:[],storePath:'/phone/private/file'})}};}});
 return{provider,entry,calls,http,setStatus:v=>current=v};
}
test('native provider provisions bundled app once, directly starts/stops/exports and removes only owned forwards',async t=>{
 const f=fixture(t);const start=await f.provider.execute(f.entry,'record-start');assert.equal(start.state,'recording');assert.equal(f.calls.filter(c=>c.args[2]==='install').length,1);
 await f.provider.execute(f.entry,'record-stop',['--session-id',start.sessionId]);const result=await f.provider.execute(f.entry,'case-get');assert.deepEqual(result.case.operationLog.steps,[]);assert.equal(result.case.operationLog.storePath,undefined);
 assert.equal(f.calls.filter(c=>c.args[2]==='forward'&&c.args[3]==='--remove').length,3);assert.ok(f.calls.every(c=>c.executable!=='python3'));assert.equal(f.calls.some(c=>c.args[3]?.includes('monkey')),false);
});
test('installed newer app is not downgraded; missing and older versions are updated with verified bundled APK',async t=>{
 for(const [installed,versionCode,installs] of [[true,40,0],[true,30,1],[false,0,1]]){const f=fixture(t,{installed,versionCode});await f.provider.execute(f.entry,'record-start');assert.equal(f.calls.filter(c=>c.args[2]==='install').length,installs);}
});
test('tampered bundled APK blocks installation and forwarding before any recording action',async t=>{
 const f=fixture(t,{badHash:true});await assert.rejects(f.provider.execute(f.entry,'record-start'),/校验失败/);assert.equal(f.calls.some(c=>['install','forward'].includes(c.args[2])),false);
});
test('foreign recording is neither overwritten nor stopped and its forwarding is cleaned up',async t=>{
 const f=fixture(t,{installed:true});f.setStatus({success:true,kind:'recording',state:'recording',recording:true,active:true,sessionId:'foreign',caseName:'other',targetPackage:'org.other.app'});
 await assert.rejects(f.provider.execute(f.entry,'record-start'),/已有录制/);await assert.rejects(f.provider.execute(f.entry,'record-stop',['--session-id','owned']),/归属/);assert.equal(f.calls.some(c=>c.args[3]?.includes("'am' 'start'")),false);
});
test('inconsistent phone states cannot bypass foreign-session checks',()=>{
 assert.throws(()=>validateStatus({success:true,kind:'recording',state:'recording',recording:true,active:false}),/协议/);assert.throws(()=>validateStatus({success:false,error:'Grant permission',errorCode:'PERMISSION_REQUIRED'}),{code:'PERMISSION_REQUIRED'});
});
test('native HTTP transport connects only to loopback, rejects redirects and invalid JSON',async t=>{
 const http=require('node:http');let content='{}',code=200;const server=http.createServer((_q,res)=>{res.writeHead(code,{Location:'http://external.invalid'});res.end(content);});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());const port=server.address().port;
 assert.deepEqual(await request(port,'record',{recordMode:'status'}),{});code=302;await assert.rejects(request(port,'record',{}),/HTTP 302/);code=200;content='not-json';await assert.rejects(request(port,'record',{}),/JSON/);
});

test('record dialog uses changing header device selection and exposes no external CLI configuration',async()=>{
 const ts=require('typescript'),vm=require('node:vm'),effects=[];let tree;const calls=[];
 const exports={},react={useRef:()=>({current:0}),useState:v=>[v,()=>{}],useEffect:fn=>effects.push(fn)};
 const api={ipcRenderer:{invoke:async(channel,value)=>{calls.push({channel,value});return{success:true,sessions:[],id:'owned'};}}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/components/SoloPiImport.tsx',import.meta.url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,require:name=>name==='react'?react:{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}});
 const render=(serial,pkg)=>exports.default({api,mode:'record',phoneSerial:serial,phonePackage:pkg,onImport(){},onClose(){}});
 function find(node,predicate){if(!node)return null;if(Array.isArray(node)){for(const child of node){const hit=find(child,predicate);if(hit)return hit;}return null;}if(typeof node!=='object')return null;return predicate(node)?node:find(node.props?.children,predicate);}
 tree=render('','org.example.app');assert.equal(find(tree,n=>n.type==='button'&&JSON.stringify(n.props.children).includes('开始录制')).props.disabled,true);
 tree=render('phone-new','org.example.new');const serialized=JSON.stringify(tree);assert.equal(serialized.includes('SoloPi CLI 配置'),false);assert.equal(serialized.includes('Python'),false);
 find(tree,n=>n.type==='button'&&JSON.stringify(n.props.children).includes('开始录制')).props.onClick();await new Promise(setImmediate);
 const start=calls.find(c=>c.channel==='solopi:record-start');assert.equal(start.value.serial,'phone-new');assert.equal(start.value.targetPackage,'org.example.new');assert.equal(calls.some(c=>c.channel==='solopi:configure'),false);
});

test('distribution includes checksum-pinned companion on Mac and Linux and rejects tampered public artifact',async t=>{
 const {verifySoloPiRuntime}=await import('../scripts/verify-solopi-runtime.mjs');const {linuxBuildConfig}=await import('../scripts/linux-build-config.mjs');const {isPublicSourceFile,checkPublicFile}=await import('../scripts/export-public-source.mjs');
 const root=path.resolve(import.meta.dirname,'..'),resource=path.join(root,'resources/solopi-recording');assert.equal(verifySoloPiRuntime(resource).version,'1.0.2');
 assert.ok(require('../package.json').build.extraResources.some(r=>r.from==='resources/solopi-recording'&&r.to==='solopi-recording'));assert.ok(linuxBuildConfig(root).extraResources.some(r=>r.from==='resources/solopi-recording'&&r.to==='solopi-recording'));
 assert.equal(isPublicSourceFile('resources/solopi-recording/SoloPi.apk'),true);checkPublicFile('resources/solopi-recording/SoloPi.apk',fs.readFileSync(path.join(resource,'SoloPi.apk')));assert.throws(()=>checkPublicFile('resources/solopi-recording/SoloPi.apk',Buffer.from('tampered')),/checksum/);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-package-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.cpSync(resource,dir,{recursive:true});fs.appendFileSync(path.join(dir,'SoloPi.apk'),'corruption');assert.throws(()=>verifySoloPiRuntime(dir),/checksum/);
});

test('managed ADB subprocess plus real loopback protocol completes an owned recording and conversion without Python',{skip:process.platform==='win32'},async t=>{
 const http=require('node:http'),{createSoloPiRecording}=require('../electron/solopi-recording'),{createWorkflowExecutionGate}=require('../electron/workflow-execution-gate');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-native-integration-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const state=path.join(dir,'phone.json'),log=path.join(dir,'adb.jsonl');fs.writeFileSync(state,JSON.stringify({installed:false,status:{success:true,kind:'recording',state:'idle',active:false,recording:false}}));
 const server=http.createServer((req,res)=>{const s=JSON.parse(fs.readFileSync(state)),url=new URL(req.url,'http://localhost');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(url.pathname==='/scheme/record'?s.status:url.searchParams.get('type')==='capabilities'?{success:true}:url.searchParams.get('type')==='health'?{success:true,permissions:{adb:true,float:true,background:true,powerSave:true,accessibility:true}}:url.searchParams.get('type')==='status'?{success:true,active:false,state:'idle',terminal:false}:url.searchParams.get('type')==='apps'?{success:true,apps:[{packageName:'org.example.target'}]}:{success:true,case:{caseName:s.status.caseName,targetAppPackage:s.status.targetPackage,operationLog:{steps:[{operationMethod:{actionEnum:'BACK',operationParam:{}}}]}}}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const adb=path.join(dir,'mock-adb');fs.writeFileSync(adb,`#!${process.execPath}
const fs=require('fs'),args=process.argv.slice(2),file=process.env.MOCK_STATE;fs.appendFileSync(process.env.MOCK_LOG,JSON.stringify(args)+'\\n');const s=JSON.parse(fs.readFileSync(file));
if(args[2]==='get-state')console.log('device');
else if(args[2]==='forward'&&args[3]==='tcp:0')console.log(process.env.MOCK_PORT);
else if(args[2]==='install'){s.installed=true;fs.writeFileSync(file,JSON.stringify(s));console.log('Success');}
else if(args[2]==='shell'){const cmd=args[3];if(cmd.includes("'pm' 'path'")){if(cmd.includes('com.alipay.hulu')&&!s.installed)process.exit(1);console.log('package:/mock/app.apk');}else if(cmd.includes("'dumpsys'"))console.log('versionCode=37');else if(cmd.includes('solopi://')){const url=new URL(cmd.match(/solopi:\\/\\/[^']+/)[0]);if(url.searchParams.get('recordMode')==='normal')s.status={success:true,kind:'recording',state:'recording',active:true,recording:true,sessionId:url.searchParams.get('sessionId'),caseName:url.searchParams.get('caseName'),targetPackage:url.searchParams.get('targetApp')};else s.status={...s.status,state:'stopped',active:false,recording:false};fs.writeFileSync(file,JSON.stringify(s));console.log('Starting: Intent');}}
`,{mode:0o700});
 const provider=createSoloPiProvider({runAdb:async(args,timeout,signal)=>{const {execFile}=require('node:child_process');return new Promise((resolve,reject)=>execFile(adb,args,{timeout,signal,env:{...process.env,MOCK_STATE:state,MOCK_LOG:log,MOCK_PORT:String(server.address().port)}},(error,stdout,stderr)=>error?reject(Object.assign(error,{exitCode:error.code,stdout,stderr})):resolve(stdout)));},resourcesDirectory:()=>path.resolve(import.meta.dirname,'../resources/solopi-recording')});
 const recording=createSoloPiRecording({directory:()=>path.join(dir,'desktop'),gate:createWorkflowExecutionGate(),provider});const started=await recording.start({serial:'mock-phone',name:'Recorded fixture',targetPackage:'org.example.target'});const stopped=await recording.stop(started.id);assert.equal(stopped.testCase.name,'Recorded fixture');assert.equal(stopped.testCase.defaults.phoneSerial,'mock-phone');assert.equal(stopped.operationCount,1);assert.equal(stopped.session.finished,true);
 const commands=fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse);assert.ok(commands.some(a=>a[2]==='install'));assert.equal(commands.filter(a=>a[2]==='forward'&&a[3]==='--remove').length,4);assert.ok(commands.every(a=>a[0]==='-s'&&a[1]==='mock-phone'));await recording.stopAll();
});

test('recording uses the same Desktop runAdb boundary and settings resolver without its own binary fallback',async()=>{
 const vm=require('node:vm');
 const main=fs.readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
 assert.match(main,/createSoloPiProvider\(\{ runAdb: \(\.\.\.args\) => runAdb\(\.\.\.args\)/);
 const providerSource=fs.readFileSync(new URL('../electron/solopi-provider.js',import.meta.url),'utf8');
 assert.doesNotMatch(providerSource,/runManagedCommand|getAdbPath|process\.env|child_process/);
 const resolver=main.slice(main.indexOf('function getAdbPath()'),main.indexOf('\nfunction getFfmpegPath()'));
 const shared=main.slice(main.indexOf('async function runAdb('),main.indexOf('\nasync function runAdbBuffer('));
 let configured='/settings/custom adb',local='/local/adb';const calls=[];
 const context={resolveMediaRuntime:()=>({adb:'/bundled/adb'}),process:{env:{},resourcesPath:'/resources'},app:{isPackaged:true},readEnvironmentConfig:()=>({adbPath:configured}),findExecutableOnPath:()=>local,path,os,fs,
 runCommand:async(command,args,timeout,signal)=>{calls.push({command,args,timeout,signal});return{stdout:'device'};}};
 vm.createContext(context);vm.runInContext(resolver+'\n'+shared,context);
 const signal=new AbortController().signal;
 assert.equal(await context.runAdb(['-s','phone','get-state'],15000,signal),'device');assert.equal(calls[0].command,configured);assert.equal(calls[0].signal,signal);
 configured='';await context.runAdb(['devices'],5000);assert.equal(calls[1].command,local);
 configured='/settings/missing-adb';const original=Object.assign(Error('device unauthorized'),{stderr:'adb: device unauthorized',exitCode:1});context.runCommand=async command=>{assert.equal(command,configured);throw original;};
 await assert.rejects(context.runAdb(['devices']),error=>error===original);
});

test('recording preserves shared ADB diagnostics and never treats device errors as a missing app',async()=>{
 const error=Object.assign(Error('ADB device unauthorized'),{exitCode:1,stderr:'adb: device unauthorized',stdout:''});const calls=[];
 const provider=createSoloPiProvider({resourcesDirectory:()=>'/unused',runAdb:async args=>{calls.push(args);if(args[2]==='get-state')return'device';throw error;}});
 await assert.rejects(provider.execute({serial:'phone'},'record-start'),value=>value===error&&value.notDispatched===true);
 assert.equal(calls.length,2);
});

test('empty phone app visibility blocks recording dispatch with actionable permissions instead of a blank scheme page',async t=>{
 const f=fixture(t,{installed:true,visible:false});
 await assert.rejects(f.provider.execute(f.entry,'record-start'),error=>/获取应用列表/.test(error.message)&&error.notDispatched===true);
 assert.equal(f.calls.some(c=>String(c.args[3]).includes('solopi://')),false);
 assert.equal(f.calls.filter(c=>c.args[2]==='forward'&&c.args[3]==='--remove').length,1);
});

test('cold start initializes through the official scheme without opening the SoloPi homepage',async t=>{
 const f=fixture(t,{installed:true,cold:true});const r=await f.provider.execute(f.entry,'record-start');assert.equal(r.state,'recording');
 const commands=f.calls.map(c=>c.args[3]||'').join('\n');assert.match(commands,/startaction\/harness\?type=capabilities/);assert.match(commands,/AdbSchemeActivity/);assert.doesNotMatch(commands,/resolve-activity|IndexActivity|monkey|'\-W'/);
});

 test('start prepares only the selected USB device before recording; status, stop and export never reopen TCP ADB',async t=>{
 const f=fixture(t,{installed:true,internalAdb:false});const result=await f.provider.execute(f.entry,'record-start');
 const args=f.calls.map(c=>c.args);assert.equal(args.filter(a=>a[2]==='tcpip').length,1);assert.ok(args.every(a=>a[0]==='-s'&&a[1]===f.entry.serial));
 const connect=args.findIndex(a=>a[3]?.includes('type=adb-connect'));const record=args.findIndex(a=>a[3]?.includes('recordMode=normal'));assert.ok(connect>=0&&record>connect);
 f.calls.length=0;f.http.length=0;await f.provider.execute(f.entry,'record-status');await f.provider.execute(f.entry,'record-stop',['--session-id',result.sessionId]);await f.provider.execute(f.entry,'case-get');
 assert.equal(f.calls.some(c=>c.args[2]==='tcpip'||c.args[3]?.includes('adb-connect')),false);assert.equal(f.http.some(c=>c.params.type==='health'||c.action==='config'),false);
 });


test('prepared-page recording waits for recording acknowledgement before executing the selected-device shell', async t => {
 const f=fixture(t,{installed:true});f.entry.preparationShell='set -e\nam start -a android.intent.action.VIEW -d "example://miniapp"';
 await f.provider.execute(f.entry,'record-start');
 const commands=f.calls.map(c=>c.args);
 const start=commands.findIndex(a=>a[3]?.includes('recordMode=normal'));
 const prep=commands.findIndex(a=>a[3]===f.entry.preparationShell);
 assert.ok(prep>start);assert.equal(commands[prep][2],'shell');
 assert.ok(f.http.filter(q=>q.action==='record').length>=3);
 assert.equal(commands.filter(a=>a[3]===f.entry.preparationShell).length,1);
 assert.equal(commands.slice(prep+1).some(a=>a[3]?.includes('am start')||a[3]?.includes('force-stop')),false);
});
test('preparation failure keeps the owned session recoverable instead of claiming recording is ready', async t => {
 const f=fixture(t,{installed:true,preparationFailure:true});f.entry.preparationShell='false';
 await assert.rejects(f.provider.execute(f.entry,'record-start'),error=>{
  assert.match(error.message,/preparation failed/);assert.equal(error.notDispatched,undefined);
  assert.ok(error.receipt.sessionId);assert.equal(error.receipt.phase,'record-start');return true;
 });
});
test('missing permissions on a non-root phone block recording and preparation before dispatch', async t => {
 const f=fixture(t,{installed:true,permissions:{float:false,accessibility:false}});f.entry.preparationShell='am start example';
 await assert.rejects(f.provider.execute(f.entry,'record-start'),error=>{
  assert.equal(error.notDispatched,true);assert.equal(error.code,'SOLOPI_PERMISSIONS_REQUIRED');
  assert.deepEqual(error.permissionCheck.missing.map(x=>x.key),['float','accessibility']);return true;
 });
 assert.equal(f.calls.some(c=>c.args[3]?.includes('recordMode=normal')||c.args[3]===f.entry.preparationShell),false);
 assert.equal(f.calls.at(-1).args[3],'--remove');
});

test('a changed recording owner after preparation is never acknowledged as ready',async t=>{
 const f=fixture(t,{installed:true,preparationForeign:true});f.entry.preparationShell='true';
 await assert.rejects(f.provider.execute(f.entry,'record-start'),error=>{
  assert.match(error.message,/会话已变化/);assert.ok(error.receipt.sessionId);assert.equal(error.notDispatched,undefined);return true;
 });
 assert.equal(f.calls.some(c=>c.args[3]?.includes('recordMode=stop')),false);
});

test('explicit override skips permission and visibility gates but prepares internal ADB then records and runs preparation',async t=>{
 const f=fixture(t,{installed:true,internalAdb:false,visible:false,permissions:{accessibility:false,float:false}});
 f.entry.skipPermissionPrecheck=true;f.entry.preparationShell='am start -d example://page';
 assert.equal((await f.provider.execute(f.entry,'record-start')).state,'recording');
 const commands=f.calls.map(c=>c.args[3]||'');const connect=commands.findIndex(c=>c.includes('type=adb-connect')),record=commands.findIndex(c=>c.includes('recordMode=normal')),prepare=commands.indexOf(f.entry.preparationShell);
 assert.ok(connect>=0&&record>connect&&prepare>record);assert.equal(f.http.some(c=>c.params.type==='apps'),false);
 assert.equal(commands.some(c=>c.includes("'su'")||c.includes("'appops'")||c.includes("'settings'")),false);
});
test('override still reports actual preparation failures and preserves owned recording recovery receipt',async t=>{
 const f=fixture(t,{installed:true,permissions:{accessibility:false},preparationFailure:true});
 f.entry.skipPermissionPrecheck=true;f.entry.preparationShell='synthetic failure';
 await assert.rejects(f.provider.execute(f.entry,'record-start'),error=>{assert.match(error.message,/synthetic preparation failed/);assert.ok(error.receipt.sessionId);assert.equal(error.notDispatched,undefined);assert.equal(error.permissionCheck,undefined);return true;});
});
test('override never takes over an existing phone recording',async t=>{
 const f=fixture(t,{installed:true});f.entry.skipPermissionPrecheck=true;
 f.setStatus({success:true,kind:'recording',state:'recording',recording:true,active:true,sessionId:'foreign',caseName:'foreign-case',targetPackage:'org.example.other'});
 await assert.rejects(f.provider.execute(f.entry,'record-start'),/已有录制会话/);
 assert.equal(f.calls.some(c=>c.args[3]?.includes('recordMode=normal')),false);
});


test('manual override preserves actual phone startup failures without reopening Desktop permission popup',async t=>{
 const f=fixture(t,{installed:true,permissions:{accessibility:false},recordFailure:true});f.entry.skipPermissionPrecheck=true;
 await assert.rejects(f.provider.execute(f.entry,'record-start'),error=>{assert.match(error.message,/Phone denied recording/);assert.equal(error.receipt.state,'failed');assert.equal(error.receipt.phase,'record-start');assert.ok(error.receipt.sessionId);assert.equal(error.permissionCheck,undefined);assert.equal(error.notDispatched,undefined);return true;});
});
