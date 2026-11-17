const fs=require('node:fs/promises');
const path=require('node:path');
const {constants}=require('node:fs');
const {resolveReportCase}=require('./report-case-identity');
const {promisify}=require('node:util');
const execFile=promisify(require('node:child_process').execFile);
const previews=new Map();
async function recordingPreview(filename,version,previewAtMs=0){
 const key=filename+'\0'+version+'\0'+previewAtMs;if(previews.has(key))return previews.get(key);
 const work=(async()=>{let packaged=false;try{packaged=!!require('electron').app?.isPackaged;}catch{}const runtime=require('../media-runtime').resolveMediaRuntime({isPackaged:packaged});if(!runtime.ffmpeg)throw Error('RECORDING_PREVIEW_RUNTIME_UNAVAILABLE');
 const {stdout}=await execFile(runtime.ffmpeg,['-v','error','-nostdin','-protocol_whitelist','file,pipe','-ss',String(previewAtMs/1000),'-i',filename,'-frames:v','1','-vf','scale=640:-2','-f','image2pipe','-c:v','mjpeg','pipe:1'],{encoding:'buffer',maxBuffer:524288,timeout:8000,windowsHide:true});if(!stdout.length)throw Error('RECORDING_PREVIEW_EMPTY');return stdout;})();
 previews.set(key,work);while(previews.size>50)previews.delete(previews.keys().next().value);work.catch(()=>{if(previews.get(key)===work)previews.delete(key);});return work;
}
// A report reference is the only selector. Never accept caller-supplied paths.
async function readCaseArtifact(task,args){
 if(task.id!==args.taskId)throw Error("CASE_ARTIFACT_TASK_MISMATCH");
 const {caseRecord,identity}=resolveReportCase(task,args);
 if(!['recordings','screenshots'].includes(args.artifactKind))throw Error('Unsupported case artifact kind');
 const index=args.artifactIndex??0,artifact=caseRecord.artifacts?.[args.artifactKind]?.[index];
 if(!artifact || artifact.success===false)throw Error(artifact?.errorCode || 'CASE_ARTIFACT_UNAVAILABLE');
 if(artifact.lifecycleScope==='task' || artifact.caseId && artifact.caseId!==identity.caseId)throw Error('CASE_RECORDING_CLIP_UNAVAILABLE');
 const filename=artifact.path || artifact.outputPath || artifact.filePath;
 if(!filename || !path.isAbsolute(filename))throw Error('CASE_ARTIFACT_FILE_MISSING');
 const ext=path.extname(filename).toLowerCase(),mime={'.mp4':'video/mp4','.webm':'video/webm','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg'}[ext];
 if(!mime || args.artifactKind==='recordings'&&!mime.startsWith('video/') || args.artifactKind==='screenshots'&&!mime.startsWith('image/'))throw Error('CASE_ARTIFACT_FORMAT_UNSUPPORTED');
 const previewAtMs=args.previewAtMs??0;
 if(!Number.isSafeInteger(previewAtMs)||previewAtMs<0||previewAtMs>3600000||args.previewAtMs!==undefined&&!args.preview)throw Error('CASE_PREVIEW_TIME_INVALID');
 const offset=args.offset??0,length=args.length??262144;
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<1||length>524288)throw Error('Invalid artifact byte range');
 let handle=await fs.open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW || 0));
 try{const stat=await handle.stat();if(!stat.isFile()||stat.size>256*1024*1024||!args.playback&&offset>stat.size)throw Error('CASE_ARTIFACT_SIZE_INVALID');
 let version=`${stat.size}:${stat.mtimeMs}`;if(args.playback){if(args.artifactKind!=='recordings'||args.preview)throw Error('CASE_PLAYBACK_KIND_INVALID');const source=await require('./recording-playback').playbackSource(filename,version);await handle.close();handle=null;handle=await fs.open(source.path,constants.O_RDONLY|(constants.O_NOFOLLOW||0));const playable=await handle.stat();if(!playable.isFile()||playable.size>256*1024*1024||offset>playable.size)throw Error('CASE_ARTIFACT_SIZE_INVALID');stat.size=playable.size;version=source.version;}if(args.version && args.version!==version)throw Error('CASE_ARTIFACT_CHANGED');
 if(args.preview){if(args.artifactKind!=='recordings'||offset!==0)throw Error('CASE_PREVIEW_RANGE_INVALID');const bytes=await recordingPreview(filename,version,previewAtMs);return {success:true,identity:{taskId:identity.taskId,caseId:identity.caseId},artifactKind:args.artifactKind,artifactIndex:index,preview:true,previewAtMs,mime:'image/jpeg',size:bytes.length,version,offset:0,nextOffset:null,data:bytes.toString('base64')};}
 const bytes=Buffer.alloc(Math.min(length,stat.size-offset));const {bytesRead}=await handle.read(bytes,0,bytes.length,offset);
 return {success:true,identity:{taskId:identity.taskId,caseId:identity.caseId},artifactKind:args.artifactKind,artifactIndex:index,mime:args.playback?'video/mp4':mime,size:stat.size,version,offset,nextOffset:offset+bytesRead<stat.size?offset+bytesRead:null,data:bytes.subarray(0,bytesRead).toString('base64')};
 }finally{await handle?.close();}
}
module.exports={readCaseArtifact};
