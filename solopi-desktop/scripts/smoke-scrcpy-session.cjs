// Native acceptance of the exact packaged main.js session/stop functions.
// No application boot, persisted state writes, business tasks or shared server lifecycle.
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module'),{spawn,execFile}=require('node:child_process');
const [root,adapter,serial,output]=process.argv.slice(2);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const execute=(file,args,options={})=>new Promise((resolve,reject)=>execFile(file,args,{...options,timeout:options.timeout||20000},(e,stdout,stderr)=>e?reject(e):resolve({stdout,stderr})));
(async()=>{
 if(!root||!adapter||!serial||!output||fs.existsSync(output))throw Error('Explicit candidate root, adapter, serial and unused output required');
 const main=path.join(root,'resources/app.asar/electron/main.js'),req=createRequire(main),source=fs.readFileSync(main,'utf8');
 const names=['createScrcpySession','waitForScrcpySessionReady','signalScrcpySession','waitForScrcpyExit','stopScrcpySession'];
 const bodies=names.map(name=>{const match=source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));if(!match)throw Error('Missing packaged session function: '+name);return match[0];}).join('\n');
 const runtime=req('./media-runtime'),media=runtime.resolveMediaRuntime({resourcesPath:path.join(root,'resources'),isPackaged:true});
 const env={...process.env,ADB:adapter,ADB_PATH:adapter};
 const context={require:req,spawn,fs,path,process,AbortController,Date,Symbol,Promise,sleep,getAdbPath:()=>adapter,resolveMediaRuntime:()=>media,getScrcpyEnvironment:runtime.getScrcpyEnvironment,getAdbAwareCommandEnv:()=>env,app:{isPackaged:true},workflowCommandScope:{getStore:()=>''},workflowCommandCancels:new Map(),isWorkflowCanceled:()=>false,isQuitting:false,runCommandWithOptions:execute};
 const api=Function(...Object.keys(context),`${bodies};return {createScrcpySession,waitForScrcpySessionReady,stopScrcpySession};`)(...Object.values(context));
 fs.mkdirSync(path.dirname(output),{recursive:true});
 let session;
 try{
  const started=Date.now();
  session=await api.createScrcpySession(media.scrcpy,['-s',serial,'--no-window','--no-audio','--record',output],{serial,path:output,deviceType:'fixture',taskId:'native-acceptance'});
  const ready=await api.waitForScrcpySessionReady(session);
  if(!ready)throw Error('Packaged session did not become ready: '+session.error);
  const readyMs=Date.now()-started,bytesAtReady=fs.existsSync(output)?fs.statSync(output).size:0;
  await sleep(4000);await api.stopScrcpySession(session);
  if(!session.exited||session.exitCode!==0)throw Error('Packaged session did not finalize normally: '+session.error);
  const {stdout}=await execute(media.ffmpeg,['-hide_banner','-loglevel','error','-i',output,'-frames:v','1','-progress','pipe:1','-f','null','-']);
  if(!/^frame=[1-9]\d*$/m.test(stdout))throw Error('Finalized video has no decodable frame');
  console.log(JSON.stringify({success:true,serial,readyMs,bytesAtReady,sizeBytes:fs.statSync(output).size,exitCode:session.exitCode,decodableFrame:true,transportDiagnostics:session.transportDiagnostics}));
 }finally{
  if(session){await api.stopScrcpySession(session);session.closeTransport?.();fs.writeFileSync(output+'.session.json',JSON.stringify({error:session.error,exitCode:session.exitCode,exitSignal:session.exitSignal,readyAtMs:session.readyAtMs,transportDiagnostics:session.transportDiagnostics},null,2));}
 }
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
