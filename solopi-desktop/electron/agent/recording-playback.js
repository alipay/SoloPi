const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createHash,randomUUID}=require('node:crypto');
const {promisify}=require('node:util'),execute=promisify(require('node:child_process').execFile);
function createPlaybackCache({root=path.join(os.tmpdir(),'glassbox-recording-playback'),execFile=execute,runtime=()=>{let isPackaged=false;try{isPackaged=!!require('electron').app?.isPackaged;}catch{}return require('../media-runtime').resolveMediaRuntime({isPackaged});}}={}){
 const jobs=new Map(),compatible=new Map();
 return async(filename,sourceVersion)=>{
  const key=createHash('sha256').update(JSON.stringify([filename,sourceVersion,'h264-aac-v1'])).digest('hex');
  if(compatible.has(key))return compatible.get(key);if(jobs.has(key))return jobs.get(key);
  const work=(async()=>{await fs.mkdir(root,{recursive:true,mode:0o700});const destination=path.join(root,key+'.mp4');
   try{const stat=await fs.lstat(destination);if(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<256*1024*1024)return {path:destination,version:'playback-v1:'+key};}catch(e){if(e.code!=='ENOENT')throw e;}
   const ffmpeg=runtime().ffmpeg;if(!ffmpeg)throw Error('RECORDING_PLAYBACK_RUNTIME_UNAVAILABLE');
   const probe=await execFile(ffmpeg,['-hide_banner','-nostdin','-i',filename,'-map','0:v:0','-t','0','-f','null','-'],{timeout:15000,maxBuffer:262144,windowsHide:true});
   if(path.extname(filename).toLowerCase()==='.mp4'&&/Stream #0:\d[^\n]*Video: h264[^\n]*yuv420p/.test(String(probe.stderr))&&(!/Audio:/.test(String(probe.stderr))||/Audio: aac/.test(String(probe.stderr)))){const source={path:filename,version:'playback-original-v1:'+key};compatible.set(key,source);while(compatible.size>64)compatible.delete(compatible.keys().next().value);return source;}
   const temp=path.join(root,key+'-'+randomUUID()+'.mp4');
   try{await execFile(ffmpeg,['-v','error','-nostdin','-n','-protocol_whitelist','file,pipe','-i',filename,'-map','0:v:0','-map','0:a:0?','-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2','-c:v','libx264','-preset','ultrafast','-crf','23','-pix_fmt','yuv420p','-threads','2','-c:a','aac','-b:a','128k','-movflags','+faststart','-fs','268435456',temp],{timeout:120000,maxBuffer:262144,windowsHide:true});
    const stat=await fs.stat(temp);if(!stat.size||stat.size>=256*1024*1024)throw Error('RECORDING_PLAYBACK_SIZE_INVALID');await fs.chmod(temp,0o600);await fs.rename(temp,destination);
    // Only this module's completed derivative files are eligible for bounded cleanup.
    const rows=await Promise.all((await fs.readdir(root)).filter(n=>/^[a-f0-9]{64}\.mp4$/.test(n)&&n!==key+'.mp4').map(async n=>{const file=path.join(root,n),s=await fs.lstat(file);return {file,size:s.size,at:s.mtimeMs,regular:s.isFile()&&!s.isSymbolicLink()};}));let bytes=stat.size+rows.reduce((n,r)=>n+r.size,0);for(const r of rows.sort((a,b)=>a.at-b.at)){if(bytes<=256*1024*1024)break;if(r.regular){await fs.unlink(r.file);bytes-=r.size;}}
    return {path:destination,version:'playback-v1:'+key};
   }finally{await fs.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  })();jobs.set(key,work);work.finally(()=>{if(jobs.get(key)===work)jobs.delete(key);}).catch(()=>{});return work;
 };
}
module.exports={createPlaybackCache,playbackSource:createPlaybackCache()};
