import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const React=require('react'),Module=require('node:module');
function load(file, initialStates=[]) {
  const filename=path.resolve('src/components',file);
  const code=require('@babel/core').transformSync(fs.readFileSync(filename,'utf8'),{filename,presets:[['@babel/preset-env',{targets:{node:'current'},modules:'commonjs'}],['@babel/preset-react',{runtime:'automatic'}],'@babel/preset-typescript']}).code;
  const loaded=new Module(filename);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));
  let cursor=0; const state=[...initialStates]; const realRequire=loaded.require.bind(loaded);
  loaded.require=name=>name==='./RecordingTargetFields'?{default:'RecordingTargetFields'}:name==='react'?{...React,useEffect:()=>{},useRef:()=>({current:0}),useState:value=>{const index=cursor++;if(!(index in state))state[index]=value;return [state[index],next=>{state[index]=typeof next==='function'?next(state[index]):next;}];}}:realRequire(name);
  loaded._compile(code,filename);
  return {render:props=>{cursor=0;return loaded.exports.default(props);}};
}
function nodes(tree,predicate) {
  const result=[];
  const walk=n=>{if(!n||typeof n!=='object')return;if(Array.isArray(n))return n.forEach(walk);if(predicate(n))result.push(n);walk(n.props?.children);};walk(tree);return result;
}
const button=(tree,label)=>nodes(tree,n=>n.type==='button'&&(n.props['aria-label']===label||JSON.stringify(n.props.children).includes(label)))[0];
function dialog(session,busy=false){
  const calls=[];let closed=0;
  const h=load('SoloPiImport.tsx',['Fixture',session?[session]:[],'',null,busy,'']);
  const api={ipcRenderer:{invoke:async(channel,payload)=>{calls.push([channel,payload]);return channel==='solopi:current'?{success:true,sessions:[]}:{success:true};}}};
  return {render:()=>h.render({api,mode:'record',phoneSerial:'phone',phonePackage:'org.example',onImport(){},onClose:()=>{closed++;}}),calls,closed:()=>closed};
}
test('failed recovery session can close without discarding evidence or stopping a foreign recording',()=>{
  const h=dialog({id:'owned',name:'Fixture',serial:'phone',state:'recovery-required',error:'timeout',finished:false});
  const close=button(h.render(),'关闭录制窗口');assert.equal(close.props.disabled,false);close.props.onClick();
  assert.equal(h.closed(),1);assert.deepEqual(h.calls,[]);
  assert.match(JSON.stringify(h.render()),/恢复会话会保留/);
});
test('running recording and in-flight operations keep their close protection',()=>{
  for(const [session,busy] of [[{state:'recording',finished:false},false],[{state:'recovery-required',finished:false},true]]){
    assert.equal(button(dialog(session,busy).render(),'关闭录制窗口').props.disabled,true);
  }
  assert.equal(button(dialog({state:'stopped',finished:true}).render(),'关闭录制窗口').props.disabled,false);
});
test('stop/convert and discard are visible separate buttons and keep session-scoped IPC',async()=>{
  const session={id:'owned',name:'Fixture',serial:'phone',state:'recovery-required',finished:false};
  const stop=dialog(session),discard=dialog(session);
  for(const label of ['停止并转换','放弃本次导入']){
    const b=button(stop.render(),label);assert.match(b.props.className,/border/);assert.match(b.props.className,/min-h-10/);assert.equal(b.props.type,'button');
  }
  await button(stop.render(),'停止并转换').props.onClick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(stop.calls[0],['solopi:record-stop',{id:'owned'}]);
  await button(discard.render(),'放弃本次导入').props.onClick();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(discard.calls[0],['solopi:record-discard',{id:'owned'}]);
});
test('runtime icon reflects controlled selection and options preserve both names and brand icons',()=>{
  const h=load('DeviceRuntimeSelect.tsx');let value='android';
  const props=()=>({value,onChange:next=>{value=next;},label:'眼镜系统'});
  const tree=h.render(props());assert.equal(tree.props.value,'android');
  tree.props.onValueChange('harmony');const selected=h.render(props());assert.equal(selected.props.value,'harmony');
  const trigger=nodes(selected,n=>n.props?.['aria-label']==='眼镜系统')[0];
  assert.equal(trigger.props.children[0].props.runtime,'harmony');assert.match(trigger.props.title,/鸿蒙/);
  assert.deepEqual(nodes(selected,n=>n.props?.textValue).map(n=>n.props.textValue),['Android','鸿蒙']);
  assert.equal(nodes(selected,n=>n.type==='select').length,0);
  const source=fs.readFileSync('src/components/DeviceHeader.tsx','utf8');
  assert.equal((source.match(/<DeviceRuntimeSelect /g)||[]).length,2);assert.doesNotMatch(source,/opacity-0|<Bot |<Cpu /);
});
test('a busy recovery stop still permits discard so the user can cancel the blocked operation',()=>{
  const h=dialog({id:'owned',state:'recovery-required',finished:false},true);
  assert.equal(button(h.render(),'停止并转换').props.disabled,true);
  assert.equal(button(h.render(),'放弃本次导入').props.disabled,false);
});
test('offline phone gives an actionable reason and refresh; reconnect enables recording without losing the entered name',async()=>{
  const calls=[];let refreshes=0;
  const h=load('SoloPiImport.tsx');
  const props={api:{ipcRenderer:{invoke:async(channel,payload)=>{calls.push([channel,payload]);return {success:true,id:'new',sessions:[]};}}},mode:'record',phoneSerial:'',phonePackage:'org.example',onRefreshDevices:()=>{refreshes++;},onImport(){},onClose(){}};
  let tree=h.render(props);
  const input=nodes(tree,n=>n.type==='input')[0];input.props.onChange({target:{value:'Preserved user name'}});
  tree=h.render(props);
  assert.equal(button(tree,'开始录制').props.disabled,true);
  assert.match(button(tree,'开始录制').props.title,/未检测到在线手机/);
  assert.ok(nodes(tree,n=>n.props?.id==='solopi-start-block-reason').length);
  button(tree,'重新检测设备').props.onClick();assert.equal(refreshes,1);assert.deepEqual(calls,[]);
  props.phoneSerial='phone-reconnected';tree=h.render(props);
  assert.equal(button(tree,'开始录制').props.disabled,false);
  assert.equal(nodes(tree,n=>n.type==='input')[0].props.value,'Preserved user name');
  button(tree,'开始录制').props.onClick();await new Promise(setImmediate);
  assert.deepEqual(calls[0],['solopi:record-start',{serial:'phone-reconnected',name:'Preserved user name',targetPackage:'org.example',startMode:'app-launch',preparationShell:''}]);
});
test('each start prerequisite explains its disabled state; blank names do not dispatch',()=>{
  for(const [serial,pkg,name,reason] of [['phone','','Fixture','选择要录制的应用'],['phone','org.example','  ','填写用例名称']]){
    const h=load('SoloPiImport.tsx',[name,[],'',null,false,'']);
    const tree=h.render({api:null,mode:'record',phoneSerial:serial,phonePackage:pkg,onImport(){},onClose(){}});
    assert.equal(button(tree,'开始录制').props.disabled,true);assert.match(button(tree,'开始录制').props.title,new RegExp(reason));
  }
});

test('recording offers only homepage start, with no command field or page-mode selector',async()=>{
  const h=load('SoloPiImport.tsx');const calls=[];
  const props={api:{ipcRenderer:{invoke:async(channel,payload)=>{calls.push([channel,payload]);return {success:true,id:'owned',sessions:[]};}}},mode:'record',phoneSerial:'phone',phonePackage:'org.example',onImport(){},onClose(){}};
  const tree=h.render(props);
  assert.equal(nodes(tree,n=>n.type==='textarea'||n.props?.['aria-label']==='录制起点').length,0);
  assert.doesNotMatch(JSON.stringify(tree),/前置命令|ADB Shell|从当前页面/);
  assert.equal(button(tree,'开始录制').props.disabled,false);
  button(tree,'开始录制').props.onClick();await new Promise(setImmediate);
  assert.deepEqual(calls[0],['solopi:record-start',{serial:'phone',targetPackage:'org.example',name:'新录制用例',startMode:'app-launch',preparationShell:''}]);
});
test('permission rejection opens a desktop blocking dialog and retains user input for retry',async()=>{
  const h=load('SoloPiImport.tsx');const calls=[];
  const missing=[{key:'accessibility',label:'无障碍服务',action:'在系统设置中启用 SoloPi'}];
  const props={api:{ipcRenderer:{invoke:async(channel,payload)=>{calls.push([channel,payload]);return channel==='solopi:current'?{success:true,sessions:[]}:{success:false,error:'权限未就绪',permissionCheck:{root:false,missing}};}}},mode:'record',phoneSerial:'phone',phonePackage:'org.example',onImport(){},onClose(){}};
  let tree=h.render(props);nodes(tree,n=>n.type==='input')[0].props.onChange({target:{value:'Keep my name'}});
  tree=h.render(props);button(tree,'开始录制').props.onClick();await new Promise(setImmediate);
  tree=h.render(props);assert.equal(nodes(tree,n=>n.props?.role==='alertdialog').length,1);
  assert.match(JSON.stringify(tree),/无障碍服务/);assert.equal(nodes(tree,n=>n.type==='input')[0].props.value,'Keep my name');
  button(tree,'返回，处理后重新开始').props.onClick();tree=h.render(props);
  assert.equal(nodes(tree,n=>n.props?.role==='alertdialog').length,0);assert.equal(calls.filter(c=>c[0]==='solopi:record-start').length,1);
});

test('explicit permission override resumes homepage recording once and ordinary starts never inherit it',async()=>{
  const h=load('SoloPiImport.tsx');const calls=[];
  const props={api:{ipcRenderer:{invoke:async(channel,payload)=>{calls.push([channel,payload]);return channel==='solopi:current'?{success:true,sessions:[]}:payload.skipPermissionPrecheck?{success:true,id:'owned'}:{success:false,error:'权限未就绪',permissionCheck:{missing:[{key:'accessibility',label:'无障碍服务',action:'系统设置'}]}};}}},mode:'record',phoneSerial:'phone',phonePackage:'org.example',onImport(){},onClose(){}};
  let tree=h.render(props);
  tree=h.render(props);button(tree,'开始录制').props.onClick();await new Promise(setImmediate);
  tree=h.render(props);button(tree,'我已授权，直接进入').props.onClick();
  tree=h.render(props);assert.equal(nodes(tree,n=>n.props?.role==='alertdialog').length,0);assert.equal(button(tree,'开始录制').props.disabled,true);
  await new Promise(setImmediate);tree=h.render(props);assert.equal(nodes(tree,n=>n.props?.role==='alertdialog').length,0);
  button(tree,'开始录制').props.onClick();await new Promise(setImmediate);
  const starts=calls.filter(c=>c[0]==='solopi:record-start').map(c=>c[1]);
  assert.equal(starts.length,3);assert.deepEqual(starts[1],{...starts[0],skipPermissionPrecheck:true});assert.deepEqual(starts[2],starts[0]);
  assert.equal(starts[1].preparationShell,'');assert.equal(starts[1].startMode,'app-launch');
});
