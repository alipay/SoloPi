// Storage ownership is resolved here, so agents receive ordinary case-owned files.
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const pending=new Map();
async function caseLogFiles(task,c,{root,signal}={}) {
 const logs=c.artifacts?.logs || [];
 if(!logs.length)return [];
 if(['running','pending','queued'].includes(c.status))return [{error:'用例尚未结束，日志未封口，请稍后读取'}];
 // Normal reports already have case-owned files. Return the UI artifact directly.
 if(logs.every(a=>!a.sharedTaskLog))return logs.map(a=>{
  const file=a.path || a.outputPath || a.filePath;
  try{
   if((task.cases || []).some(other=>other!==c && (other.artifacts?.logs || []).some(b=>(b.path || b.outputPath || b.filePath)===file)))throw Error('报告中的日志路径归属重复');
   if(!file || !fs.statSync(file).isFile())throw Error('本例日志文件不存在');
   return {...a,path:file,caseId:c.caseId || c.id,scope:'case-owned-file'};
  }catch(error){return {deviceType:a.deviceType,caseId:c.caseId || c.id,error:error.message};}
 });
 const sources=logs.map(a=>{const file=a.path || a.outputPath || a.filePath;let stat;try{stat=fs.statSync(file);}catch{}return {file,size:stat?.size,mtime:stat?.mtimeMs,start:a.startSequence,end:a.endSequence,shared:a.sharedTaskLog};});
 const key=createHash('sha256').update(JSON.stringify([task.id,c.caseId || c.id,sources])).digest('hex');
 const index=path.join(root,key+'.json');
 try{const result=JSON.parse(fs.readFileSync(index,'utf8'));if(result.every(a=>a.path && fs.statSync(a.path).isFile()))return result;}catch{}
 if(pending.has(index))return pending.get(index);
 const work=(async()=>{
  const {exportCaseEvidence}=require('./case-evidence-export');
  const exported=await exportCaseEvidence({...task,cases:(task.cases || []).map(x=>x===c?{...x,artifacts:{...x.artifacts,recordings:[]}}:x)},
   {taskId:task.id,caseIds:[c.caseId || c.id]},{root,signal,logFormat:'plain'});
  const manifest=JSON.parse(fs.readFileSync(exported.manifestPath,'utf8'));
  const result=manifest.cases[0].artifacts.filter(a=>a.kind==='logs').map(a=>({deviceType:a.deviceType,caseId:c.caseId || c.id,
   ...(a.localPath?{path:a.localPath,lineCount:a.lineCount,scope:'case-owned-file'}:{error:a.error || '本例日志不可用'})}));
  // Missing/partial sources are retried on a later read, never cached as absence.
  if(result.length && result.every(a=>a.path))fs.writeFileSync(index,JSON.stringify(result),{mode:0o600});
  return result;
 })();
 pending.set(index,work);
 try{return await work;}finally{pending.delete(index);}
}
module.exports={caseLogFiles};
