// Isolated application renderer test. Never opens the user's app/data/devices/network.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const dir=process.argv[2];app.setPath('userData',path.join(dir,'user-data'));app.setName('solopi-harness-desktopSetupTest');
if(process.platform==='darwin'){app.setActivationPolicy('prohibited');app.dock.hide();}
app.whenReady().then(async()=>{
 let state={},environment={},actions=[],deviceQueries=0,authCalls=0,exported='';
 let holdStatus=true;const pendingStatus=[];
 const preload=path.resolve(__dirname,'../electron/preload.js');
 const window=new BrowserWindow({show:false,width:1100,height:1100,webPreferences:{preload,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 const rendererErrors=[];window.webContents.on('console-message',(_e,level,msg)=>{if(level===3){rendererErrors.push(msg);process.stderr.write('RENDERER: '+msg+'\n');}});
 require('../electron/team-configuration-ipc').installTeamConfiguration({register:(c,fn)=>ipcMain.handle(c,fn),directory:()=>path.join(dir,'data'),readState:()=>state,readEnvironment:()=>environment,savePatch:async prepare=>{state={...state,...prepare(state)};return {success:true};},saveEnvironment:async tts=>{environment.ttsProvider=tts;return {success:true};},readActions:()=>actions,writeActions:a=>{actions=a;},readDefinition:require('../electron/quick-actions').readQuickActionDefinition,pullCases:async()=>{throw Error('unexpected Git');},loadCaseCodec:async()=>{},importScripts:()=>{throw Error('unexpected Git');},saveFile:async content=>{exported=content;return {success:true};},notify:(c,p)=>{if(c==='team-config:changed'&&holdStatus)pendingStatus.push([c,p]);else window.webContents.send(c,p);}});
 ipcMain.handle('adb:list-devices',()=>{deviceQueries++;return {devices:[{serial:'PHONE',state:'device',model:'FixturePhone'},{serial:'GLASSES',state:'device',model:'FixtureGlasses'}]};});
 await window.loadFile(path.join(dir,'index.html'));
 const js=async code=>{const r=await window.webContents.executeJavaScript(`(()=>{try{return {ok:true,value:(${code})};}catch(e){return {ok:false,error:e.stack};}})()`);if(!r.ok)throw Error(r.error+'\nRenderer expression: '+code);return r.value;};const wait=async expr=>{const end=Date.now()+7000;while(Date.now()<end){if(await js(expr))return;await new Promise(r=>setTimeout(r,25));}throw Error('UI condition timed out: '+expr);};
 const click=async text=>{await wait(`(()=>{const b=[...(document.querySelector('[role="dialog"]')||document).querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}||b.getAttribute('aria-label')===${JSON.stringify(text)});return !!b&&!b.disabled;})()`);await js(`(()=>{const b=[...(document.querySelector('[role="dialog"]')||document).querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}||b.getAttribute('aria-label')===${JSON.stringify(text)});if(!b)throw Error('Missing button: '+JSON.stringify([...document.querySelectorAll('button')].map(b=>b.textContent)));b.click();})()`);};
 await wait(`!!document.querySelector('[role="dialog"]')`);await new Promise(r=>setTimeout(r,150));fs.writeFileSync('/tmp/lw-team-guide.png',(await window.webContents.capturePage()).toPNG());assert.equal(deviceQueries,0);
 // Overlay must cover the sidebar (z70) and device header (z60), with inert background.
 assert.equal(await js(`document.getElementById('root').inert`),true);
 assert.equal(await js(`Number(getComputedStyle(document.elementFromPoint(20,200)).zIndex)>=200`),true);
 assert.equal(await js(`Number(getComputedStyle(document.elementFromPoint(900,20)).zIndex)>=200`),true);
 window.webContents.sendInputEvent({type:'mouseDown',x:20,y:40,button:'left',clickCount:1});window.webContents.sendInputEvent({type:'mouseUp',x:20,y:40,button:'left',clickCount:1});
 await new Promise(r=>setTimeout(r,30));assert.equal(await js(`!!document.querySelector('[role="dialog"]')`),true);assert.equal(await js(`window.backgroundClicks||0`),0);
 await js(`document.getElementById('root').querySelector('button').focus()`);assert.equal(await js(`document.getElementById('root').contains(document.activeElement)`),false);

 const spotlight=()=>wait(`!!document.querySelector('[data-onboarding-spotlight] button[aria-label^="演示点击"]')`);
 const finishDemo=async last=>{while(await js(`document.querySelector('[data-onboarding-tooltip]')?.textContent.includes('下一处')`)){await click('下一处');await new Promise(r=>setTimeout(r,50));await spotlight();}if(await js(`document.querySelector('[data-onboarding-tooltip]')?.textContent.includes('查看页面')`)){await click('查看页面');await wait(`!document.querySelector('[data-onboarding-tooltip]')?.textContent.includes('查看页面')`);}await click(last);};
 const reopen=async()=>{await js(`document.querySelector('[data-onboarding-target="nav-settings"]').click()`);await wait(`document.body.textContent.includes('团队配置，一次到位')`);await click('入门引导');};
 await click('无团队配置文件');await spotlight();
 assert.equal(await js(`document.querySelector('[data-onboarding-tooltip]').textContent.includes('配置介绍 1/8')`),true);
 assert.equal(await js(`!!document.querySelector('[role="dialog"][data-state="open"]')`),false);
 assert.equal(await js(`document.getElementById('root').inert`),true);
 assert.equal(await js(`document.querySelector('[data-actual-page]').getAttribute('data-actual-page')`),'agent');assert.equal(await js(`(window.onboardingNavigations||[]).length`),0);
 // The proxy aligns with a real Sidebar button; clicking it cannot execute that DOM handler.
 await js(`document.querySelector('button[aria-label="演示点击设置中心"]').click()`);
 await wait(`!!document.querySelector('button[aria-label="演示点击模型配置"]')`);
 await wait(`document.querySelector('[data-actual-page]')?.getAttribute('data-actual-page')==='team'`);
 await js(`document.querySelector('button[aria-label="演示点击模型配置"]').click()`);
 await wait(`document.querySelector('[data-actual-page]')?.getAttribute('data-actual-page')==='model'`);
 assert.equal(await js(`document.querySelectorAll('[data-onboarding-tooltip] input,[data-onboarding-tooltip] select').length`),0);
 assert.equal(await js(`(()=>{const real=document.querySelector('[data-onboarding-target="settings-model"]').getBoundingClientRect();const proxy=document.querySelector('button[aria-label="演示点击模型配置"]').getBoundingClientRect();return Math.abs(proxy.left-real.left+5)<1&&Math.abs(proxy.width-real.width-10)<1;})()`),true);
 await js(`document.querySelector('[data-real-field]').focus()`);assert.equal(await js(`document.getElementById('root').contains(document.activeElement)`),false);
 const field=await js(`(()=>{const r=document.querySelector('[data-real-field]').getBoundingClientRect();return{x:Math.round(r.x+10),y:Math.round(r.y+10)};})()`);
 window.webContents.sendInputEvent({type:'mouseDown',...field,button:'left',clickCount:1});window.webContents.sendInputEvent({type:'mouseUp',...field,button:'left',clickCount:1});
 assert.equal(await js(`window.backgroundEdits||0`),0);assert.equal(await js(`document.querySelector('[data-real-field]').value`),'unchanged');
 await spotlight();await window.webContents.capturePage();await new Promise(r=>setTimeout(r,120));fs.writeFileSync('/tmp/solopi-onboarding-demo.png',(await window.webContents.capturePage()).toPNG());
 // Resize and remove/restore a target: the hole tracks layout and never keeps a stale target.
 window.setSize(760,760);await new Promise(r=>setTimeout(r,120));await spotlight();
 assert.equal(await js(`(()=>{const card=document.querySelector('[data-onboarding-tooltip]').getBoundingClientRect();return card.left>=0&&card.top>=0&&card.right<=innerWidth+1&&card.bottom<=innerHeight+1;})()`),true);
 assert.equal(await js(`(()=>{const a=document.querySelector('[data-onboarding-tooltip]').getBoundingClientRect(),b=document.querySelector('button[aria-label="演示点击模型配置"]').getBoundingClientRect();return a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom;})()`),true);
 await js(`(()=>{window.savedTourTarget=document.querySelector('[data-onboarding-target="settings-model"]');window.savedTourParent=window.savedTourTarget.parentNode;window.savedTourTarget.remove();})()`);
 await wait(`!document.querySelector('button[aria-label="演示点击模型配置"]')`);await wait(`document.querySelector('[data-onboarding-tooltip]')?.textContent.includes('未找到对应入口')`);
 await js(`window.savedTourParent.appendChild(window.savedTourTarget)`);await spotlight();
 window.setSize(1100,1100);await new Promise(r=>setTimeout(r,80));
 assert.equal(deviceQueries,0);assert.deepEqual(state,{});assert.equal(actions.length,0);
 await finishDemo('下一项');await spotlight();await wait(`document.querySelector('[data-onboarding-tooltip]')?.textContent.includes('配置介绍 2/8')`);assert.equal(await js(`document.querySelector('[data-actual-page]').getAttribute('data-actual-page')`),'model');
 window.reload();await spotlight();await wait(`document.querySelector('[data-onboarding-tooltip]')?.textContent.includes('配置介绍 2/8')`);
 for(const title of ['环境配置','设备管理','TTS 配置','音频 Mock 与 ADB 命令','用例库','快捷操作','常用站点']){
  await spotlight();assert.equal(await js(`document.querySelector('[data-onboarding-tooltip]').textContent.includes(${JSON.stringify(title)})`),true);
  await finishDemo(title==='常用站点'?'完成介绍':'下一项');
  if(title!=='常用站点')await new Promise(r=>setTimeout(r,50));
 }
 await wait(`!document.querySelector('[role="dialog"]')`);assert.equal(await js(`document.getElementById('root').inert`),false);
 assert.equal(deviceQueries,0);assert.deepEqual(state,{});assert.equal(actions.length,0);assert.equal(await js(`window.backgroundClicks||0`),0);await wait(`document.querySelector('[data-actual-page]')?.getAttribute('data-actual-page')==='agent'`);
 await reopen();await wait(`document.querySelector('[role="dialog"]')?.textContent.includes('有团队配置文件')`);
 await click('有团队配置文件');await wait(`!!document.querySelector('[role="dialog"] input[type=file]')`);
 const manifest={schemaVersion:'lenswiper.team-config.v1',id:'fixture',name:'Fixture Team',version:'1',llmProviders:[{id:'model',name:'Model',model:'fixture',baseUrl:'https://example.test/v1',apiKey:'FIXTURE_SECRET'}],ttsProvider:{url:'https://example.test/tts'},deviceBindings:{phoneDefaultPackage:'com.example.phone',glassesDefaultPackage:'com.example.glasses'},quickActions:[{id:'action',fileName:'fixture.sh',content:'#!/bin/sh\nexit 99\n',configuration:{name:'Fixture action',inputs:[],args:[]}}]};
 await js(`(()=>{const input=document.querySelector('[role="dialog"] input[type=file]');const files=new DataTransfer();files.items.add(new File([${JSON.stringify(JSON.stringify(manifest))}],'fixture.json',{type:'application/json'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await wait(`document.querySelector('[role="dialog"]')?.textContent.includes('Fixture Team')`);await click('导入团队配置');await wait(`document.querySelector('[role="dialog"]')?.textContent.includes('团队配置已导入。')`);
 assert.equal(state.llmProviders[0].apiKey,'FIXTURE_SECRET');assert.equal(actions.length,1);assert.equal(deviceQueries,0);
 await click('下一步');await wait(`document.querySelector('[role="dialog"]')?.textContent.includes('确认这台电脑的设备')`);await click('检测已连接设备');await wait(`document.querySelectorAll('[role="dialog"] select option').length>=6`);
 await js(`(()=>{for(const [label,value] of [['手机设备映射','PHONE'],['眼镜设备映射','GLASSES']]){const input=document.querySelector('select[aria-label="'+label+'"]');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(input,value);input.dispatchEvent(new Event('change',{bubbles:true}));}})()`);
 await click('确认设备角色');await wait(`document.querySelector('[role="dialog"]')?.textContent.includes('设备角色已保存')`);assert.deepEqual(state.deviceBindings.phoneSerials,['PHONE']);
 await click('下一步');await wait(`document.querySelector('[role="dialog"]')?.textContent.includes('从这里开始')`);
 for(const title of ['浏览与运行用例','让 Agent 协助分析','一键执行常用操作','设备、性能与录屏']){
  await js(`[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.startsWith('${title}')).click()`);
  await spotlight();await finishDemo('返回开始使用');
  assert.equal(await js(`window.onboardingNavigations.length>0`),true);assert.equal(deviceQueries,1);assert.equal(actions.length,1);
  await wait(`document.querySelector('[role="dialog"]')?.textContent.includes('从这里开始')`);
 }
 await click('开始使用');await wait(`!document.querySelector('[role="dialog"]')`);
 // Persisted progress must reopen correctly even before status notifications arrive.
 await reopen();await wait(`document.querySelector('[role="dialog"]')?.textContent.includes('有团队配置文件')`);
 holdStatus=false;for(const [channel,payload] of pendingStatus)window.webContents.send(channel,payload);
 await click('暂时跳过');await wait(`!document.querySelector('[role="dialog"]')`);
 await click('导出 JSON');await wait(`document.body.textContent.includes('配置文件已导出')`);assert.equal(exported.includes('FIXTURE_SECRET'),false);
 await js(`(()=>{const label=[...document.querySelectorAll('label')].find(l=>l.textContent.includes('包含模型 Key'));label.querySelector('input').click();})()`);await click('导出 JSON');await wait(`document.body.textContent.includes('配置文件已导出')`);assert.equal(exported.includes('FIXTURE_SECRET'),true);
 // Recreate renderer with the same isolated store: dismissed onboarding must not reopen.
 window.reload();await wait(`!!document.querySelector('[data-actual-page]')`);await new Promise(r=>setTimeout(r,150));assert.equal(await js(`!!document.querySelector('[role="dialog"]')`),false);
 const image=await window.webContents.capturePage();fs.writeFileSync('/tmp/lw-team-settings.png',image.toPNG());
 if(rendererErrors.length)throw Error(rendererErrors.join('\n'));
 process.stdout.write(JSON.stringify({success:true,deviceQueries,actions:actions.length,authCalls})+'\n');window.destroy();app.exit(0);
}).catch(error=>{process.stderr.write(error.stack+'\n');app.exit(1);});
