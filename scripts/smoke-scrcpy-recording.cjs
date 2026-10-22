// Explicit candidate-only media acceptance, after active device tasks end.
// Usage (Electron RUN_AS_NODE): script ROOT ADAPTER SERIAL OUTPUT.mkv
const fs=require('node:fs'),path=require('node:path'),{spawn,execFile}=require('node:child_process');
const [root,adapter,serial,output]=process.argv.slice(2);
const execute=(file,args,env)=>new Promise((resolve,reject)=>execFile(file,args,{env,timeout:20000,maxBuffer:65536},(e,out)=>e?reject(e):resolve(out)));
(async()=>{
 if(!root||!adapter||!serial||!output||fs.existsSync(output))throw Error('Explicit candidate root, adapter, serial and unused output path required');
 const mediaRoot=path.join(root,'resources','media-runtime',`${process.platform}-${process.arch}`),ext=process.platform==='win32'?'.exe':'';
 const req=require('node:module').createRequire(path.join(root,'resources/app.asar/package.json'));
 const {resolveScrcpyEndpoint,createScrcpyTransport,scopedAdbEnvironment}=(process.argv[6] ? require(path.resolve(process.argv[6])) : req('./electron/scrcpy-transport'));
 const {getScrcpyEnvironment}=req('./electron/media-runtime');
 const endpoint=await resolveScrcpyEndpoint(adapter,serial);if(!endpoint)throw Error('Candidate adapter sidecar required');
 const events=[],transport=await createScrcpyTransport({endpoint,serial,onEvent:e=>events.push(e)});
 let child,log='',timer,forceTimer,outputWatch;
 try{
  const env=getScrcpyEnvironment({scrcpyServer:path.join(mediaRoot,'share/scrcpy/scrcpy-server')},scopedAdbEnvironment(process.env,path.join(mediaRoot,'bin','adb'+ext),transport.socket),{headless:true});
  fs.mkdirSync(path.dirname(output),{recursive:true});
  child=spawn(path.join(mediaRoot,'bin','scrcpy'+ext),['-s',serial,'--no-window','--no-audio','--force-adb-forward','--record',output],{env,stdio:['ignore','pipe','pipe']});
  const exited=new Promise((r,j)=>{child.once('error',j);child.once('close',(code,signal)=>r({code,signal}));});
  let stopScheduled=false;
  const append=data=>{log=(log+data.toString()).slice(-8000);};
  outputWatch=setInterval(()=>{if(!stopScheduled&&events.some(event=>event.phase==='video-frame-received')){stopScheduled=true;events.push({phase:'recording-media-ready'});timer=setTimeout(()=>child.kill('SIGINT'),4000);}},100);
  child.stdout.on('data',append);child.stderr.on('data',append);
  forceTimer=setTimeout(()=>child.kill('SIGKILL'),20000);
  const result=await exited;
  if(!stopScheduled||!fs.existsSync(output)||fs.statSync(output).size===0||result.code!==0)throw Error(`Candidate recording failed: ${JSON.stringify(result)}\n${log}`);
  const decoded=await execute(path.join(mediaRoot,'bin','ffmpeg'+ext),['-hide_banner','-loglevel','error','-i',output,'-frames:v','1','-progress','pipe:1','-f','null','-'],env);
  if(!/^frame=[1-9]\d*$/m.test(decoded))throw Error('Finalized video has no decodable frame');
  console.log(JSON.stringify({success:true,serial,output,sizeBytes:fs.statSync(output).size,decodableFrame:true,events}));
 }finally{
  clearTimeout(timer);clearTimeout(forceTimer);clearInterval(outputWatch);if(child&&child.exitCode===null&&!child.signalCode)child.kill('SIGKILL');transport.close();
  fs.writeFileSync(output+'.diagnostics.json',JSON.stringify({events,log,sizeBytes:fs.existsSync(output)?fs.statSync(output).size:0},null,2));
 }
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
