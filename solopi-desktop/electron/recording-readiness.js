const fs = require('node:fs');
function recordingSnapshot(file) {
  try {
    const stat=fs.statSync(file,{bigint:true});
    return stat.isFile() ? {size:stat.size,revision:`${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`} : null;
  } catch(error) { if(error.code==='ENOENT')return null;throw error; }
}
// Process stdout may be block-buffered. Actual new output is the readiness
// signal; merely staying alive or finding a stale recording is insufficient.
function watchRecordingOutput(file, previous, onReady, {intervalMs=100,onError=()=>{}}={}) {
  let timer=setInterval(()=>{
    try {
      const current=recordingSnapshot(file);
      if(current&&current.size>0n&&current.revision!==previous?.revision){close();onReady();}
    } catch(error){close();onError(error);}
  },intervalMs);
  function close(){clearInterval(timer);timer=null;}
  return close;
}
module.exports={recordingSnapshot,watchRecordingOutput};
