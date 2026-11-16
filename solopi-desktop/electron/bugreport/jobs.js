const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {Worker}=require('node:worker_threads');
const {runManagedCommand}=require('../managed-command');
const busyStates=new Set(['collecting','parsing','saving']);
function validateInput(input) {
  if(!['upload','device'].includes(input.mode)) throw Error('请选择导入方式');
  if(input.mode==='device' && (typeof input.serial!=='string'||! /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(input.serial))) throw Error('请选择有效的Android设备');
}
function createBugreportJobs({directory,adbPath,onChange=()=>{},run=runManagedCommand,workerFactory=(data)=>new Worker(path.join(__dirname,'worker.js'),{workerData:data,resourceLimits:{maxOldGenerationSizeMb:768}})}) {
  const jobs=new Map(),uploads=new Map(),readers=new Set();
  let closing=false;
  const view=job=>({id:job.id,status:job.status,phase:job.phase,error:job.error||'',result:job.result||null,outputDirectory:job.outputDirectory,diagnostic:job.diagnostic||'',reportKey:path.basename(job.outputDirectory),sourcePath:job.sourcePath,createdAt:job.createdAt,sourceName:job.sourceName});
  function get(owner,id) {const job=jobs.get(id);if(!job||job.owner!==owner)throw Error('分析任务不存在');return view(job);}
  async function writeAtomic(file, text) {
    const temporary=`${file}.${randomUUID()}.tmp`;
    try { await fs.promises.writeFile(temporary,text,{mode:0o600});await fs.promises.rename(temporary,file); }
    finally { await fs.promises.rm(temporary,{force:true}); }
  }
  function save(job) {
    job.saveQueue=(job.saveQueue||Promise.resolve()).catch(()=>{}).then(()=>writeAtomic(path.join(job.outputDirectory,'status.json'),JSON.stringify({id:job.id,status:job.status,phase:job.phase,error:job.error||'',createdAt:job.createdAt,sourcePath:job.sourcePath,sourceName:job.sourceName},null,2)));
    return job.saveQueue.then(() => { try { onChange(view(job)); } catch (_) {} });
  }
  async function cancel(owner,id) {
    const job=jobs.get(id);if(!job||job.owner!==owner)throw Error('分析任务不存在');
    if(!busyStates.has(job.status))return view(job);
    job.status='cancelled';job.phase='已取消';job.cancelCommand?.();job.rejectWorker?.(Error('已取消'));await job.worker?.terminate();await save(job);return view(job);
  }
  async function execute(job,input,file) {
    try {
      if(job.status==='cancelled')return;
      if(input.mode==='upload') {
        const size=(await fs.promises.stat(file)).size;
        if(size>(path.extname(file).toLowerCase()==='.zip'?512:256)*1024**2)throw Error('日志文件超过大小限制');
        await fs.promises.copyFile(file,job.sourcePath,fs.constants.COPYFILE_EXCL);
        file=job.sourcePath;
      }
      if(job.status==='cancelled')return;
      if(input.mode==='device') {
        job.phase='正在采集 Bugreport（通常需要数分钟）';
        let oversized=false;
        const monitor=setInterval(()=>{try{if(fs.statSync(file).size>512*1024**2){oversized=true;job.cancelCommand?.();}}catch(_){}},1000);
        try { await run(adbPath(),['-s',input.serial,'bugreport',file],{timeout:10*60*1000,maxBuffer:2*1024**2},cancel=>{job.cancelCommand=cancel;return()=>{job.cancelCommand=null;};}); }
        catch(error){if(oversized)throw Error('采集ZIP超过512 MiB限制，已停止本机采集');throw error;}
        finally{clearInterval(monitor);}
      }
      if(job.status==='cancelled')return;
      job.status='parsing';job.phase='校验并解析报告';await save(job);
      if(job.status==='cancelled')return;
      const result=await new Promise((resolve,reject)=>{
        const worker=workerFactory({file});job.worker=worker;
        const timer=setTimeout(()=>{void worker.terminate();reject(Error('解析超时（120秒）'));},120000);
        const finish=(error,result)=>{clearTimeout(timer);job.rejectWorker=null;error?reject(error):resolve(result);};
        job.rejectWorker=error=>finish(error);
        worker.on('message',message=>{if(message.phase)job.phase=message.phase; if(message.error)finish(Error(message.error));if(message.result)finish(null,message.result);});
        worker.on('error',error=>finish(error));worker.on('exit',code=>{if(code!==0)finish(Error(`解析进程退出：${code}`));});
      });
      if(job.status==='cancelled')return;
      job.status='saving';job.phase='保存本地分析结果';
      await writeAtomic(path.join(job.outputDirectory,'analysis.json'),JSON.stringify(result));
      if(job.status==='cancelled')return;
      await writeAtomic(path.join(job.outputDirectory,'report.json'),JSON.stringify({version:1,id:job.id,createdAt:job.createdAt,sourceName:job.sourceName,sourceFile:path.basename(job.sourcePath),mode:input.mode,serial:input.serial||''}));
      if(job.status==='cancelled'){await fs.promises.rm(path.join(job.outputDirectory,'report.json'),{force:true});return;}
      job.result=result;job.status='completed';job.phase='分析完成';await save(job);
    } catch(error) {
      await fs.promises.rm(path.join(job.outputDirectory,'report.json'),{force:true}).catch(()=>{});
      if(job.status!=='cancelled') {job.status='failed';job.phase='分析失败';job.error=error.message;job.diagnostic=String(error.stderr||error.stdout||'').slice(-6000);await save(job).catch(()=>{});}
    } finally {job.cancelCommand=null;job.rejectWorker=null;await job.worker?.terminate();job.worker=null;}
  }
  async function reportFiles(key) {
    if(typeof key!=='string'||!/^analysis-[A-Za-z0-9_-]+$/.test(key))throw Error('无效报告ID');
    const folder=path.join(directory(),key);
    if(!(await fs.promises.lstat(folder)).isDirectory())throw Error('报告目录无效');
    async function safeFile(name,limit) {
      const file=path.join(folder,name),stat=await fs.promises.lstat(file);
      if(!stat.isFile()||stat.size>limit)throw Error('报告文件无效或超过大小限制');return file;
    }
    const metadata=JSON.parse(await fs.promises.readFile(await safeFile('report.json',65536),'utf8'));
    if(metadata.version!==1||!['source.zip','source.txt','source.log','bugreport.zip'].includes(metadata.sourceFile)||typeof metadata.createdAt!=='string')throw Error('报告元数据无效');
    return {folder,metadata,safeFile};
  }
  async function listReports() {
    let entries;try{entries=await fs.promises.readdir(directory(),{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return {reports:[],errors:[]};throw e;}
    const reports=[],errors=[];
    for(const entry of entries){
      if(!entry.isDirectory()||!entry.name.startsWith('analysis-'))continue;
      try{const {metadata,folder}=await reportFiles(entry.name);reports.push({key:entry.name,...metadata,sourcePath:path.join(folder,metadata.sourceFile)});}
      catch(e){if(e.code!=='ENOENT')errors.push(`${entry.name}: ${e.message}`);}
    }
    return {reports:reports.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),errors};
  }
  async function openReport(key,owner) {
    if(closing)throw Error('应用正在退出');
    const reader={owner,cancelled:false,cancel(){this.cancelled=true;this.reject?.(Error('已取消'));return this.worker?.terminate();}};
    readers.add(reader);
    try {
      const {metadata,folder,safeFile}=await reportFiles(key);
      const file=await safeFile(metadata.sourceFile,512*1024**2);
      if(reader.cancelled||closing)throw Error('已取消');
      // Reparse the retained source with the current parser; cached fields can be stale.
      const result=await new Promise((resolve,reject)=>{
        const worker=workerFactory({file});reader.worker=worker;
        const timer=setTimeout(()=>finish(Error('解析超时（120秒）')),120000);
        let settled=false;
        const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(result);};
        reader.reject=error=>finish(error);
        worker.on('message',message=>{if(message.error)finish(Error(message.error));else if(message.result)finish(null,message.result);});
        worker.on('error',error=>finish(error));
        worker.on('exit',code=>finish(Error(`解析进程退出：${code}`)));
      });
      if(reader.cancelled)throw Error('已取消');
      const existing=jobs.get(metadata.id);if(existing&&existing.owner===owner)existing.result=result;
      return {reportKey:key,id:metadata.id,status:'completed',phase:'已打开历史报告',result,outputDirectory:folder,sourcePath:file,sourceName:metadata.sourceName,createdAt:metadata.createdAt};
    } finally {await reader.worker?.terminate();readers.delete(reader);}
  }
  async function sourceForReport(key) {const {metadata,safeFile}=await reportFiles(key);return safeFile(metadata.sourceFile,512*1024**2);}
  return {
    registerUpload(owner,file) {if(!fs.statSync(file).isFile()||!['.zip','.txt','.log'].includes(path.extname(file).toLowerCase()))throw Error('请选择ZIP、TXT或LOG文件');const token=randomUUID();uploads.set(token,{owner,file});return{token,name:path.basename(file)};},
    start(owner,input) {
      validateInput(input);if(closing)throw Error('应用正在退出');
      if([...jobs.values()].some(j=>j.owner===owner&&busyStates.has(j.status)))throw Error('已有分析正在执行，请等待或取消');
      let file;
      if(input.mode==='upload') {const upload=uploads.get(input.token);if(!upload||upload.owner!==owner)throw Error('请先选择日志文件');file=upload.file;}
      fs.mkdirSync(directory(),{recursive:true});const outputDirectory=fs.mkdtempSync(path.join(directory(),'analysis-'));
      const job={id:randomUUID(),owner,createdAt:new Date().toISOString(),sourceName:file?path.basename(file):'bugreport.zip',sourcePath:path.join(outputDirectory,file?`source${path.extname(file).toLowerCase()}`:'bugreport.zip'),status:input.mode==='device'?'collecting':'parsing',phase:'准备分析',outputDirectory};jobs.set(job.id,job);
      // Release completed in-memory results from this window; files remain available locally.
      for(const [id,old] of jobs) if(id!==job.id&&old.owner===owner&&!busyStates.has(old.status))jobs.delete(id);
      void save(job).catch(()=>{});
      setImmediate(()=>void execute(job,input,file||path.join(outputDirectory,'bugreport.zip')));
      return view(job);
    },get,cancel,listReports,openReport,sourceForReport,
    async flush(owner,id) { const job=jobs.get(id);if(!job||job.owner!==owner)throw Error('分析任务不存在');await job.saveQueue; },
    hasActive() { return readers.size > 0 || [...jobs.values()].some(j => busyStates.has(j.status)); },
    current(owner) {const owned=[...jobs.values()].filter(job=>job.owner===owner);return owned.length?view(owned[owned.length-1]):null;},
    async cancelOwner(owner) { await Promise.allSettled([...readers].filter(r=>r.owner===owner).map(r=>r.cancel())); await Promise.allSettled([...jobs.values()].filter(j=>j.owner===owner&&busyStates.has(j.status)).map(j=>cancel(owner,j.id))); for(const [token,item] of uploads)if(item.owner===owner)uploads.delete(token); },
    async stopAll() {closing=true;await Promise.allSettled([...readers].map(r=>r.cancel()));await Promise.allSettled([...jobs.values()].filter(j=>busyStates.has(j.status)).map(j=>cancel(j.owner,j.id)));},
  };
}
module.exports={createBugreportJobs,validateInput};
