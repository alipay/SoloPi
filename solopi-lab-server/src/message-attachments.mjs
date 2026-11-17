import{mkdirSync,writeFileSync,readFileSync,unlinkSync}from'node:fs';import{join}from'node:path';import{randomUUID,createHash}from'node:crypto';
const fail=(code,message)=>{throw Object.assign(Error(message),{code,status:422});};
export class MessageAttachments{
 constructor(db,directory){this.db=db;this.directory=join(directory,'attachments');mkdirSync(this.directory,{recursive:true,mode:0o700});db.exec('CREATE TABLE IF NOT EXISTS sa_attachment(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,gmt_create TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');}
 public(row){return{id:row.id,name:row.name,mime:row.mime,size:row.size,path:row.id};}
 upload(conversationId,{name,mime,data}){
  if(typeof name!=='string'||!name.trim()||name.length>200||typeof data!=='string'||data.length>700000||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))fail('ATTACHMENT_INVALID','附件格式无效或超过512KB');
  const bytes=Buffer.from(data,'base64');if(!bytes.length||bytes.length>524288||bytes.toString('base64')!==data)fail('ATTACHMENT_INVALID','附件格式无效或超过512KB');
  const detected=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'?'image/webp':null;
  if(typeof mime!=='string'||!/^[-\w.+]+\/[-\w.+]+$/.test(mime)||mime.startsWith('image/')&&(!detected||mime!==detected)||detected&&mime!==detected)fail('ATTACHMENT_INVALID','附件媒体类型与内容不符');
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const existing=this.db.prepare('SELECT * FROM sa_attachment WHERE conversation_id=? AND name=? AND mime=? AND sha256=?').get(conversationId,name,mime,sha256);if(existing){this.bytes(existing);return this.public(existing);}
  const id=randomUUID(),row={id,conversation_id:conversationId,name,mime,size:bytes.length,sha256};
  writeFileSync(join(this.directory,id),bytes,{flag:'wx',mode:0o600});try{this.db.prepare('INSERT INTO sa_attachment(id,conversation_id,name,mime,size,sha256) VALUES(?,?,?,?,?,?)').run(id,conversationId,name,mime,bytes.length,sha256);}catch(e){unlinkSync(join(this.directory,id));throw e;}return this.public(row);
 }
 rows(conversationId,ids=[]){if(!Array.isArray(ids)||ids.length>4||ids.some(x=>typeof x!=='string'))fail('ATTACHMENT_INVALID','每条消息最多4个附件');return ids.map(id=>{const row=this.db.prepare('SELECT * FROM sa_attachment WHERE id=? AND conversation_id=?').get(id,conversationId);if(!row)fail('ATTACHMENT_NOT_FOUND','附件不属于当前会话');return row;});}
 bytes(row){const bytes=readFileSync(join(this.directory,row.id));if(bytes.length!==row.size||createHash('sha256').update(bytes).digest('hex')!==row.sha256)fail('ATTACHMENT_CORRUPT','附件内容校验失败');return bytes;}
 model(conversationId,ids,{workspace}={}){return this.rows(conversationId,ids).map(row=>{const bytes=this.bytes(row);let path=join(this.directory,row.id);if(workspace){const directory=join(workspace,'attachments');mkdirSync(directory,{recursive:true,mode:0o700});path=join(directory,row.id);try{writeFileSync(path,bytes,{mode:0o400,flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;const stored=readFileSync(path);if(!stored.equals(bytes))fail('ATTACHMENT_CORRUPT','工作区附件内容校验失败');}}return{...this.public(row),path};});}
 preview(conversationId,id){const row=this.rows(conversationId,[id])[0];return{...this.public(row),success:true,dataUrl:'data:'+row.mime+';base64,'+this.bytes(row).toString('base64')};}
}
