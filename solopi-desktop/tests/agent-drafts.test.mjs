import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/components/agent-drafts.ts',import.meta.url),'utf8');
const script=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
function fixture(storage=new Map(),denied=false){
 const exports={},hooks={useCallback:fn=>fn,useSyncExternalStore:(_subscribe,snapshot)=>snapshot()};
 vm.runInNewContext(script,{exports,require:()=>hooks,sessionStorage:{getItem:k=>{if(denied)throw Error('denied');return storage.get(k);},setItem:(k,v)=>{if(denied)throw Error('denied');storage.set(k,v);},removeItem:k=>{if(denied)throw Error('denied');storage.delete(k);}}});
 return{...exports,storage};
}
test('text and attachment draft survives component unmount/remount and is isolated by session',()=>{
 const f=fixture(),file={name:'fixture.txt',size:4};
 f.useAgentDraft('a').setText('unfinished');f.useAgentDraft('a').setAttachments([file]);
 assert.equal(f.useAgentDraft('b').text,'');
 assert.equal(f.useAgentDraft('a').text,'unfinished');assert.equal(f.useAgentDraft('a').attachments[0],file);
});
test('text survives renderer reload while binary File contents are never serialized',()=>{
 const f=fixture(),file={name:'fixture',size:4};f.agentDrafts.setText('a','saved');f.agentDrafts.setAttachments('a',[file]);
 const reloaded=fixture(f.storage);assert.equal(reloaded.agentDrafts.read('a').text,'saved');assert.equal(reloaded.agentDrafts.read('a').attachments.length,0);
 assert.equal([...f.storage.values()].join(''),'saved');
});
test('failed send retains text and attachments; successful acknowledgement clears only the captured session draft',()=>{
 const f=fixture();f.agentDrafts.setText('a','pending');f.agentDrafts.setAttachments('a',[{name:'file'}]);
 let sending=f.agentDrafts.beginSend('a');assert.equal(f.useAgentDraft('a').sending,true);assert.equal(f.agentDrafts.beginSend('a'),null);
 f.agentDrafts.finishSend('a',sending.revision,false);assert.equal(f.useAgentDraft('a').text,'pending');assert.equal(f.useAgentDraft('a').attachments.length,1);
 sending=f.agentDrafts.beginSend('a');f.agentDrafts.setText('b','other draft');f.agentDrafts.finishSend('a',sending.revision,true);
 assert.equal(f.useAgentDraft('a').text,'');assert.equal(f.useAgentDraft('a').attachments.length,0);assert.equal(f.useAgentDraft('b').text,'other draft');
 assert.equal(fixture(f.storage).agentDrafts.read('a').text,'');
});
test('typing a newer draft during an in-flight request cannot be erased by its older acknowledgement',()=>{
 const f=fixture();f.agentDrafts.setText('a','first');const sending=f.agentDrafts.beginSend('a');
 f.agentDrafts.setText('a','newer');f.agentDrafts.finishSend('a',sending.revision,true);
 assert.equal(f.useAgentDraft('a').text,'newer');assert.equal(f.useAgentDraft('a').sending,false);
});
test('unavailable browser storage does not prevent draft retention across page switches',()=>{
 const f=fixture(new Map(),true);f.agentDrafts.setText('a','in memory');assert.equal(f.useAgentDraft('a').text,'in memory');
});
test('actual AgentPage textarea survives navigation unmount/remount in the same conversation',async()=>{
 const storage=new Map(),draftExports={},slots=[];let index=0,pending=[],cleanup=[];
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>v===b[i]);
 const react={
  useState:initial=>{const i=index++;slots[i] ||= {value:typeof initial==='function'?initial():initial};return[slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;}];},
  useRef:initial=>{const i=index++;return slots[i] ||= {current:initial};},
  useMemo:fn=>fn(),
  useCallback:(fn,deps)=>{const i=index++;if(!same(slots[i]?.deps,deps))slots[i]={value:fn,deps};return slots[i].value;},
  useEffect:(fn,deps)=>{const i=index++;if(!same(slots[i]?.deps,deps)){slots[i]={deps};pending.push(fn);}},
  useSyncExternalStore:(_subscribe,snapshot)=>snapshot(),
 };
 const session={id:'a',title:'fixture',status:'idle',messages:[],calls:[]};
 const window={glassbox:{ipcRenderer:{invoke:async channel=>channel==='agent:list'?{sessions:[session]}:channel==='agent:models'?{models:[],selectedModelId:''}:{session},on(){},removeListener(){}}},addEventListener(){},removeEventListener(){}};
 const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'};
 vm.runInNewContext(script,{exports:draftExports,require:()=>react,sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}});
 const timers=new Set();let timerId=0;
 const exports={},code=ts.transpileModule(fs.readFileSync(new URL('../src/components/AgentPage.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const language={useLanguage:()=>({t:chinese=>chinese})};
 const chatExports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/components/AgentChat.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports:chatExports,require:name=>name==='react/jsx-runtime'?jsx:name==='../language'?language:{}});
 vm.runInNewContext(code,{exports,window,Map,Set,Date,console,setInterval:()=>{const id=++timerId;timers.add(id);return id;},clearInterval:id=>timers.delete(id),require:name=>name==='../language'?language:name==='./AgentChat'?chatExports:name==='react'?react:name==='react/jsx-runtime'?jsx:name==='./agent-drafts'?draftExports:name==='./agent-turns'?{agentTurns:()=>[],modelOptions:()=>[]}:{} });
 const nodes=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(typeof node.type==='function'?node.type(node.props):node.props?.children)];
 const render=()=>{index=0;const tree=exports.default({initialSessionId:'a',onSessionChange(){},onNavigate(){},deviceControls:null});const effects=pending;pending=[];effects.forEach(fn=>{const c=fn();if(c)cleanup.push(c);});return tree;};
 render();await new Promise(r=>setImmediate(r));
 let input=nodes(render()).find(n=>n.type==='textarea');assert.equal(input.props.disabled,false);
 input.props.onChange({target:{value:'尚未发送的草稿'}});
 assert.equal(nodes(render()).find(n=>n.type==='textarea').props.value,'尚未发送的草稿');
 cleanup.forEach(fn=>fn());assert.equal(timers.size,0);cleanup=[];slots.length=0;pending=[];
 render();await new Promise(r=>setImmediate(r));
 input=nodes(render()).find(n=>n.type==='textarea');assert.equal(input.props.value,'尚未发送的草稿');
 cleanup.forEach(fn=>fn());
});

test('same-value input notifications cannot keep an acknowledged message in the composer',()=>{
 const f=fixture(),file={name:'image.png',size:8};
 f.agentDrafts.setText('a','sent');f.agentDrafts.setAttachments('a',[file]);
 const captured=f.agentDrafts.beginSend('a');
 f.agentDrafts.setText('a','sent');f.agentDrafts.setAttachments('a',files=>[...files]);
 assert.equal(f.agentDrafts.read('a').revision,captured.revision);
 f.agentDrafts.finishSend('a',captured.revision,true);
 assert.equal(f.agentDrafts.read('a').text,'');assert.equal(f.agentDrafts.read('a').attachments.length,0);
});
test('acknowledgement clears sent attachments while preserving newly typed text, and vice versa',()=>{
 const f=fixture(),sent={name:'sent.png'},next={name:'next.png'};
 f.agentDrafts.setText('a','sent');f.agentDrafts.setAttachments('a',[sent]);
 let captured=f.agentDrafts.beginSend('a');f.agentDrafts.setText('a','new draft');
 f.agentDrafts.finishSend('a',captured.revision,true);
 assert.equal(f.agentDrafts.read('a').text,'new draft');assert.equal(f.agentDrafts.read('a').attachments.length,0);
 f.agentDrafts.setAttachments('a',[sent]);captured=f.agentDrafts.beginSend('a');
 f.agentDrafts.setAttachments('a',[next]);f.agentDrafts.finishSend('a',captured.revision,true);
 assert.equal(f.agentDrafts.read('a').text,'');assert.equal(f.agentDrafts.read('a').attachments[0],next);
});
test('a stale completion cannot unlock or clear a newer pending send',()=>{
 const f=fixture();f.agentDrafts.setText('a','first');const first=f.agentDrafts.beginSend('a');f.agentDrafts.finishSend('a',first.revision,true);
 f.agentDrafts.setText('a','second');const second=f.agentDrafts.beginSend('a');
 f.agentDrafts.finishSend('a',first.revision,true);
 assert.equal(f.agentDrafts.read('a').sending,true);assert.equal(f.agentDrafts.read('a').text,'second');
 f.agentDrafts.finishSend('a',second.revision,false);assert.equal(f.agentDrafts.read('a').text,'second');
});
