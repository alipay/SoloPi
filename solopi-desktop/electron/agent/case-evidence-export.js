const fs=require('node:fs');
const path=require('node:path');
const readline=require('node:readline');
const {createHash}=require('node:crypto');
const {createGzip}=require('node:zlib');
const {pipeline}=require('node:stream/promises');
const filePath=a=>a.path || a.outputPath || a.filePath;
async function digest(file){const hash=createHash('sha256');for await(const block of fs.createReadStream(file))hash.update(block);return hash.digest('hex');}
function writeJson(file,value){fs.writeFileSync(file,JSON.stringify(value,null,2),{mode:0o600,flag:'wx'});}
// Report-owned sources only. No model-supplied sequence numbers or source paths.
async function exportCaseEvidence(task,{taskId,caseIds,deviceTypes},{root,signal}={}){
 signal?.throwIfAborted();
 if((task.id || task.taskId)!==taskId)throw Error('报告taskId不匹配');
 if(!Array.isArray(caseIds)||!caseIds.length||caseIds.length>50||new Set(caseIds).size!==caseIds.length)throw Error('需要1–50个不重复caseId');
 const selected=caseIds.map(id=>{const found=(task.cases || []).filter(c=>(c.caseId || c.id)===id);if(found.length!==1)throw Error('报告用例不存在或不唯一');return found[0];});
 if(selected.some(c=>['running','pending','queued'].includes(c.status)))throw Error('用例尚未结束，不能导出未封口证据');
 fs.mkdirSync(root,{recursive:true});const directory=fs.mkdtempSync(path.join(root,'cases-'));fs.chmodSync(directory,0o700);
 const manifest={schemaVersion:'solopi.case-evidence-export.v1',taskId,createdAt:new Date().toISOString(),cases:[]};
 const groups=new Map();
 try{
 for(const [ci,c] of selected.entries()){
  const caseId=c.caseId || c.id,folder=path.join(directory,String(ci));fs.mkdirSync(folder,{mode:0o700});
  const entry={caseId,caseName:c.caseName || c.name || c.caseSnapshot?.name,status:c.status,startedAt:c.startedAt,finishedAt:c.finishedAt || c.endedAt,error:c.error || '',artifacts:[],missing:[]};manifest.cases.push(entry);
  const logs=(c.artifacts?.logs || []).filter(a=>!deviceTypes?.length || deviceTypes.includes(a.deviceType));
  if(!logs.length)entry.missing.push({kind:'logs',reason:'报告未记录所选设备的用例日志'});
  for(const [ai,a] of logs.entries()){
   const sourcePath=filePath(a),item={id:`c${ci}-log${ai}`,kind:'logs',deviceType:a.deviceType,serial:a.serial,sourcePath,localPath:path.join(folder,`log-${ai}.log.gz`)};
   entry.artifacts.push(item);
   try{
    if(!sourcePath || !path.isAbsolute(sourcePath))throw Error('日志来源路径无效');
    const stat=fs.statSync(sourcePath);if(!stat.isFile()||stat.size>512*1024**2)throw Error('日志不是普通文件或超过512MiB');
    const start=a.sharedTaskLog?a.startSequence:0,end=a.sharedTaskLog?a.endSequence:null;
    if(!Number.isSafeInteger(start)||start<0||end!==null&&(!Number.isSafeInteger(end)||end<start))throw Error('共享日志缺少有效用例序列边界');
    if(!a.sharedTaskLog && (task.cases || []).some(other=>other!==c && (other.artifacts?.logs || []).some(b=>filePath(b)===sourcePath)))throw Error('日志被多个用例共享却缺少序列范围');
    item.scope={boundary:a.sharedTaskLog?'(startSequence,endSequence]':'case-owned-file',startSequence:start,endSequence:end};
    item.sourceSnapshot={sizeBytes:stat.size,mtimeMs:stat.mtimeMs};
    const target={item,rawPath:item.localPath.slice(0,-3),start,end,count:0,buffers:[],bytes:0};
    target.fd=fs.openSync(target.rawPath,'wx',0o600);
    if(!groups.has(sourcePath))groups.set(sourcePath,[]);groups.get(sourcePath).push(target);
   }catch(error){item.error=error.message;delete item.localPath;}
  }
  const recordings=c.artifacts?.recordings || [];
  if(!recordings.length)entry.missing.push({kind:'recordings',reason:'报告未记录本例录屏'});
  for(const [ai,a] of recordings.entries()){
   const item={id:`c${ci}-video${ai}`,kind:'recordings',deviceType:a.deviceType,serial:a.serial,sourcePath:filePath(a)};entry.artifacts.push(item);
   try{
    if(a.caseId && a.caseId!==caseId || a.success===false || a.evidenceReady===false || a.sharedTaskRecording || a.sourcePath===filePath(a))throw Error('录屏未就绪或不是本例片段');
    if(!item.sourcePath || !path.isAbsolute(item.sourcePath) || !fs.statSync(item.sourcePath).isFile())throw Error('本例录屏文件不存在');
    item.localPath=item.sourcePath;item.sizeBytes=fs.statSync(item.localPath).size;item.sha256=await digest(item.localPath);
   }catch(error){item.error=error.message;delete item.localPath;}
  }
 }
 const flush=t=>{if(t.bytes){fs.writeSync(t.fd,Buffer.concat(t.buffers));t.buffers=[];t.bytes=0;}};
 for(const [file,targets] of groups){
  signal?.throwIfAborted();const size=targets[0].item.sourceSnapshot.sizeBytes;
  let sequence=0;const stream=size?fs.createReadStream(file,{encoding:'utf8',start:0,end:size-1}):null;
  const lines=stream?readline.createInterface({input:stream,crlfDelay:Infinity}):null;
  const abort=()=>stream?.destroy(Object.assign(Error('证据导出已取消'),{name:'AbortError'}));signal?.addEventListener('abort',abort,{once:true});
  try{
   if(lines)for await(const line of lines){signal?.throwIfAborted();if(!line)continue;sequence++;
    for(const t of targets)if(sequence>t.start && (t.end===null || sequence<=t.end)){
     const b=Buffer.from(line+'\n');t.buffers.push(b);t.bytes+=b.length;t.count++;if(t.bytes>=65536)flush(t);
    }
    if(targets.every(t=>t.end!==null&&sequence>=t.end))break;
   }
   const after=fs.statSync(file);
   if(targets.some(t=>after.size!==t.item.sourceSnapshot.sizeBytes || after.mtimeMs!==t.item.sourceSnapshot.mtimeMs))throw Error('日志源在导出期间变化，未生成可上传清单');
   for(const t of targets){flush(t);fs.closeSync(t.fd);t.fd=null;
    if(!t.count || t.end!==null && t.count!==t.end-t.start){t.item.error='日志为空或未覆盖报告中的完整序列范围';fs.rmSync(t.rawPath,{force:true});delete t.item.localPath;continue;}
    await pipeline(fs.createReadStream(t.rawPath),createGzip(),fs.createWriteStream(t.item.localPath,{flags:'wx',mode:0o600}),...(signal?[{signal}]:[]));
    t.item.lineCount=t.count;t.item.sha256=await digest(t.item.localPath);t.item.sizeBytes=fs.statSync(t.item.localPath).size;fs.rmSync(t.rawPath,{force:true});
   }
  }finally{signal?.removeEventListener('abort',abort);lines?.close();stream?.destroy();}
 }
 const manifestPath=path.join(directory,'manifest.json');writeJson(manifestPath,manifest);
 // A small authoritative report for the existing source-binding validator.
 writeJson(path.join(directory,'report.json'),{id:taskId,devices:task.devices,cases:selected.map(c=>({caseId:c.caseId || c.id,caseName:c.caseName || c.name || c.caseSnapshot?.name,artifacts:{logs:c.artifacts?.logs || []}}))});
 return {success:true,successScope:'local-export',manifestPath,reportPath:path.join(directory,'report.json'),cases:manifest.cases.map(c=>({caseId:c.caseId,exported:c.artifacts.filter(a=>a.localPath).length,missing:[...c.missing,...c.artifacts.filter(a=>a.error).map(a=>({kind:a.kind,deviceType:a.deviceType,reason:a.error}))]}))};
 }catch(error){for(const targets of groups.values())for(const t of targets)if(t.fd!==null)try{fs.closeSync(t.fd);}catch{}fs.rmSync(directory,{recursive:true,force:true});throw error;}
}
module.exports={exportCaseEvidence,digest};
