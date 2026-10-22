import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {convertSoloPiCase,assertImportReviewed}=require('../electron/solopi-case-converter');
const {ACTION_CODES,NODE_ACTIONS,REQUIRED_PARAMS,INPUT_ACTIONS,buildNativeCase,applyNativeInputs,nativeCaseIssues}=require('../electron/solopi-native-case');
const {executeNativeReplay}=require('../electron/solopi-native-replay');
const step=(action,params={})=>({stepId:`step-${action}`,operationId:`op-${action}`,operationMethod:{actionEnum:action,operationParam:params},...(NODE_ACTIONS.has(action)?{operationNode:{resourceId:'org.example:id/control',packageName:'org.example.other',xpath:'/node/control',nodeType:'AccessibilityNodeTree',nodeBound:{left:0,top:0,right:1080,bottom:2400}}}:{})});
const source=steps=>({caseName:'Fixture',targetAppPackage:'org.example.app',advanceSettings:'{}',operationLog:{steps}});
const plain=()=>source([step('SLEEP',{text:'10'})]);
const caps={success:true,commands:['replay','cancel','config','case-import','case-delete'],queries:['health','status','case','case-import-status','case-delete-status']};
function fixture(options={}){
 let clock=0,autoStart=false,status={success:true,state:'idle',active:false,terminal:false},importId,deleteId,caseName,replayReads=0;
 const calls=[],controller=new AbortController();let payload,localPath;
 const io={entry:{nativeCase:plain(),restartApp:false,runTimeoutMs:500},signal:controller.signal,now:()=>clock,pause:async ms=>{clock+=ms;},
  read:async(action,p,signal)=>{
   (signal||controller.signal).throwIfAborted();calls.push({kind:'read',action,p,signal});
   if(action==='record')return{success:true,active:!!options.recording};
   if(p.type==='capabilities')return options.noCapabilities?{success:true}:caps;
   if(p.type==='health')return{success:true,appInitialized:true,autoStart,permissions:{adb:true,accessibility:true,float:true,background:true,powerSave:true,...options.permissions},...options.health};
   if(action==='plugin')return{success:true,plugins:options.plugins||[]};
   if(p.type==='case-import-status')return{success:!options.importFailure,requestId:importId};
   if(p.type==='case-delete-status')return{success:true,requestId:deleteId};
   if(p.type==='case')return{success:true,case:{id:7,caseName,caseFingerprint:options.badFingerprint?'bad':'a'.repeat(64)}};
   if(p.type==='status'){
    if(options.foreignBefore&&!caseName)return{success:true,state:'running',active:true,terminal:false,runId:'someone-else'};
    if(status.requestId){
     replayReads++;
     if(options.abort&&replayReads===2){controller.abort();controller.signal.throwIfAborted();}
     if(options.foreignAfter&&replayReads===2)status={success:true,state:'running',active:true,terminal:false,runId:'foreign-run',requestId:'foreign-request',caseName:'foreign-case'};
     if(!options.hang&&!options.abort&&!options.foreignAfter&&replayReads>=2&&status.state==='running')status={...status,state:options.failed?'failed':'passed',active:false,terminal:true,results:[{status:options.failed?'failed':'passed',exceptionStep:options.failed?0:undefined,exceptionStepId:options.failed?'step-SLEEP':undefined,exceptionMessage:options.failed?'assertion did not match':undefined}]};
    }
    return{...status};
   }
   throw Error(`unexpected read ${action} ${JSON.stringify(p)}`);
  },
  invoke:async(action,p,signal)=>{(signal||controller.signal).throwIfAborted();calls.push({kind:'invoke',action,p,signal});
   if(action==='config'){autoStart=p.value==='true';return;}
   if(p.type==='case-import'){importId=p.requestId;return;}
   if(p.type==='case-delete'){deleteId=p.requestId;assert.equal(p.confirmCaseName,caseName);return;}
   if(p.type==='cancel'){assert.equal(p.runId,status.runId);status={...status,state:'cancelled',active:false,terminal:true,results:[]};return;}
   if(action==='replay'){assert.equal(p.caseFingerprint,'a'.repeat(64));assert.equal(p.caseId,'7');assert.equal(p.restartApp,'false');status={success:true,state:'running',active:true,terminal:false,runId:'own-run',requestId:p.requestId,caseName:p.caseName};return;}
   throw Error('unexpected invoke');
  },
  command:async(args)=>{calls.push({kind:'command',args});assert.equal(args[0],'push');localPath=args[1];payload=JSON.parse(await fs.readFile(localPath,'utf8'));assert.equal(fsSync.statSync(localPath).mode&0o777,0o600);caseName=payload.caseName;},
  shell:async(args,signal)=>{(signal||controller.signal).throwIfAborted();calls.push({kind:'shell',args});}
 };
 return{io,calls,controller,get payload(){return payload;},get localPath(){return localPath;}};
}
test('47 normal actions preserve their ordered native wire payload, IDs, selectors, parameters and context',async()=>{
 const steps=Object.values(ACTION_CODES).map(action=>step(action,Object.fromEntries((REQUIRED_PARAMS[action]||[]).map(k=>[k,k==='text'?'10':k==='allocValue'?'${previous}':'value']))));
 assert.equal(steps.length,47);const original=source(steps);original.advanceSettings=JSON.stringify({params:[{name:'previous',defaultValue:'10'}]});
 const converted=convertSoloPiCase(original);assert.equal(converted.executionEngine,'solopi-native');assert.equal(converted.testCase.steps.length,3);
 const native=converted.testCase.steps[1],inputs={};
 steps.forEach((s,index)=>{if(INPUT_ACTIONS.has(s.operationMethod.actionEnum))inputs[`inputText_${index}`]='replacement';});
 assert.equal(converted.runnable,false);native.inputs={...native.inputs,...inputs};assertImportReviewed(converted.testCase);
 const f=fixture();f.io.entry.nativeCase=applyNativeInputs(JSON.parse(native.inputs.nativeCase),inputs);
 const result=await executeNativeReplay(f.io);assert.equal(result.operationCount,47);
 const wire=JSON.parse(f.payload.operationLog);assert.deepEqual(wire.steps.map(s=>s.operationMethod.actionEnum),steps.map(s=>s.operationMethod.actionEnum));
 assert.deepEqual(wire.steps.map(s=>s.stepId),steps.map(s=>s.stepId));assert.equal(wire.steps.find(s=>s.operationMethod.actionEnum==='LET').operationMethod.operationParam.allocValue,'${previous}');assert.deepEqual(JSON.parse(f.payload.advanceSettings),JSON.parse(original.advanceSettings));
 for(const [i,s]of wire.steps.entries()){assert.equal(s.operationIndex,i);if(s.operationNode)assert.equal(s.operationNode.packageName,'org.example.other');assert.deepEqual(s.operationMethod.operationParam,INPUT_ACTIONS.has(s.operationMethod.actionEnum)?{...steps[i].operationMethod.operationParam,text:'replacement'}:steps[i].operationMethod.operationParam);}
 assert.equal(fsSync.existsSync(f.localPath),false);assert.ok(f.calls.some(c=>c.p?.type==='case-delete-status'));
});
test('native input edit, save, reload and validator unblock only after every input is filled; no recorded secret survives',()=>{
 const original=source([step('INPUT',{text:'private-value'})]);original.operationLog.steps[0].operationNode.assistantNodes=[{text:'private-value'}];
 const result=convertSoloPiCase(original);assert.equal(JSON.stringify(result).includes('private-value'),false);assert.throws(()=>assertImportReviewed(result.testCase));
 const native=result.testCase.steps[1];native.inputs.inputText_0='${phoneVariable}';const ts=require('typescript'),module={exports:{}};
 vm.runInNewContext(ts.transpileModule(fsSync.readFileSync('src/lib/automationCase.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:module.exports,require:name=>name==='../../electron/workflow-failure-policy'?require('../electron/workflow-failure-policy'):require(name)});
 const saved=module.exports.normalizeCase(JSON.parse(JSON.stringify(result.testCase)));assertImportReviewed(saved);assert.equal(saved.components[0].params.find(p=>p.key==='nativeCase').templateMode,'literal');
 assert.equal(applyNativeInputs(JSON.parse(saved.steps[1].inputs.nativeCase),saved.steps[1].inputs).operationLog.steps[0].operationMethod.operationParam.text,'${phoneVariable}');
 native.inputs.inputText_0='';assert.throws(()=>assertImportReviewed(result.testCase));
 native.inputs.nativeCase='bad JSON';assert.throws(()=>assertImportReviewed(result.testCase));
});
test('native replay checks prerequisites and fingerprint before dispatch; never takes an existing recorder or run',async()=>{
 for(const options of [{recording:true},{foreignBefore:true},{noCapabilities:true},{badFingerprint:true},{importFailure:true},{permissions:{accessibility:false}},{health:{executionProfiles:{}}}]){
  const f=fixture(options);await assert.rejects(executeNativeReplay(f.io));assert.equal(f.calls.some(c=>c.action==='replay'),false);assert.equal(f.calls.some(c=>c.p?.type==='cancel'),false);
 }
});
test('real phone failure details remain in the execution error; no synthetic passed result',async()=>{
 const f=fixture({failed:true});await assert.rejects(executeNativeReplay(f.io),error=>{assert.equal(error.code,'SOLOPI_REPLAY_FAILED');assert.equal(error.meta.soloPi.results[0].exceptionStepId,'step-SLEEP');assert.match(error.meta.soloPi.results[0].exceptionMessage,/assertion/);return true;});
 assert.equal(f.calls.some(c=>c.p?.type==='cancel'),false);
});
test('timeout and user cancellation cancel only the acknowledged owned run with a fresh cleanup signal',async()=>{
 for(const options of [{hang:true},{abort:true}]){
  const f=fixture(options);await assert.rejects(executeNativeReplay(f.io));const cancelled=f.calls.filter(c=>c.p?.type==='cancel');assert.equal(cancelled.length,1);assert.equal(cancelled[0].p.runId,'own-run');assert.notEqual(cancelled[0].signal,f.controller.signal);assert.equal(cancelled[0].signal.aborted,false);assert.equal(f.calls.filter(c=>c.action==='config').at(-1).p.value,'false');assert.equal(fsSync.existsSync(f.localPath),false);
 }
});
test('replacement by another run fails without cancelling or altering the foreign run',async()=>{
 const f=fixture({foreignAfter:true});await assert.rejects(executeNativeReplay(f.io),/替换/);assert.equal(f.calls.some(c=>c.p?.type==='cancel'),false);assert.equal(f.calls.some(c=>c.p?.type==='case-delete'),false);assert.equal(f.calls.filter(c=>c.action==='config').length,1);
});
test('native CaptureTree requires an already loaded plugin; no remote plugin installation is attempted',async()=>{
 const f=fixture();f.io.entry.nativeCase=source([step('LONG_CLICK',{text:'500'})]);f.io.entry.nativeCase.operationLog.steps[0].operationNode.nodeType='CaptureTree';
 await assert.rejects(executeNativeReplay(f.io),/hulu_imageCompare/);assert.equal(f.calls.some(c=>c.action==='replay'),false);assert.deepEqual(f.calls.find(c=>c.action==='plugin').p,{action:'list'});
});
test('packaged converter has all dependencies and can convert a native operation outside the checkout',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'solopi-packaged-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 for(const name of ['solopi-case-converter','solopi-native-case','solopi-native-schema'])await fs.copyFile(`electron/${name}.js`,path.join(dir,`${name}.js`));
 const converter=require(path.join(dir,'solopi-case-converter.js'));assert.equal(converter.convertSoloPiCase(source([step('LONG_CLICK',{text:'500'})])).runnable,true);
 const script=await fs.readFile('scripts/prepare-packaged-app.mjs','utf8'),pkg=JSON.parse(await fs.readFile('package.json','utf8'));for(const name of ['solopi-native-case.js','solopi-native-schema.js']){assert.ok(script.includes(name));assert.ok(pkg.build.extraResources.some(r=>r.from==='build/packaged-cli'&&r.to==='cli'&&r.filter.includes('*.js')));}
});
test('actual component dispatcher keeps native variables literal and routes to provider; cancellation is scoped',async()=>{
 const main=await fs.readFile('electron/main.js','utf8');const code=main.match(/async function executeSoloPiReplayStep\([^]*?\n\}/)[0];const cancels=new Map();let called;
 const context={require:name=>name==='./solopi-native-schema'?require('../electron/solopi-native-schema'):require(name),crypto:{randomUUID:()=> 'fixture-owned'},workflowCommandScope:{getStore:()=> 'fixture-task'},workflowCommandCancels:cancels,isWorkflowCanceled:()=>false,parseWorkflowBoolean:v=>String(v)==='true',soloPiProvider:{cancelPending:id=>assert.equal(id,'fixture-owned'),execute:async(entry)=>{called=entry;assert.equal(cancels.get('fixture-task').size,1);return{operationCount:1,runId:'native-run',state:'passed',results:[{status:'passed'}]};}}};
 vm.createContext(context);vm.runInContext(code,context);const doc=source([step('LET',{allocKey:'x',allocType:'0',allocValue:'${previous}'})]);
 await context.executeSoloPiReplayStep({timeoutMs:1000},{defaults:{phonePackage:'org.example.app'}},{nativeCase:JSON.stringify(doc),runTimeoutMs:'500',restartApp:'false'},'phone');assert.equal(called.nativeCase.operationLog.steps[0].operationMethod.operationParam.allocValue,'${previous}');assert.equal(cancels.size,0);
 assert.match(main,/literalParams\.has\(key\) \? value : resolveWorkflowValue\(value, context\)/);
});
test('native sidebar renders editable actions, limits long sequences to 20 per page, and visibly reports missing input',()=>{
 const ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),context={exports:{},require:name=>name==='../../electron/solopi-native-schema'?require('../electron/solopi-native-schema'):require(name)};
 vm.runInNewContext(ts.transpileModule(fsSync.readFileSync('src/components/SoloPiNativeEditor.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,context);
 const doc=buildNativeCase(source([step('INPUT',{text:''}),...Array.from({length:40},(_,i)=>({...step('LONG_CLICK',{text:'500'}),stepId:`step-${i}`}))]));
 const html=renderToStaticMarkup(React.createElement(context.exports.default,{value:JSON.stringify(doc),inputs:{},onChange(){},onInputChange(){},restartApp:'false',timeout:'600000',onRestartChange(){},onTimeoutChange(){}}));
 assert.match(html,/第 1 步 text/);assert.match(html,/请填写 INPUT.text/);assert.match(html,/上一页/);assert.match(html,/下一页/);assert.equal((html.match(/<summary/g)||[]).length,21);assert.match(html,/原生动作序列 JSON/);
});
test('recognized host profile follows existing phone headless capability without changing legacy configuration',async()=>{
 const f=fixture({health:{executionProfiles:{host:{replayMode:'headless',requiredPermissions:['adb','accessibility'],advisoryPermissions:['powerSave'],ready:true}}},permissions:{float:false,background:false,powerSave:false}});
 await executeNativeReplay(f.io);assert.equal(f.calls.find(c=>c.action==='replay').p.headless,'true');assert.equal(f.calls.some(c=>c.action==='config'),false);
});
test('actual CLI payload validation rejects missing or broken native data and accepts edited input',async()=>{
 const {validatePayload}=await import('../scripts/glassbox-cli.mjs');
 const r=convertSoloPiCase(source([step('INPUT',{text:'private'})]));assert.equal(validatePayload({cases:[r.testCase]}).success,false);
 r.testCase.steps[1].inputs.inputText_0='configured';assert.equal(validatePayload({cases:[r.testCase]}).success,true);
 delete r.testCase.steps[1].config.importReview;r.testCase.steps[1].inputs.nativeCase='not json';const invalid=validatePayload({cases:[r.testCase]});assert.equal(invalid.success,false);assert.ok(invalid.errors.some(e=>e.includes('SoloPi')));
});
