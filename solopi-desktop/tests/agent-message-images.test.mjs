import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/components/agent-message-content.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const exports={};vm.runInNewContext(code,{exports});const {messageDisplayText}=exports;
const a={id:'one',name:'image.png',path:'/example/attachments/one image.png',mime:'image/png',size:123};
test('current and legacy generated attachment descriptions render as text plus thumbnails without paths',()=>{
 const body='Question with an intentional /example/user-path';
 for(const suffix of ['\n\n附件（资料）：\n'+a.name+' — '+a.path,'\n附件（资料）:\n'+a.name+': '+a.path,'\n'+a.path]){
  const message={role:'user',content:body+suffix,attachments:[a]};
  assert.equal(messageDisplayText(message),body);assert.equal(message.content,body+suffix);
 }
 assert.equal(messageDisplayText({role:'user',content:a.path}),a.path);
 assert.equal(messageDisplayText({role:'user',content:'User wrote '+a.path,attachments:[a]}),'User wrote '+a.path);
 assert.equal(messageDisplayText({role:'user',content:'\n'+a.path,attachments:[a]}),'');
});
test('native image reader preserves full-image API and bounds thumbnail dimensions',async()=>{
 const main=fs.readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
 const start=main.indexOf("ipcMain.handle('file:read-image-data-url'");
 const end=main.indexOf('\n});',start)+4;
 let handler,resized;
 vm.runInNewContext(main.slice(start,end),{
  ipcMain:{handle:(_name,fn)=>{handler=fn;}},
  fs:{promises:{readFile:async()=>Buffer.from('bytes')}},path:{resolve:v=>v,extname:v=>v.slice(v.lastIndexOf('.'))},
  require:()=>({nativeImage:{createFromBuffer:()=>({isEmpty:()=>false,getSize:()=>({width:1600,height:800}),resize:size=>{resized=size;return{toDataURL:()=> 'data:image/png;base64,thumbnail'};}})}}),
 });
 assert.equal((await handler(null,'/example/image.png')).dataUrl,'data:image/png;base64,Ynl0ZXM=');
 const thumb=await handler(null,{path:'/example/image.png',maxDimension:384});
 assert.equal(thumb.success,true);assert.equal(resized.width,384);assert.equal(resized.height,192);
 assert.equal((await handler(null,{path:'/example/image.png',maxDimension:99999})).success,false);
 assert.equal((await handler(null,{path:'/example/file.txt',maxDimension:384})).success,false);
});

function attachmentRenderer(attachment, invoke) {
 const effects=[],slots=[],listeners=new Map();let cursor=0;
 const jsx=(type,props)=>({type,props});
 const hooks={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
  useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},
  useEffect(effect,deps){const i=cursor++,prior=slots[i];if(!prior||deps.some((v,j)=>v!==prior.deps[j])){prior?.cleanup?.();slots[i]={deps};effects.push(()=>{slots[i].cleanup=effect();});}},
 };
 const exports={};const componentCode=ts.transpileModule(fs.readFileSync(new URL('../src/components/AgentMessageAttachments.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(componentCode,{exports,require:name=>name==='react'?hooks:{jsx,jsxs:jsx},window:{glassbox:invoke?{ipcRenderer:{invoke}}:undefined,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)}});
 const leaf=exports.default({attachments:[attachment]}).props.children[0];
 const render=()=>{cursor=0;const tree=leaf.type(leaf.props);while(effects.length)effects.shift()();return tree;};
 const nodes=tree=>tree&&typeof tree==='object'?[tree,...[tree.props?.children].flat(Infinity).flatMap(nodes)]:[];
 return{render,nodes,listeners,dispose:()=>slots.forEach(slot=>slot?.cleanup?.())};
}
const flushAttachment=()=>new Promise(resolve=>setImmediate(resolve));
test('file attachment click reveals the exact path through the existing shell API',async()=>{
 const calls=[],f=attachmentRenderer({...a,mime:'text/plain'},async(...args)=>{calls.push(args);return{success:true};});
 let tree=f.render(),button=f.nodes(tree).find(n=>n.type==='button');assert.match(button.props['aria-label'],/在文件夹中显示/);button.props.onClick();await flushAttachment();tree=f.render();
 assert.deepEqual(calls,[['shell:show-item-in-folder',a.path]]);assert.equal(f.nodes(tree).some(n=>n.props?.role==='alert'),false);f.dispose();
});
test('file reveal failure is visible and permits retry',async()=>{
 let count=0;const f=attachmentRenderer({...a,mime:'application/pdf'},async()=>{count++;return{success:false,error:'File unavailable'};});
 f.nodes(f.render()).find(n=>n.type==='button').props.onClick();await flushAttachment();const tree=f.render();assert.equal(f.nodes(tree).find(n=>n.props?.role==='alert').props.children,'File unavailable');assert.equal(f.nodes(tree).find(n=>n.type==='button').props.disabled,false);assert.equal(count,1);f.dispose();
});
test('image click opens preview even when thumbnail failed, loads full image and Escape closes',async()=>{
 const calls=[],f=attachmentRenderer(a,async(channel,args)=>{calls.push([channel,args]);return typeof args==='string'?{success:true,dataUrl:'data:image/png;base64,full'}:{success:false,error:'Thumbnail failed'};});
 f.render();f.render();await flushAttachment();let tree=f.render();const button=f.nodes(tree).find(n=>n.type==='button');assert.equal(button.props.disabled,undefined);button.props.onClick();tree=f.render();assert.ok(f.nodes(tree).some(n=>n.props?.role==='dialog'));await flushAttachment();tree=f.render();assert.equal(f.nodes(tree).find(n=>n.type==='img').props.src,'data:image/png;base64,full');assert.equal(calls.at(-1)[1],a.path);
 f.listeners.get('keydown')({key:'Escape'});assert.equal(f.nodes(f.render()).some(n=>n.props?.role==='dialog'),false);f.dispose();
});
test('image preview read error is displayed instead of silently ignoring the click',async()=>{
 const f=attachmentRenderer(a,async()=>({success:false,error:'Image missing'}));f.render();f.nodes(f.render()).find(n=>n.type==='button').props.onClick();f.render();await flushAttachment();const tree=f.render();assert.equal(f.nodes(tree).find(n=>n.props?.role==='alert').props.children,'Image missing');f.dispose();
});
