const fs=require('node:fs');
const path=require('node:path');
const readline=require('node:readline');
function logFiles(task){const records=[...(task.taskLogs || task.logs || []),...(task.artifacts?.logs || []),...(task.cases || []).flatMap(c=>c.artifacts?.logs || [])];return [...new Set(records.map(r=>r.path || r.outputPath || r.filePath).filter(Boolean))];}
async function searchTaskLogs(task,{fileIndex,deviceType,queries,caseId},signal){
 signal?.throwIfAborted();
 if(fileIndex!==undefined && (!Number.isSafeInteger(fileIndex)||fileIndex<0) || !Array.isArray(queries)||!queries.length||queries.length>12)throw Error('日志查询需要1–12个条件及有效文件索引');
 const ids=new Set(),states=queries.map((q,index)=>{
  if(!q || typeof q!=='object' || typeof q.query!=='string' || q.query.length>500)throw Error('query须为不超过500字的普通文本');
  const id=q.id ?? String(index);if(typeof id!=='string'||!id||id.length>100||ids.has(id))throw Error('查询id须唯一');ids.add(id);
  for(const key of ['startTime','endTime'])if(q[key]!==undefined && !/^\d{2}:\d{2}:\d{2}$/.test(q[key]))throw Error('时间格式须为HH:MM:SS');
  if(q.startTime && q.endTime && q.startTime>q.endTime)throw Error('跨午夜请分成两次时间范围查询');
  const limit=q.limit ?? 40,fromLine=q.fromLine ?? 1;
  if(!Number.isSafeInteger(limit)||limit<1||limit>80||!Number.isSafeInteger(fromLine)||fromLine<1)throw Error('limit须为1–80，fromLine>=1');
  if(q.timeText!==undefined && (typeof q.timeText!=='string'||q.timeText.length>50))throw Error('timeText须为不超过50字的文本');
  if(q.countOnly!==undefined && typeof q.countOnly!=='boolean')throw Error('countOnly须为布尔值');
  return{...q,id,limit,fromLine,matches:[],count:0,hasMore:false};
 });
 const selected=require('./log-source').select(task,{fileIndex,deviceType});if(selected.error)return selected.error;
 const {file,files}=selected;let scope;
 if(caseId){
  const c=(task.cases || []).find(c=>c.caseId===caseId || c.id===caseId);if(!c)throw Error('报告用例不存在');
  const artifact=(c.artifacts?.logs || []).find(a=>(a.path || a.outputPath || a.filePath)===file);
  if(!artifact)throw Error('所选日志不属于该用例');
  if(artifact.sharedTaskLog){
   if(!Number.isSafeInteger(artifact.startSequence)||!Number.isSafeInteger(artifact.endSequence)||artifact.startSequence<0||artifact.endSequence<artifact.startSequence)throw Error('共享日志缺少有效用例序列边界，禁止退回整场搜索');
   scope={caseId,startSequence:artifact.startSequence,endSequence:artifact.endSequence,boundary:'(startSequence,endSequence]'};
  }else scope={caseId,boundary:'case-owned-file'};
 }
 const handle=await fs.promises.open(file,'r');let stream,lines;
 try {
  const stat=await handle.stat();if(!stat.isFile()||stat.size>512*1024**2)throw Error('日志不是普通文件或超过512MiB');
  const snapshot={sizeBytes:stat.size,mtimeMs:stat.mtimeMs};let line=0,sequence=0,scanComplete=true;
  if(stat.size){
   // Freeze the byte boundary; an actively growing task log must not keep a query alive forever.
   stream=handle.createReadStream({encoding:'utf8',start:0,end:stat.size-1,autoClose:false});
   lines=readline.createInterface({input:stream,crlfDelay:Infinity});
   const abort=()=>stream.destroy(Object.assign(Error('日志查询已取消'),{name:'AbortError'}));
   signal?.addEventListener('abort',abort,{once:true});
   try{for await(const text of lines){signal?.throwIfAborted();line++;if(text)sequence++;
    if(scope?.endSequence!==undefined && sequence>scope.endSequence)break;
    if(scope?.startSequence!==undefined && (!text || sequence<=scope.startSequence))continue;
    let time;
    for(const q of states){if(q.hasMore || line<q.fromLine || !text.includes(q.query) || q.timeText && !text.includes(q.timeText))continue;
     if(q.startTime||q.endTime){time ??= text.match(/\b(\d{2}:\d{2}:\d{2})/)?.[1];if(!time || q.startTime && time<q.startTime || q.endTime && time>q.endTime)continue;}
     q.count++;if(q.countOnly)continue;
     if(q.matches.length>=q.limit)q.hasMore=true;else q.matches.push({line,text:text.slice(0,4000)});
    }
    if(states.every(q=>q.hasMore)){scanComplete=false;break;}
   }}finally{signal?.removeEventListener('abort',abort);}
  }
  signal?.throwIfAborted();
  return{success:true,file,files,deviceType:selected.deviceType,snapshot,...(scope?{scope}:{scope:{boundary:'task-wide',ownershipVerified:false}}),scanComplete,scannedLines:line,results:states.map(q=>({id:q.id,query:q.query,matches:q.matches,...(q.countOnly?{totalMatches:q.count}:{}),nextLine:q.hasMore?q.matches.at(-1).line+1:null}))};
 }finally{lines?.close();stream?.destroy();await handle.close();}
}
module.exports={searchTaskLogs,logFiles};
