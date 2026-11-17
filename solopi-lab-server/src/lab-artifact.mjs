import {createHash} from 'node:crypto';
import {mkdirSync,existsSync,statSync,openSync,writeSync,readSync,closeSync,fsyncSync,renameSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export class LabArtifacts{
 constructor(db,{root,task}){Object.assign(this,{db,root,task});}
 paths(id){if(!this.root)fail(503,'ARTIFACT_STORAGE_UNAVAILABLE','artifact storage not configured');if(!/^[a-f0-9]{64}$/.test(id))fail(422,'INVALID_ARTIFACT_ID','invalid artifactId');mkdirSync(this.root,{recursive:true,mode:0o700});return {part:join(this.root,id+'.part'),ready:join(this.root,id+'.media')};}
 begin(scope,clientId,input){
  const t=this.task(scope,input.taskId);if(t.clientId!==clientId)fail(403,'WRONG_CLIENT','artifact task belongs to another Client');
  if(!t.cases.some(c=>c.caseId===input.caseId)||!['phone','glasses'].includes(input.role)||!t.group.members.some(m=>m.role===input.role))fail(422,'ARTIFACT_BINDING_INVALID','artifact must belong to a selected case and group member');
  if(!/^[a-f0-9]{64}$/.test(input.sha256)||!Number.isSafeInteger(input.size)||input.size<1||input.size>256*1024*1024||!['video/mp4','video/webm'].includes(input.mime))fail(422,'ARTIFACT_INVALID','invalid recording');
  const id=digest(JSON.stringify([t.taskId,input.caseId,input.role,input.sha256])),paths=this.paths(id);
  const old=this.db.prepare('SELECT * FROM lab_artifact WHERE artifact_uid=?').get(id);
  if(old){if(old.size_bytes!==input.size||old.mime_type!==input.mime)fail(409,'ARTIFACT_CONFLICT','recording metadata changed');}
  else this.db.prepare('INSERT INTO lab_artifact(artifact_uid,task_uid,case_uid,role,content_sha,size_bytes,mime_type,state,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?)').run(id,t.taskId,input.caseId,input.role,input.sha256,input.size,input.mime,'uploading',Date.now());
  if(!existsSync(paths.part)&&!existsSync(paths.ready)){const fd=openSync(paths.part,'wx',0o600);closeSync(fd);}
  return this.status(scope,clientId,id);
 }
 owned(scope,id,clientId){const r=this.db.prepare('SELECT * FROM lab_artifact WHERE artifact_uid=?').get(id);if(!r)fail(404,'ARTIFACT_NOT_FOUND','recording not found');const t=this.task(scope,r.task_uid);if(clientId&&t.clientId!==clientId)fail(403,'WRONG_CLIENT','recording belongs to another Client');return r;}
 status(scope,clientId,id){const r=this.owned(scope,id,clientId),p=this.paths(id);return {artifactId:id,status:r.state,offset:existsSync(p.ready)?r.size_bytes:existsSync(p.part)?statSync(p.part).size:0,size:r.size_bytes,sha256:r.content_sha,url:r.state==='ready'?'/lab/artifacts/'+id:null};}
 chunk(scope,clientId,input){const r=this.owned(scope,input.artifactId,clientId),p=this.paths(input.artifactId);if(typeof input.data!=='string'||input.data.length>350000||!Number.isSafeInteger(input.offset)||input.offset<0)fail(422,'ARTIFACT_CHUNK_INVALID','invalid chunk');const bytes=Buffer.from(input.data,'base64');if(bytes.toString('base64')!==input.data||!bytes.length||input.offset+bytes.length>r.size_bytes)fail(422,'ARTIFACT_CHUNK_INVALID','invalid chunk bytes');
  const file=existsSync(p.ready)?p.ready:p.part,size=statSync(file).size;
  if(input.offset<size){if(input.offset+bytes.length>size)fail(409,'ARTIFACT_OFFSET_CONFLICT','chunk overlaps uploaded data');const fd=openSync(file,'r'),previous=Buffer.alloc(bytes.length);try{readSync(fd,previous,0,bytes.length,input.offset);}finally{closeSync(fd);}if(!previous.equals(bytes))fail(409,'ARTIFACT_CONTENT_CONFLICT','uploaded bytes differ');return this.status(scope,clientId,input.artifactId);}
  if(input.offset!==size||r.state==='ready')fail(409,'ARTIFACT_OFFSET_CONFLICT','continue from the recorded offset');
  const fd=openSync(p.part,'r+');try{let written=0;while(written<bytes.length)written+=writeSync(fd,bytes,written,bytes.length-written,input.offset+written);fsyncSync(fd);}finally{closeSync(fd);}
  return this.status(scope,clientId,input.artifactId);
 }
 finish(scope,clientId,id){const r=this.owned(scope,id,clientId),p=this.paths(id);if(r.state==='ready')return this.status(scope,clientId,id);const target=existsSync(p.ready)?p.ready:p.part;if(statSync(target).size!==r.size_bytes||digest(readFileSync(target))!==r.content_sha)fail(409,'ARTIFACT_INCOMPLETE','recording size or SHA256 mismatch');if(target===p.part)renameSync(p.part,p.ready);this.db.prepare("UPDATE lab_artifact SET state='ready' WHERE artifact_uid=?").run(id);return this.status(scope,clientId,id);}
 metadata(scope,id){const r=this.owned(scope,id),p=this.paths(id);if(r.state!=='ready'||!existsSync(p.ready))fail(404,'ARTIFACT_NOT_READY','recording not ready');return {artifactId:id,mime:r.mime_type,size:r.size_bytes,sha256:r.content_sha,file:p.ready,taskId:r.task_uid,caseId:r.case_uid,role:r.role};}
}
