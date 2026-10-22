const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const TERMINAL = new Set(['success','failed','stopped','completed','cancelled','interrupted']);
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const INTERVAL_MS = 24 * 60 * 60 * 1000;
const tempRoot = () => path.join(os.tmpdir(), 'solopi-desktop-development');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const real = dir => fs.existsSync(dir) ? fs.realpathSync(dir) : path.resolve(dir);
function workspace(dir) {
  try { const m=read(path.join(dir,'dev-workspace.json'));return m.schemaVersion==='lenswiper.dev-workspace.v1' && m.mode==='development' && real(m.dataDir)===real(dir) && real(m.sourceDataDir)!==real(dir) ? m : null; } catch { return null; }
}
function provenance(dataDir) {const m=workspace(dataDir);return m?{mode:'development',commit:m.commit,sourceSha256:m.sourceSha256,caseSourceRevision:m.caseSourceRevision}:undefined;}
function isDevelopmentTask(task) { return task?.executionProvenance?.mode==='development'; }
function visibleTasks(tasks, dataDir) { return workspace(dataDir) ? [] : tasks.filter(t=>!isDevelopmentTask(t)); }
function registerWorkspace(dataDir, ownerDir) {
  const m=workspace(dataDir);if(!m || real(m.sourceDataDir)!==real(ownerDir))return false;
  const dir=path.join(ownerDir,'development-workspaces');fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const file=path.join(dir,crypto.createHash('sha256').update(real(dataDir)).digest('hex')+'.json');
  const tmp=file+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(tmp,JSON.stringify({dataDir:real(dataDir),schemaVersion:m.schemaVersion}),{mode:0o600});fs.renameSync(tmp,file);return true;
}
function claimWorkspace(dataDir) {
  if(!workspace(dataDir))return;
  fs.writeFileSync(path.join(dataDir,'dev-workspace-owner.json'),JSON.stringify({pid:process.pid}),{mode:0o600});
}
function pidAlive(pid) { if(!Number.isSafeInteger(pid)||pid<1)return false;try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';} }
function latestTime(task) { return Date.parse(task.finishedAt || task.updatedAt || task.createdAt || ''); }
async function sweep({signal, ownerDir, listLegacy=()=>[], cleanLegacy, now=Date.now(), retentionMs=RETENTION_MS, root=tempRoot(), alive=pidAlive}) {
  const result={removedWorkspaces:[],removedTaskIds:[],skipped:[],errors:[]};
  // Old development records are purged through their owning Broker, never by
  // rewriting another application's task index or recursively deleting its root.
  const groups=new Map(),registry=path.join(ownerDir,'development-workspaces');
  const candidates=[...await listLegacy()];
  if(fs.existsSync(registry))for(const name of fs.readdirSync(registry).filter(n=>/^[a-f0-9]{64}\.json$/.test(n))){
    try{const {dataDir}=read(path.join(registry,name)),m=workspace(dataDir);if(m && real(m.sourceDataDir)===real(ownerDir))for(const task of read(path.join(dataDir,'workflow-editor-state.json')).automationTasks || [])candidates.push({...task,externalSource:{dataDir}});}catch(e){if(e.code!=='ENOENT')result.errors.push({error:e.message});}
  }
  for(const task of candidates)if(isDevelopmentTask(task) && TERMINAL.has(task.status) && Number.isFinite(latestTime(task)) && latestTime(task)<=now-retentionMs && task.externalSource?.dataDir){
    const dir=real(task.externalSource.dataDir),group=groups.get(dir)||[];if(!group.some(t=>t.id===task.id))group.push({...task,externalSource:{...task.externalSource,dataDir:dir}});groups.set(dir,group);
  }
  if(cleanLegacy)for(const cached of groups.values()){
    if(signal?.aborted)return result;
    // Visibility records are only a cache. Never launch an Electron Broker for
    // a missing source/task; recheck eligibility against the owner's index.
    const dataDir=cached[0].externalSource.dataDir;
    let state;
    try{state=read(path.join(dataDir,'workflow-editor-state.json'));}
    catch(e){if(e.code==='ENOENT')result.skipped.push(dataDir);else result.errors.push({dataDir,error:e.message});continue;}
    if(!Array.isArray(state.automationTasks)){result.errors.push({dataDir,error:'Invalid development task source index'});continue;}
    const ids=new Set(cached.map(t=>t.id));
    const tasks=state.automationTasks.filter(t=>ids.has(t.id) && isDevelopmentTask(t) && TERMINAL.has(t.status) && Number.isFinite(latestTime(t)) && latestTime(t)<=now-retentionMs).map(t=>({...t,externalSource:{dataDir}}));
    if(!tasks.length){result.skipped.push(dataDir);continue;}
    try{const r=await cleanLegacy(tasks,{taskIds:tasks.map(t=>t.id),purgeArtifacts:true,limit:tasks.length},signal);if(r?.success){result.removedTaskIds.push(...(r.removedTaskIds||[]));if(r.purgeErrors?.length)result.errors.push({dataDir:tasks[0].externalSource.dataDir,error:'部分开发产物未能释放，所属Broker保留清理记录'});}else result.errors.push({dataDir:tasks[0].externalSource.dataDir,error:r?.error || 'Development cleanup failed'});}catch(e){result.errors.push({error:e.message});}
  }
  if(!fs.existsSync(registry))return result;
  for(const name of fs.readdirSync(registry).filter(n=>/^[a-f0-9]{64}\.json$/.test(n))){
    if(signal?.aborted)return result;
    const entry=path.join(registry,name);
    try{
      const {dataDir}=read(entry);if(!fs.existsSync(dataDir)){fs.unlinkSync(entry);continue;}
      const m=workspace(dataDir),resolved=real(dataDir),base=real(root);
      // Only our dedicated temporary root is eligible for whole-directory expiry.
      if(!m || real(m.sourceDataDir)!==real(ownerDir) || path.dirname(resolved)!==base || fs.lstatSync(dataDir).isSymbolicLink()){result.skipped.push(dataDir);continue;}
      const state=read(path.join(dataDir,'workflow-editor-state.json')),tasks=state.automationTasks || [];
      let ownerPid=m.ownerPid;try{ownerPid=read(path.join(dataDir,'dev-workspace-owner.json')).pid;}catch(e){if(e.code!=='ENOENT')throw e;}
      if(tasks.some(t=>!TERMINAL.has(t.status) || !isDevelopmentTask(t)) || alive(ownerPid)){result.skipped.push(dataDir);continue;}
      const times=[Date.parse(m.preparedAt),...tasks.map(latestTime)];
      if(times.some(t=>!Number.isFinite(t)) || Math.max(...times)>now-retentionMs){result.skipped.push(dataDir);continue;}
      fs.rmSync(dataDir,{recursive:true});fs.unlinkSync(entry);result.removedWorkspaces.push(dataDir);
    }catch(e){result.errors.push({entry,error:e.message});}
  }
  return result;
}
function startRetention(options) {
  let stopped=false,running=false;const controller=new AbortController();
  const run=async()=>{if(stopped||running)return;running=true;try{const r=await sweep({...options,signal:controller.signal});options.onResult?.(r);}catch(e){options.onError?.(e);}finally{running=false;}};
  const timer=setInterval(run,INTERVAL_MS);timer.unref?.();void run();
  return ()=>{stopped=true;controller.abort();clearInterval(timer);};
}
module.exports={RETENTION_MS,INTERVAL_MS,tempRoot,workspace,provenance,claimWorkspace,isDevelopmentTask,visibleTasks,registerWorkspace,sweep,startRetention};
