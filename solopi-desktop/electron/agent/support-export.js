// Shared CLI/Agent/Web export. Only generated files are remotely readable.
const fs=require('node:fs'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {gzipSync,gunzipSync}=require('node:zlib');
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
let activeExports=0;
const exportsById=new Map(),TTL=15*60*1000,MAX=32*1024*1024;
const fail=code=>{throw Object.assign(Error(code),{code});};
function cleanup(){for(const [id,e] of exportsById)if(e.expiresAt<Date.now()){fs.rmSync(e.directory,{recursive:true,force:true});exportsById.delete(id);}}
const timer=setInterval(cleanup,60000);timer.unref();
async function createSupportExportInline(root,args={},task,signal){
 cleanup();if(exportsById.size+activeExports>=8)fail('EXPORT_CAPACITY');
 const parent=path.join(root,'support-exports');fs.mkdirSync(parent,{recursive:true,mode:0o700});
 for(const name of fs.readdirSync(parent)){if(!/^bundle-[A-Za-z0-9]+$/.test(name))continue;const target=path.join(parent,name),stat=fs.lstatSync(target);if(!stat.isSymbolicLink()&&stat.isDirectory()&&Date.now()-stat.mtimeMs>TTL)fs.rmSync(target,{recursive:true,force:true});}
 const directory=fs.mkdtempSync(path.join(parent,'bundle-'));fs.chmodSync(directory,0o700);
 activeExports++;try{
 if(!isMainThread)parentPort.postMessage({type:'directory',directory});
 signal?.throwIfAborted();
 const diagnostic=require('../diagnostics').bundle(root,path.join(directory,'runtime.json.gz'));
 const runtime=JSON.parse(gunzipSync(fs.readFileSync(diagnostic.path)));
 const bundle={format:'solopi-support-v1',createdAt:new Date().toISOString(),runtime,cases:[],files:[],issues:[],exclusions:['credentials and configuration','chat text','screenshots and recordings (download separately)']};
 if(args.taskId){
 if(!task)fail('TASK_NOT_FOUND');
 const result=await require('./case-evidence-export').exportCaseEvidence(task,args,{root:directory,signal,includeRecordings:false});
 const manifest=JSON.parse(fs.readFileSync(result.manifestPath));
 bundle.taskId=args.taskId;bundle.cases=result.cases;
 let total=0;const selected=new Set(args.caseIds);
 for(const row of task.cases.filter(c=>selected.has(c.caseId||c.id)))for(const recording of row.artifacts?.recordings||[]){
  if(!recording.diagnosticPath)continue;
  try{const f=recording.diagnosticPath,stat=fs.lstatSync(f);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4*1024*1024)throw Error('RECORDING_DIAGNOSTICS_UNAVAILABLE');
   if((total+=stat.size)>MAX)fail('EXPORT_TOO_LARGE');const data=gzipSync(fs.readFileSync(f));bundle.files.push({caseId:row.caseId||row.id,kind:'recording-diagnostics',name:`recording-diagnostics-${bundle.files.length}.jsonl.gz`,encoding:'base64',data:data.toString('base64')});
  }catch(error){if(error.code==='EXPORT_TOO_LARGE')throw error;bundle.issues.push('RECORDING_DIAGNOSTICS_UNAVAILABLE');}
 }
 for(const entry of manifest.cases)for(const item of entry.artifacts.filter(a=>a.kind==='logs'&&a.localPath)){
  signal?.throwIfAborted();const stat=fs.lstatSync(item.localPath);
  if(!stat.isFile()||stat.isSymbolicLink()||(total+=stat.size)>MAX)fail('EXPORT_TOO_LARGE');
  bundle.files.push({caseId:entry.caseId,deviceType:item.deviceType,name:`log-${bundle.files.length}.log.gz`,encoding:'base64',sha256:item.sha256,lineCount:item.lineCount,data:fs.readFileSync(item.localPath).toString('base64')});
 }
 }
 const bytes=gzipSync(JSON.stringify(bundle));if(bytes.length>MAX)fail('EXPORT_TOO_LARGE');
 const file=path.join(directory,'support.json.gz');fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});
 // Delete intermediate sliced logs; never delete report-owned originals.
 for(const name of fs.readdirSync(directory))if(name!=='support.json.gz')fs.rmSync(path.join(directory,name),{recursive:true,force:true});
 const exportId=randomUUID(),expiresAt=Date.now()+TTL,version=createHash('sha256').update(bytes).digest('hex');
 exportsById.set(exportId,{directory,file,version,size:bytes.length,expiresAt});
 return {success:true,exportId,expiresAt,version,size:bytes.length,mime:'application/gzip',filename:'solopi-support.json.gz',...(args.taskId?{taskId:args.taskId}:{}),cases:bundle.cases,issues:bundle.issues};
 }catch(e){fs.rmSync(directory,{recursive:true,force:true});throw e;}finally{activeExports--;}
}
function readSupportExport({exportId,version,offset=0,length=262144}){
 cleanup();const e=exportsById.get(exportId);if(!e)fail('EXPORT_EXPIRED');
 if(version!==e.version)fail('EXPORT_VERSION_CHANGED');
 if(!Number.isSafeInteger(offset)||offset<0||offset>=e.size||!Number.isSafeInteger(length)||length<1||length>262144)fail('EXPORT_RANGE_INVALID');
 const fd=fs.openSync(e.file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
 try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size!==e.size)fail('EXPORT_VERSION_CHANGED');const data=Buffer.alloc(Math.min(length,e.size-offset));const n=fs.readSync(fd,data,0,data.length,offset);if(n!==data.length)fail('EXPORT_TRUNCATED');return {success:true,exportId,version,size:e.size,offset,nextOffset:offset+n<e.size?offset+n:null,data:data.toString('base64')};}finally{fs.closeSync(fd);}
}
// Send report-owned references only; never copy workflow output, snapshots or recordings
// into the worker. Keep all cases' log references for shared-file ownership checks.
function exportTask(task){return task&&{id:task.id,taskId:task.taskId,devices:task.devices,cases:(task.cases||[]).map(c=>({caseId:c.caseId,id:c.id,caseName:c.caseName,name:c.name,status:c.status,startedAt:c.startedAt,finishedAt:c.finishedAt,endedAt:c.endedAt,error:c.error,artifacts:{logs:c.artifacts?.logs||[],recordings:(c.artifacts?.recordings||[]).filter(r=>r.diagnosticPath).map(r=>({diagnosticPath:r.diagnosticPath}))}}))};}
async function createSupportExport(root,args={},task,signal){
 signal?.throwIfAborted();cleanup();if(exportsById.size+activeExports>=8)fail('EXPORT_CAPACITY');
 activeExports++;let worker,directory,complete=false;
 try{
  const message=await new Promise((resolve,reject)=>{
   const unpacked=__filename.replace(/\.asar([\\/])/g,'.asar.unpacked$1');
   worker=new Worker(unpacked!==__filename&&fs.existsSync(unpacked)?unpacked:__filename,{workerData:{kind:'support-export',root,args,task:exportTask(task)}});
   const abort=()=>{void worker.terminate();reject(signal.reason||Object.assign(Error('Export cancelled'),{name:'AbortError'}));};
   signal?.addEventListener('abort',abort,{once:true});
   const finish=(error,value)=>{signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
   worker.on('message',m=>{if(m.type==='directory')directory=m.directory;else if(m.type==='result')finish(null,m);else if(m.type==='error')finish(Object.assign(Error(m.message),{code:m.code}));});
   worker.once('error',e=>finish(e));worker.once('exit',code=>{if(!complete)finish(Error('Export worker exited before returning a result ('+code+')'));});
   if(signal?.aborted)abort();
  });
  signal?.throwIfAborted();exportsById.set(message.meta.exportId,message.entry);complete=true;return message.meta;
 }finally{if(worker)await worker.terminate();if(!complete&&directory)fs.rmSync(directory,{recursive:true,force:true});activeExports--;}
}
if(!isMainThread&&workerData?.kind==='support-export'){
 createSupportExportInline(workerData.root,workerData.args,workerData.task).then(meta=>{parentPort.postMessage({type:'result',meta,entry:exportsById.get(meta.exportId)});parentPort.close();},error=>{parentPort.postMessage({type:'error',code:error.code,message:error.message});parentPort.close();});
}
module.exports={createSupportExport,readSupportExport};
