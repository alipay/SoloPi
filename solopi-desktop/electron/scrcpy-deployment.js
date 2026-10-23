const fs=require('node:fs');
const {createHash,randomUUID}=require('node:crypto');
const versions=new Map(),hashes=new Map();
function fingerprint(file){const s=fs.statSync(file,{bigint:true});return [fs.realpathSync(file),s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');}
function bounded(map,key,value){if(map.size>=16)map.delete(map.keys().next().value);map.set(key,value);return value;}
function abortable(promise,signal){
 if(!signal)return promise;signal.throwIfAborted();
 return new Promise((resolve,reject)=>{const abort=()=>{cleanup();reject(signal.reason);},cleanup=()=>signal.removeEventListener('abort',abort);signal.addEventListener('abort',abort,{once:true});promise.then(v=>{cleanup();resolve(v);},e=>{cleanup();reject(e);});});
}
async function scrcpyVersion(media,execute,options){
 const key=fingerprint(media.scrcpy);
 let entry=versions.get(key);
 if(!entry){
  entry={controller:new AbortController(),users:0,complete:false};const current=entry;
  entry.promise=Promise.resolve().then(()=>execute(media.scrcpy,['--version'],{...options,signal:current.controller.signal})).then(text=>{
   const version=String(text).match(/scrcpy\s+(\d+\.\d+(?:\.\d+)?)/)?.[1];if(!version)throw Error('无法确认 scrcpy server 协议版本');current.complete=true;return version;
  });
  bounded(versions,key,entry);entry.promise.catch(()=>{if(versions.get(key)===current)versions.delete(key);});
 }
 entry.users++;
 try{return await abortable(entry.promise,options.signal);}
 finally{if(--entry.users===0&&!entry.complete){entry.controller.abort();if(versions.get(key)===entry)versions.delete(key);}}
}
async function deployServer(media,adb,serial,execute,options){
 const key=fingerprint(media.scrcpyServer);let digest=hashes.get(key);
 if(!digest)digest=bounded(hashes,key,createHash('sha256').update(fs.readFileSync(media.scrcpyServer)).digest('hex'));
 const remote=`/data/local/tmp/solopi-desktop-preview-${digest}.jar`;
 // Fixed, content-addressed paths survive sessions. Validate actual device bytes,
 // not a host-side remembered success; device reboot/deletion/corruption is safe.
 const actual=String(await execute(adb,['-s',serial,'shell',`if [ -f ${remote} ]; then sha256sum ${remote}; fi`],options)).trim().split(/\s+/)[0];
 if(actual===digest)return {remote,uploaded:false};
 const temporary=`${remote}.${randomUUID()}.tmp`;
 try{await execute(adb,['-s',serial,'push',media.scrcpyServer,temporary],options);
  const uploaded=String(await execute(adb,['-s',serial,'shell','sha256sum',temporary],options)).trim().split(/\s+/)[0];
  if(uploaded!==digest)throw Error('scrcpy server 上传后摘要不一致');
  await execute(adb,['-s',serial,'shell','mv','-f',temporary,remote],options);
  return {remote,uploaded:true};
 }catch(e){await execute(adb,['-s',serial,'shell','rm','-f',temporary],{...options,signal:undefined,timeout:3000}).catch(()=>{});throw e;}
}
module.exports={scrcpyVersion,deployServer};
