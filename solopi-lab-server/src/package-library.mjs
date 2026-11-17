// Persistent fixed-project package distribution. No extraction, execution, or device installation.
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readdir,readFile,writeFile,rename,stat,open,unlink} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {join} from 'node:path';
import {recordDiagnostic} from './diagnostics.mjs';
const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=(status,code,message)=>{throw Object.assign(Error(message),{status,code})};
const text=(v,max)=>typeof v==='string'&&v.trim()&&v.length<=max&&!/[\x00-\x1f]/.test(v);
export class PackageLibrary{
 constructor({directory,scope,maxFileBytes=4*1024**3,maxTotalBytes=20*1024**3,maxChunkBytes=8*1024**2}){this.directory=join(directory,createHash('sha256').update(JSON.stringify([scope.orgId,scope.projectId])).digest('hex'));Object.assign(this,{maxFileBytes,maxTotalBytes,maxChunkBytes});this.locks=new Set();}
 file(id,suffix){if(!idPattern.test(id))fail(404,'PACKAGE_NOT_FOUND','安装包不存在');return join(this.directory,id+suffix)}
 async metadata(id){try{return JSON.parse(await readFile(this.file(id,'.json'),'utf8'))}catch(e){if(e.code==='ENOENT')fail(404,'PACKAGE_NOT_FOUND','安装包不存在');throw e}}
 async save(m){const file=this.file(m.id,'.json'),temp=file+'.'+randomUUID();await writeFile(temp,JSON.stringify(m),{mode:0o600});await rename(temp,file)}
 async exclusive(id,fn){if(this.locks.has(id))fail(409,'UPLOAD_BUSY','上传正在处理，请稍后重试');this.locks.add(id);try{return await fn()}finally{this.locks.delete(id)}}
 async entries(){await mkdir(this.directory,{recursive:true,mode:0o700});const result=[];for(const name of await readdir(this.directory)){if(!/^[a-f0-9-]{36}\.json$/.test(name))continue;result.push(await this.metadata(name.slice(0,-5)))}return result}
 public(m){return {id:m.id,kind:m.kind,version:m.version,platform:m.platform,name:m.name,size:m.size,notes:m.notes,createdAt:m.createdAt,sha256:m.sha256,downloadUrl:'/packages/files/'+m.id}}
 async list(){return {items:(await this.entries()).filter(x=>x.status==='ready').sort((a,b)=>b.createdAt-a.createdAt).map(m=>this.public(m)),maxFileBytes:this.maxFileBytes,maxChunkBytes:this.maxChunkBytes}}
 async create(input){
  if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['requestId','kind','version','platform','name','size','notes'].includes(k)))fail(422,'INVALID_PACKAGE','上传信息不完整');
  const {requestId:id,kind,version,platform,name,size}=input;
  if(!idPattern.test(id)||!['phone','glasses','desktop'].includes(kind)||!text(version,100)||!text(name,240)||/[\\/]/.test(name)||!['android','harmony','macos-arm64','macos-x64','linux-x64','linux-arm64','windows-x64','other'].includes(platform)||!Number.isSafeInteger(size)||size<=0||size>this.maxFileBytes||typeof(input.notes??'')!=='string'||(input.notes||'').length>2000)fail(422,'INVALID_PACKAGE','请检查类型、版本、平台和文件（最大4 GiB）');
  if(kind!=='desktop'&&!/\.(apk|hap|app)$/i.test(name)||kind==='desktop'&&!/\.(dmg|zip|exe|msi|deb|rpm|appimage|tar\.gz)$/i.test(name))fail(422,'INVALID_PACKAGE_TYPE','请选择相应平台的安装包文件');
  // Reservation lock covers every upload, so concurrent creates cannot exceed quota.
  return this.exclusive('create',async()=>{
   const all=await this.entries();const old=all.find(m=>m.id===id);const identity={kind,version:version.trim(),platform,name,size,notes:input.notes||''};
   if(old){if(Object.keys(identity).some(k=>identity[k]!==old[k]))fail(409,'UPLOAD_CONFLICT','同一上传标识不能用于其他文件');return this.exclusive(id,()=>this.uploadStatus(old))}
   for(const m of all.filter(x=>x.status==='uploading'&&Date.now()-x.createdAt>86400000&&!this.locks.has(x.id))){await unlink(this.file(m.id,'.part')).catch(e=>{if(e.code!=='ENOENT')throw e});await unlink(this.file(m.id,'.json'));all.splice(all.indexOf(m),1)}
   if(all.filter(x=>x.status==='uploading').length>=10||all.reduce((n,m)=>n+m.size,0)+size>this.maxTotalBytes)fail(507,'PACKAGE_STORAGE_FULL','安装包存储空间或并发上传已达上限，请联系管理员清理');
   const m={id,...identity,status:'uploading',createdAt:Date.now()};const f=await open(this.file(id,'.part'),'wx',0o600);await f.close();await this.save(m);recordDiagnostic({event:'package.upload.created',requestId:id,sizeBytes:size});return this.uploadStatus(m);
  })
 }
 async uploadStatus(m){return {id:m.id,status:m.status,offset:m.status==='ready'?m.size:(await stat(this.file(m.id,'.part'))).size,maxChunkBytes:this.maxChunkBytes,...(m.status==='ready'?{item:this.public(m)}:{})}}
 async status(id){return this.exclusive(id,async()=>this.uploadStatus(await this.metadata(id)))}
 async chunk(id,offset,source){return this.exclusive(id,async()=>{
  const m=await this.metadata(id);if(m.status!=='uploading')fail(409,'UPLOAD_FINISHED','文件已经上传完成');const file=this.file(id,'.part'),before=(await stat(file)).size;
  if(!Number.isSafeInteger(offset)||offset!==before)fail(409,'UPLOAD_OFFSET_MISMATCH','上传进度不一致，请读取进度后重试');
  let size=0;const f=await open(file,'r+');try{for await(const chunk of source){size+=chunk.length;if(size>this.maxChunkBytes||before+size>m.size)fail(413,'CHUNK_TOO_LARGE','上传块超过限制');let written=0;while(written<chunk.length){const r=await f.write(chunk,written,chunk.length-written,before+size-chunk.length+written);if(r.bytesWritten<=0)throw Error('write incomplete');written+=r.bytesWritten}}if(size===0)fail(422,'EMPTY_CHUNK','上传内容为空');await f.sync()}catch(e){await f.truncate(before);throw e}finally{await f.close()}
  return {id,offset:before+size};
 })}
 async commit(id){return this.exclusive(id,async()=>{
  const m=await this.metadata(id);if(m.status==='ready')return this.public(m);
  let file=this.file(id,'.part');try{await stat(file)}catch(e){if(e.code!=='ENOENT')throw e;file=this.file(id,'.bin')}
  if((await stat(file)).size!==m.size)fail(409,'UPLOAD_INCOMPLETE','文件尚未上传完整，可以继续上传');
  const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);m.sha256=hash.digest('hex');if(file.endsWith('.part'))await rename(file,this.file(id,'.bin'));m.status='ready';await this.save(m);recordDiagnostic({event:'package.upload.completed',requestId:id,sizeBytes:m.size});return this.public(m);
 })}
 async download(id){const m=await this.metadata(id);if(m.status!=='ready')fail(404,'PACKAGE_NOT_FOUND','安装包尚未上传完成');return {...this.public(m),file:this.file(id,'.bin')}}
}
export function createPackageHandler({directory,scope,originOk,...limits}){
 const store=new PackageLibrary({directory,scope,...limits});
 const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value))};
 const body=async req=>{let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>8192)fail(413,'BODY_TOO_LARGE','上传信息过长');chunks.push(c)}try{return JSON.parse(Buffer.concat(chunks).toString())}catch{fail(400,'INVALID_JSON','上传信息不是有效 JSON')}};
 return async(req,res,url)=>{
  if(!url.pathname.startsWith('/packages'))return false;
  try{
   if(!['GET','HEAD'].includes(req.method)&&!originOk(req))fail(403,'CROSS_ORIGIN','请从实验室网站上传');
   if(url.pathname==='/packages'&&req.method==='GET'&&!url.search){json(res,200,await store.list());return true}
   if(url.pathname==='/packages/uploads'&&req.method==='POST'&&!url.search){json(res,200,await store.create(await body(req)));return true}
   const upload=/^\/packages\/uploads\/([a-f0-9-]{36})(\/complete)?$/.exec(url.pathname);
   if(upload){
    const id=upload[1];if(req.method==='GET'&&!upload[2]&&!url.search)json(res,200,await store.status(id));
    else if(req.method==='PUT'&&!upload[2]&&[...url.searchParams.keys()].length===1&&url.searchParams.has('offset'))json(res,200,await store.chunk(id,Number(url.searchParams.get('offset')),req));
    else if(req.method==='POST'&&upload[2]&&!url.search)json(res,200,await store.commit(id));else fail(405,'METHOD_NOT_ALLOWED','不支持此上传操作');return true;
   }
   const download=/^\/packages\/files\/([a-f0-9-]{36})$/.exec(url.pathname);
   if(download&&['GET','HEAD'].includes(req.method)&&!url.search){
    const m=await store.download(download[1]);let start=0,end=m.size-1,status=200;
    if(req.headers.range){const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!match||!match[1]&&!match[2])fail(416,'INVALID_RANGE','下载范围无效');start=match[1]?Number(match[1]):Math.max(0,m.size-Number(match[2]));end=match[1]&&match[2]?Math.min(end,Number(match[2])):end;status=206;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=m.size)fail(416,'INVALID_RANGE','下载范围无效')}
    res.writeHead(status,{'Content-Type':'application/octet-stream','X-Content-Type-Options':'nosniff','Content-Disposition':"attachment; filename=package; filename*=UTF-8''"+encodeURIComponent(m.name),'Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'private, max-age=3600','ETag':'"'+m.sha256+'"',...(status===206?{'Content-Range':`bytes ${start}-${end}/${m.size}`}:{})});
    if(req.method==='HEAD')res.end();else{const stream=createReadStream(m.file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res)}return true;
   }
   fail(404,'NOT_FOUND','安装包接口不存在');
  }catch(e){recordDiagnostic({event:'package.request.failed',code:e.code||'PACKAGE_FAILED'});if(!res.headersSent)json(res,e.status||500,{error:{code:e.code||'PACKAGE_FAILED',message:e.status?e.message:'安装包操作失败，请重试或导出诊断日志'}});else res.destroy();return true}
 }
}
