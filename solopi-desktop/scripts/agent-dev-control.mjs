// Native Electron main-process inspector, enabled only by explicit development launch.
// Uses the existing renderer IPC and Agent lifecycle; it never executes test cases directly.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const reviewModule=fileURLToPath(new URL('../electron/agent/review-events.js',import.meta.url));
const diagnosticsModule=fileURLToPath(new URL('../electron/diagnostics.js',import.meta.url));
const args=process.argv.slice(2),option=name=>args[args.indexOf(name)+1],action=args[0];
if(!['create','send','get','list','approval-mode','steer-queued','stop','request-policy','save-request-policy','compare-model','stop-comparison','comparison','models','select-model','quit','ui','capture','click','reload-renderer','review-metadata'].includes(action))throw Error('Unsupported Agent development action');
const port=args.includes('--port')?Number(option('--port')):9230;
if(!Number.isSafeInteger(port)||port<1024||port>65535)throw Error('Invalid inspector port');
const payload=args.includes('--input-file')?JSON.parse(fs.readFileSync(option('--input-file'),'utf8')):{};
if(action==='review-metadata' && (typeof payload.reportPath!=='string'||!payload.reportPath.startsWith('/')))throw Error('An absolute reportPath is required');
const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target=targets.find(t=>t.type==='node');if(!target)throw Error('No running development main-process inspector');
// Reduce in the renderer before crossing the inspector connection. Long-lived
// sessions keep full evidence, but observing status needs only recent metadata.
const compactResult=`result=>{if(!result?.session)return result;const s=result.session;return {...result,session:{id:s.id,title:s.title,status:s.status,error:s.error,errorDetails:s.errorDetails,contextState:s.contextState,streaming:s.streaming?{stage:s.streaming.stage,contentCharacters:s.streaming.content?.length||0,reasoningCharacters:s.streaming.reasoning?.length||0,toolCallCount:s.streaming.toolCallCount||0}:null,watch:s.watch,reviewWatch:s.reviewWatch,callCount:s.calls.length,calls:s.calls.slice(-20).map(c=>({id:c.id,name:c.name,status:c.status,taskId:c.result?.taskId,error:c.result?.error,waiting:c.result?.waiting})),queuedMessages:(s.queuedMessages||[]).map(q=>({id:q.id,createdAt:q.createdAt})),lastAssistant:s.messages.filter(m=>m.role==='assistant'&&m.content).at(-1)?.content}};}`;
const renderer=action==='click'?`(()=>{const wanted=${JSON.stringify(payload)};const b=Array.from(document.querySelectorAll('button')).find(b=>wanted.title?b.title===wanted.title:wanted.textPrefix&&b.textContent.trim().startsWith(wanted.textPrefix));if(!b)throw Error('Button not found');b.click();return {clicked:b.title||b.textContent.trim().slice(0,100)};})()`:action==='ui'?`Array.from(document.querySelectorAll('button')).map(b=>({title:b.title,label:b.getAttribute('aria-label'),text:b.textContent.trim().slice(0,100)})).filter(b=>b.title||b.label||b.text)`:`window.glassbox.ipcRenderer.invoke(${JSON.stringify('agent:'+action)},${JSON.stringify(payload)}).then(${compactResult})`;
const windowExpression="process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>!w.isDestroyed() && w.webContents.getURL().startsWith('http://127.0.0.1:'))";
const metadataExpression=`(()=>{const report=JSON.parse(process.mainModule.require('node:fs').readFileSync(${JSON.stringify(payload.reportPath)},'utf8'));const snapshot=process.mainModule.require(${JSON.stringify(reviewModule)}).reviewSnapshot(report);return {taskId:report.id,status:snapshot.status,caseCount:snapshot.caseEvents.length,caseEvents:${payload.caseId?`snapshot.caseEvents.filter(e=>e.caseId===${JSON.stringify(payload.caseId)})`:'snapshot.caseEvents.slice(0,1)'}};})()`;
const expression=action==='review-metadata'?metadataExpression:action==='reload-renderer'?`(()=>{const w=${windowExpression};if(!w)throw Error('No development window');const crashed=w.webContents.isCrashed();w.webContents.reload();return {requested:true,wasCrashed:crashed};})()`:action==='capture'?`${windowExpression}.webContents.capturePage().then(image=>{process.mainModule.require('node:fs').writeFileSync(${JSON.stringify(option('--output'))},image.toPNG(),{flag:'wx',mode:384});return ${JSON.stringify(option('--output'))};})`:action==='quit'?`process.once('uncaughtExceptionMonitor',error=>process.mainModule.require(${JSON.stringify(diagnosticsModule)}).record({event:'process.exception',diagnosticText:error.stack||error.message}));setTimeout(()=>process.mainModule.require('electron').app.quit(),100);true`:`process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>!w.isDestroyed() && w.webContents.getURL().startsWith('http://127.0.0.1:')).webContents.executeJavaScript(${JSON.stringify(renderer)})`;
const ws=new WebSocket(target.webSocketDebuggerUrl);
const result=await new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>{ws.close();reject(Error('Inspector response timed out'));},20000);
 ws.addEventListener('open',()=>ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}})));
 ws.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Inspector disconnected'));});
 ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id!==1)return;clearTimeout(timer);ws.close();if(message.error||message.result?.exceptionDetails)reject(Error(String(message.error?.message || message.result?.exceptionDetails?.exception?.description || message.result?.exceptionDetails?.text || 'Native Agent IPC evaluation failed').slice(0,2000)));else resolve(message.result.result.value);});
});
console.log(JSON.stringify(result,null,2));
