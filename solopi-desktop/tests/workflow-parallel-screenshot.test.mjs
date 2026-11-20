import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const source=fs.readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
const definition=name=>source.match(new RegExp('async function '+name+'\\([^]*?\\n\\}'))[0];
function fixture({stop=false,failCapture=false,pass=false}={}) {
 const scope=new AsyncLocalStorage(),canceled=new Set(),cancels=new Map(),commands=[],seen=[];
 const plan={timeoutMs:20,branches:[
  {id:'page',name:'Page',device:'glasses',componentId:'json',inputs:{captureScreenshotOnPass:true}},
  {id:'state',name:'State',device:'glasses',componentId:'json',inputs:{captureScreenshotOnPass:false}},
 ]};
 const context={runDir:'/fixture/run',variables:{},nodeOutputs:{},screenshots:[],components:{json:{params:[]}}};
 const deps={require:name=>require(name.startsWith('./')?'../electron/'+name.slice(2):name),workflowCommandScope:scope,workflowCommandCancels:cancels,workflowCancelRequests:canceled,
  getWorkflowParallelTimeoutPlan:p=>p,isWorkflowCanceled:id=>canceled.has(id),
  createWorkflowStoppedError:()=>Object.assign(Error('stopped'),{code:'WORKFLOW_STOPPED'}),
  crypto:{randomUUID:()=>`branch-${seen.length}`},resolveWorkflowValue:x=>x,parseWorkflowBoolean:(x,f)=>x===undefined?f:x!==false&&x!=='false',
  getComponentDevice:(_c,s)=>s.device,getWorkflowSerial:()=> 'device',getAdbPath:()=> 'fixture-adb',
  fs:{mkdirSync(){}},path,sanitizeFilePart:x=>x,createTimestamp:()=> '20261030',WORKFLOW_SCREENSHOT_TIMEOUTS:{capture:10,pull:10,cleanup:10},
  executeWorkflowAssertionStep:(_s,_c,run)=>run(),shouldApplyPostDelay:()=>false,
  executeWorkflowStep:async(step,branchContext)=>{
   const childId=scope.getStore();seen.push({childId,deferred:branchContext.deferAssertScreenshots});
   try {
    if(pass)return {success:true};
    await new Promise((_resolve,reject)=>{
     const pending=cancels.get(childId)||new Set();
     pending.add(()=>reject(Object.assign(Error('stopped'),{code:'WORKFLOW_STOPPED'})));cancels.set(childId,pending);
    });
   } finally {await api.captureWorkflowAssertScreenshot(branchContext,'glasses','device',step);}
  },
  runCommand:async(_cmd,args)=>{
   const owner=scope.getStore();assert.equal(canceled.has(owner),false,'screenshot cannot run under canceled child');
   commands.push({owner,args});if(failCapture && args.includes('pull'))throw Error('fixture ADB disconnected');return {stdout:''};
  },
 };
 const api=Function(...Object.keys(deps),['captureWorkflowScreenshot','captureWorkflowAssertScreenshot','executeWorkflowParallel'].map(definition).join('\n')+'\nreturn {executeWorkflowParallel,captureWorkflowAssertScreenshot};')(...Object.values(deps));
 const run=()=>scope.run('parent',()=>api.executeWorkflowParallel(plan,context,()=>{}));
 return {run,context,commands,seen,canceled,cancels,stop:()=>{canceled.add('parent');for(const cancel of cancels.get('parent')||[])cancel();}};
}
test('parallel timeout cancels branch work then captures evidence from live parent scope',async()=>{
 const f=fixture();await assert.rejects(f.run(),{code:'ASSERTION_TIMEOUT'});
 assert.ok(f.seen.every(x=>x.deferred));assert.equal(f.commands.length,3);
 assert.ok(f.commands.every(x=>x.owner==='parent'));
 assert.equal(f.context.screenshots.length,1);assert.equal(f.context.screenshots[0].success,true);
 assert.equal(f.context.screenshots[0].stepId,'page');assert.equal(f.cancels.size,0);
});
test('successful parallel join also captures once and honors disabled screenshots',async()=>{
 const f=fixture({pass:true});await f.run();assert.equal(f.context.screenshots.length,1);assert.equal(f.commands.length,3);
});
test('ADB screenshot failure preserves original assertion timeout and diagnostic',async()=>{
 const f=fixture({failCapture:true});await assert.rejects(f.run(),{code:'ASSERTION_TIMEOUT'});
 assert.equal(f.context.screenshots[0].success,false);assert.equal(f.context.screenshots[0].error,'fixture ADB disconnected');
});
test('explicit user stop does not start screenshot work after branch cancellation',async()=>{
 const f=fixture();const p=f.run();await new Promise(r=>setImmediate(r));f.stop();
 await assert.rejects(p,{code:'WORKFLOW_STOPPED'});assert.equal(f.commands.length,0);assert.equal(f.context.screenshots.length,0);
});

const ts=(await import('typescript')).default;
const vm=await import('node:vm');
const {renderToStaticMarkup}=await import('react-dom/server');
const editor=fs.readFileSync(new URL('../src/components/WorkflowEditor.tsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('editor.tsx',editor,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let screenshotCard;
function visit(node){
 if(ts.isJsxElement(node) && node.openingElement.tagName.getText(tree)==='button' && node.openingElement.getText(tree).includes('screenshot.path')) screenshotCard=node.getText(tree);
 ts.forEachChild(node,visit);
}
visit(tree);
function renderCard(screenshot,src){
 // Mount actual lazy components in the visible/settled snapshot. Their async
 // loading/viewport lifecycle is covered by the dedicated report regressions.
 function component(file,states){let index=0;const hooks={useRef:v=>({current:v}),useEffect:()=>{},useState:v=>[index<states.length?states[index++]:v,()=>{}]};const scope={exports:{},require:name=>name==='react'?hooks:require(name)};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/components/'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,scope);return scope.exports.default;}
 const env={require,exports:{},reportHost:undefined,ReportViewport:component('ReportViewport.tsx',[true]),ReportScreenshot:component('ReportScreenshot.tsx',[src||'',true]),reportThumbnailStore:{},electronApi:undefined,AlertTriangle:()=> 'warning-icon',openPathInFolder:()=>{}};
 vm.runInNewContext(ts.transpileModule(`globalThis.render=(screenshot,index)=>(${screenshotCard});`,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,env);
 return env.render(screenshot,0);
}
test('failed screenshot card shows actual error, no image, and cannot open a missing file',()=>{
 assert.ok(screenshotCard);
 const node=renderCard({path:'/missing.png',success:false,error:'ADB <offline>'},'data:image/png;base64,old');
 assert.equal(node.props.disabled,true);
 const html=renderToStaticMarkup(node);
 assert.match(html,/截图采集失败/);assert.match(html,/ADB &lt;offline&gt;/);assert.match(html,/截图 1 · 采集失败/);
 assert.doesNotMatch(html,/<img|点击打开截图|预览暂不可用/);
});
test('valid screenshots retain preview and opening; unavailable preview is explained',()=>{
 const ok=renderCard({path:'/valid.png',success:true},'data:image/png;base64,valid');assert.equal(ok.props.disabled,false);
 assert.match(renderToStaticMarkup(ok),/<img/);
 assert.match(renderToStaticMarkup(renderCard({path:'/valid.png',success:true})),/预览暂不可用，点击打开原图/);
});
