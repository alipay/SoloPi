'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const hash=async file=>{const h=createHash('sha256');for await(const bytes of fs.createReadStream(file))h.update(bytes);return h.digest('hex');};
async function uploadRecordings(native,projection,{call,devices,signal}){
 for(const c of native.cases||[]){const report=projection.report.cases.find(r=>r.caseId===c.caseId);if(!report)continue;
  for(const [i,r] of (c.artifacts?.recordings||[]).entries()){
   const target=report.recordings[i],role=r.deviceType||r.role,serial=devices?.[role]?.serial;
   if(r.success===false||r.evidenceReady===false){target.error=r.error||'录屏未就绪';continue;}
   if(!serial||r.serial!==serial||!path.isAbsolute(r.path||'')||r.caseId&&r.caseId!==c.caseId){target.error='录屏归属不匹配';continue;}
   const mime=({'.mp4':'video/mp4','.webm':'video/webm'})[path.extname(r.path).toLowerCase()];if(!mime){target.error='该录屏格式暂不支持网页播放';continue;}
   let stat;try{stat=fs.statSync(r.path);}catch{target.error='录屏文件不存在';continue;}if(!stat.isFile()||stat.size<1){target.error='录屏文件为空';continue;}
   const sha256=await hash(r.path);signal?.throwIfAborted();
   let receipt=await call('POST','/v1/lab/artifact-begin',{input:{taskId:native.id,caseId:c.caseId,role,sha256,size:stat.size,mime}},signal);
   if(receipt.status!=='ready'){
    const fd=fs.openSync(r.path,'r');try{let offset=receipt.offset;const buffer=Buffer.alloc(256*1024);while(offset<stat.size){signal?.throwIfAborted();const length=fs.readSync(fd,buffer,0,Math.min(buffer.length,stat.size-offset),offset);if(!length)throw Error('RECORDING_CHANGED');receipt=await call('POST','/v1/lab/artifact-chunk',{input:{artifactId:receipt.artifactId,offset,data:buffer.subarray(0,length).toString('base64')}},signal);offset=receipt.offset;}}finally{fs.closeSync(fd);}
    const after=fs.statSync(r.path);if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw Error('RECORDING_CHANGED');
    receipt=await call('POST','/v1/lab/artifact-finish',{artifactId:receipt.artifactId},signal);
   }
   Object.assign(target,{available:true,url:receipt.url,sha256,sizeBytes:stat.size,artifactId:receipt.artifactId});
  }
 }
 return projection;
}
module.exports={uploadRecordings};
