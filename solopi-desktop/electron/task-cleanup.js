const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const TERMINAL=new Set(['success','failed','stopped','completed','cancelled','interrupted']);
const roots=['workflow-report-details','report-packages','logs/workflow-runs','logs/workflow-task-recordings','reports'];
const fail=(code,message,details={})=>Object.assign(Error(message),{code,details});
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const inside=(p,dir)=>p!==dir && p.startsWith(dir+path.sep);
function removedIds(state={}){return new Set((state.removedAutomationTasks || []).map(r=>r.id));}
function preserveRemovals(next={},previous={}){
 const records=new Map([...(previous.removedAutomationTasks || []),...(next.removedAutomationTasks || [])].map(r=>[r.id,r]));
 return {...next,...(records.size?{removedAutomationTasks:[...records.values()]}:{}),automationTasks:(next.automationTasks || []).filter(t=>!records.has(t.id))};
}
function selectTasks(tasks,request={},now=Date.now()){
 const allowed=['taskIds','query','olderThan','before','status','keep','limit','purgeArtifacts','backup','dryRun'];
 if(!request || Array.isArray(request)||Object.keys(request).some(k=>!allowed.includes(k)))throw fail('TASK_CLEANUP_INVALID','未知清理参数');
 for(const key of ['taskIds','keep'])if(request[key]!==undefined && (!Array.isArray(request[key])||request[key].some(x=>typeof x!=='string'||!x.trim())||(key==='taskIds'&&!request[key].length)))throw fail('TASK_CLEANUP_INVALID',`${key} 必须为非空ID数组`);
 for(const key of ['query','olderThan','before','status','backup'])if(request[key]!==undefined && (typeof request[key]!=='string'||!request[key].trim()))throw fail('TASK_CLEANUP_INVALID',`${key} 必须为非空文本`);
 for(const key of ['dryRun','purgeArtifacts'])if(request[key]!==undefined && typeof request[key]!=='boolean')throw fail('TASK_CLEANUP_INVALID',`${key} 必须为布尔值`);
 if(!request.taskIds?.length && !request.query && !request.olderThan && !request.before && !request.status)throw fail('TASK_CLEANUP_FILTER_REQUIRED','必须指定 taskId 或筛选条件');
 if(request.status && !['success','failed','stopped'].includes(request.status))throw fail('TASK_CLEANUP_INVALID','status 仅支持 success/failed/stopped');
 const limit=request.limit ?? 50;if(!Number.isSafeInteger(limit)||limit<1||limit>100000)throw fail('TASK_CLEANUP_INVALID','limit 必须为 1–100000 整数');
 let cutoff=Infinity;
 if(request.olderThan){const m=/^([1-9]\d*)(d|m)$/.exec(request.olderThan);if(!m)throw fail('TASK_CLEANUP_INVALID','olderThan 使用 Nd 或 Nm（分钟）');cutoff=now-Number(m[1])*(m[2]==='d'?86400000:60000);if(!Number.isFinite(cutoff))throw fail('TASK_CLEANUP_INVALID','时间范围无效');}
 if(request.before){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(request.before);const date=m?new Date(+m[1],+m[2]-1,+m[3]):null;if(!date||date.getFullYear()!==+m[1]||date.getMonth()!==+m[2]-1||date.getDate()!==+m[3])throw fail('TASK_CLEANUP_INVALID','before 使用有效的 yyyy-MM-dd 日期（本地零点之前）');cutoff=Math.min(cutoff,date.getTime());}
 const ids=request.taskIds?new Set(request.taskIds):null,keep=new Set(request.keep || []);
 if(ids){const missing=[...ids].filter(id=>!tasks.some(t=>t.id===id)&&!keep.has(id));if(missing.length)throw fail('TASK_NOT_FOUND','部分任务不存在，未删除任何任务',{taskIds:missing});}
 const selected=tasks.filter(t=>(!ids||ids.has(t.id))&&!keep.has(t.id)&&(!request.query||[t.id,t.name].join(' ').toLowerCase().includes(request.query.toLowerCase()))&&(!request.status||t.status===request.status)&&(cutoff===Infinity||Date.parse(t.updatedAt || t.finishedAt || t.createdAt)<cutoff)).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
 const active=selected.filter(t=>!TERMINAL.has(t.status));if(active.length)throw fail('TASK_ACTIVE','选中任务仍在运行或等待，请先 stop；本批未删除',{taskIds:active.map(t=>t.id)});
 if(!request.dryRun && selected.length>limit)throw fail('TASK_CLEANUP_LIMIT',`匹配 ${selected.length} 条，超过 limit=${limit}；请显式提高 limit`,{count:selected.length});
 return {selected,limit,overLimit:selected.length>limit};
}
function managedPath(dataDir,value){
 dataDir=path.resolve(dataDir);
 const p=path.resolve(value),root=roots.map(r=>path.join(dataDir,r)).find(r=>inside(p,r));
 if(!root)throw fail('TASK_ARTIFACT_UNSAFE','产物不在受管理目录内',{path:p});
 let at=p;while(at!==dataDir){if(fs.existsSync(at)&&fs.lstatSync(at).isSymbolicLink())throw fail('TASK_ARTIFACT_UNSAFE','产物路径不能经过符号链接',{path:at});at=path.dirname(at);}
 return p;
}
function artifactPaths(dataDir,task,{strict=false,onUnsafe=()=>{}}={}){
 const files=new Set();
 const add=value=>{if(typeof value!=='string'||!path.isAbsolute(value))return;let p;try{p=managedPath(dataDir,value);}catch(e){if(strict)throw e;onUnsafe(value);return;}const root=roots.map(r=>path.join(dataDir,r)).find(r=>inside(p,r));const isTree=!['workflow-report-details','report-packages'].includes(path.relative(dataDir,root));files.add(isTree?path.join(root,path.relative(root,p).split(path.sep)[0]):p);};
 add(task.reportDetailPath);add(task.reportPackagePath);add(task.reportPackage?.path);add(task.reportRoot);
 const walk=value=>{if(!value||typeof value!=='object')return;for(const [k,v]of Object.entries(value)){if(['path','runDir','directory','reportRoot'].includes(k)&&typeof v==='string')add(v);else if(typeof v==='object')walk(v);}};
 walk(task.taskLogs);walk(task.recordingSession);walk(task.threadStacks);for(const c of task.cases || [])walk(c.artifacts);
 return [...files].sort().filter((p,i,all)=>!all.some((other,j)=>j!==i&&inside(p,other)));
}
async function fileSize(p){try{const s=await fs.promises.lstat(p);if(s.isSymbolicLink())return 0;if(!s.isDirectory())return s.size;let n=0;for(const name of await fs.promises.readdir(p))n+=await fileSize(path.join(p,name));return n;}catch(e){if(e.code==='ENOENT')return 0;throw e;}}
async function loadDetail(dataDir,t,{strict=true}={}){const detail=t.reportDetailPath || (/^[a-zA-Z0-9_-]{1,200}$/.test(t.id)?path.join(dataDir,'workflow-report-details',t.id+'.json'):null);if(!detail)return t;try{const p=managedPath(dataDir,detail);const d=JSON.parse(await fs.promises.readFile(p,'utf8'));if(d.id!==t.id)throw fail('TASK_REPORT_MISMATCH','报告ID与索引不一致');return {...d,...t,reportDetailPath:p,cases:d.cases || t.cases};}catch(e){if(e.code==='ENOENT')return t;if(!strict)return {...t,detailWarning:e.message};throw e;}}
function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(tmp,file);}finally{fs.rmSync(tmp,{force:true});}}
function recoverCleanup(dataDir,state){
 const trash=path.join(dataDir,'.task-cleanup-trash');if(!fs.existsSync(trash))return;
  if(fs.lstatSync(trash).isSymbolicLink())throw fail('TASK_CLEANUP_JOURNAL_INVALID','清理暂存目录不能是符号链接');
 for(const name of fs.readdirSync(trash)){const dir=path.join(trash,name),journal=path.join(dir,'journal.json');if(!fs.existsSync(journal))continue;
  if(fs.lstatSync(dir).isSymbolicLink())throw fail('TASK_CLEANUP_JOURNAL_INVALID','清理事务目录不能是符号链接');
  const j=JSON.parse(fs.readFileSync(journal,'utf8'));if(!Array.isArray(j.ids)||!j.ids.length||!Array.isArray(j.moves))throw fail('TASK_CLEANUP_JOURNAL_INVALID','无效清理日志');const deleted=removedIds(state),committed=j.ids.every(id=>deleted.has(id));
  for(const [from,to]of j.moves){managedPath(dataDir,from);if(path.dirname(path.resolve(to))!==dir||!/^\d+$/.test(path.basename(to)))throw fail('TASK_CLEANUP_JOURNAL_INVALID','无效清理日志');if(!committed&&fs.existsSync(to)){if(fs.existsSync(from))throw fail('TASK_CLEANUP_RECOVERY_CONFLICT','产物恢复目标已存在',{path:from});fs.mkdirSync(path.dirname(from),{recursive:true});fs.renameSync(to,from);}}
  fs.rmSync(dir,{recursive:true,force:true});
 }
}
function createTaskCleanup({dataDir,readState,writeState,activeIds=()=>new Set(),flush=async()=>{},emit=()=>{}}){
 dataDir=path.resolve(dataDir);
 let queue=Promise.resolve();
 async function run(request){
  let state=readState() || {};recoverCleanup(dataDir,state);
  const initial=selectTasks(state.automationTasks || [],request);
  for(const t of initial.selected){if(activeIds().has(t.id))throw fail('TASK_ACTIVE','任务仍在执行，请先 stop',{taskIds:[t.id]});await flush(t.id);}
  state=readState() || {};const {selected,limit,overLimit}=selectTasks(state.automationTasks || [],request),ids=selected.map(t=>t.id),idSet=new Set(ids);
  const version=digest(state.automationTasks || []),entries=[];
  for(const t of selected){const unmanagedArtifacts=[],task=await loadDetail(dataDir,t,{strict:!!request.purgeArtifacts}),artifacts=artifactPaths(dataDir,task,{strict:!!request.purgeArtifacts,onUnsafe:p=>unmanagedArtifacts.push(p)});entries.push({id:t.id,name:t.name,status:t.status,updatedAt:t.updatedAt || t.finishedAt || t.createdAt,artifacts,unmanagedArtifacts,detailWarning:task.detailWarning,artifactBytes:(await Promise.all(artifacts.map(fileSize))).reduce((a,b)=>a+b,0)});}
  const paths=[...new Set(entries.flatMap(e=>e.artifacts))].sort().filter((p,i,all)=>!all.some((o,j)=>j!==i&&inside(p,o)));
  if(request.purgeArtifacts)for(const t of (state.automationTasks || []).filter(t=>!idSet.has(t.id))){const other=artifactPaths(dataDir,await loadDetail(dataDir,t));if(paths.some(p=>other.some(o=>p===o||inside(p,o)||inside(o,p))))throw fail('TASK_ARTIFACT_SHARED','产物被其他任务共享，本批未删除',{taskId:t.id});}
  const result={success:true,schemaVersion:'lenswiper.task-cleanup.v1',dryRun:!!request.dryRun,count:entries.length,tasks:entries,taskIds:ids,limit,overLimit,purgeArtifacts:!!request.purgeArtifacts,artifactBytes:(await Promise.all(paths.map(fileSize))).reduce((a,b)=>a+b,0)};
  if(request.dryRun || !ids.length)return result;
  let backupPath;
  if(request.backup){const backup=path.resolve(request.backup);fs.mkdirSync(backup,{recursive:true});const physical=fs.realpathSync(backup);if(paths.some(p=>{const real=fs.existsSync(p)?fs.realpathSync(p):p;return physical===real||inside(physical,real);}))throw fail('TASK_BACKUP_UNSAFE','备份目录不能位于待清理产物内');backupPath=path.join(backup,'task-cleanup-'+crypto.randomUUID()+'.json');atomic(backupPath,{schemaVersion:'lenswiper.task-cleanup-backup.v1',createdAt:new Date().toISOString(),entries:selected,reportSummaries:entries});}
  const current=readState() || {};if(digest(current.automationTasks || [])!==version)throw fail('TASK_CLEANUP_PLAN_CHANGED','清理过程中任务索引已变化，本次未删除，请重新执行');
  if(ids.some(id=>activeIds().has(id)))throw fail('TASK_ACTIVE','任务已开始执行，请先 stop');
  const dir=path.join(dataDir,'.task-cleanup-trash',crypto.randomUUID()),moves=request.purgeArtifacts?paths.filter(p=>fs.existsSync(p)).map((p,i)=>[p,path.join(dir,String(i))]):[];
  if(moves.length)atomic(path.join(dir,'journal.json'),{ids,moves});
  let committed=false;
  try{
   for(const [from,to]of moves){managedPath(dataDir,from);fs.renameSync(from,to);}
   const removedAt=new Date().toISOString();writeState(preserveRemovals({...current,automationTasks:(current.automationTasks || []).filter(t=>!idSet.has(t.id)),removedAutomationTasks:[...(current.removedAutomationTasks || []),...ids.map(id=>({id,removedAt,purgeArtifacts:!!request.purgeArtifacts}))]},current));committed=true;
  }catch(e){
   committed=ids.every(id=>removedIds(readState() || {}).has(id));
   if(committed){emit({removedTaskIds:ids,updatedAt:new Date().toISOString()});throw fail('TASK_CLEANUP_COMMIT_ACK_FAILED','索引已移除，但后续持久化失败；请核对回执，不要重复删除。暂存产物将在恢复时处理',{removedTaskIds:ids,backupPath,purgePending:!!moves.length});}
   for(const [from,to]of [...moves].reverse())if(fs.existsSync(to))fs.renameSync(to,from);throw e;
  }
  const purgeErrors=[];if(moves.length)try{fs.rmSync(dir,{recursive:true,force:true});}catch(e){purgeErrors.push({path:dir,error:e.message});}
  emit({removedTaskIds:ids,updatedAt:new Date().toISOString()});
  return {...result,removedTaskIds:ids,backupPath,purgeErrors,purgeComplete:!purgeErrors.length};
 }
 return request=>{const pending=queue.then(()=>run(request));queue=pending.catch(()=>{});return pending.catch(e=>({success:false,errorCode:e.code || 'TASK_CLEANUP_FAILED',error:e.message,...e.details}));};
}
module.exports={createTaskCleanup,selectTasks,preserveRemovals,removedIds,artifactPaths,recoverCleanup};
