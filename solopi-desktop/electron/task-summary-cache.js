const fs = require('node:fs/promises');
// Cache only immutable persisted summaries. Live tasks and external sources are
// merged by the caller on every request. Atomic replacement invalidates by inode.
function createTaskSummaryCache({ files, load, stat = fs.stat }) {
  let cached, pending;
  async function revision() {
    return JSON.stringify(await Promise.all(files().map(async file => {
      try { const s = await stat(file); return [file,s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs]; }
      catch(error) { if(error.code==='ENOENT')return [file,null]; throw error; }
    })));
  }
  return async function read() {
    const key=await revision();
    if(cached?.key===key)return cached.value;
    if(pending?.key===key)return pending.promise;
    const entry={key};
    entry.promise=(async()=>{
      const value=await load();
      // Never cache a value under a revision that changed during its load.
      if(await revision()===key)cached={key,value};
      return value;
    })().finally(()=>{if(pending===entry)pending=null;});
    pending=entry;return entry.promise;
  };
}
module.exports={createTaskSummaryCache};
// Parse the large workflow document outside Electron's main event loop. Return
// summaries only, so structured cloning never transports case histories.
function readTaskSummaries(files) {
  const {Worker}=require('node:worker_threads');
  return new Promise((resolve,reject)=>{
    const worker=new Worker(require('node:path').join(__dirname,'task-summary-worker.js'),{workerData:{files}});
    let settled=false;
    const finish=(error,value)=>{
      if(settled)return;settled=true;clearTimeout(timer);
      void worker.terminate();error ? reject(error) : resolve(value);
    };
    const timer=setTimeout(()=>finish(Error('任务摘要读取超时')),30000);
    worker.once('message',result=>finish(result.error ? Object.assign(Error(result.error.message),{code:result.error.code}) : null,result.tasks));
    worker.once('error',error=>finish(error));
    worker.once('exit',code=>{if(!settled)finish(Error(`任务摘要进程提前退出：${code}`));});
  });
}
module.exports.readTaskSummaries=readTaskSummaries;
