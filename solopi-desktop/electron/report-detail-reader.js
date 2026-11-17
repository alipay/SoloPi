const fs=require('node:fs/promises');
// Shared by all report consumers. Entries follow the actual file version, not
// task status; a replacement or explicit refresh can never reuse stale data.
function createReportDetailReader({readFile=fs.readFile,stat=fs.stat,maxBytes=32*1024*1024,maxEntries=8}={}){
 const entries=new Map();let bytes=0;
 const remove=key=>{const old=entries.get(key);if(old){bytes-=old.size;entries.delete(key);}};
 return async(filename,project,{refresh=false}={})=>{
  const info=await stat(filename),version=[info.dev,info.ino,info.size,info.mtimeMs,info.ctimeMs].join(':');
  const old=entries.get(filename);if(!refresh&&old?.version===version)return old.promise;
  remove(filename);const entry={version,size:info.size,promise:null};
  entry.promise=readFile(filename,'utf8').then(JSON.parse).then(project);
  if(entry.size<=maxBytes){entries.set(filename,entry);bytes+=entry.size;while(bytes>maxBytes||entries.size>maxEntries)remove(entries.keys().next().value);}
  entry.promise.catch(()=>{if(entries.get(filename)===entry)remove(filename);});
  return entry.promise;
 };
}
module.exports={createReportDetailReader};
