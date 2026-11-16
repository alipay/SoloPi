const fs=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const KEY='__solopiTextBlob',ESC='__solopiEscapedObject',JSONKEY='__solopiJsonBlob',VERSION=2;
// Only immutable strings are cached: edits to mutable result objects are never missed.
class SessionTextStore {
 constructor(directory){this.directory=directory;this.cache=new Map();this.cacheBytes=0;this.sealed=new WeakSet();this.records=new WeakMap();}
 file(id,hash){if(!/^[a-f0-9]{64}$/.test(hash))throw Error('Invalid session text reference');return path.join(this.directory(),`${id}-texts`,`${hash}.txt`);}
 encode(id,value,stats){
  if(typeof value==='string' && value.length>1024){
   const cached=this.cache.get(value);let hash=cached?.hash;
   if(!hash){hash=createHash('sha256').update(value).digest('hex');const file=this.file(id,hash);
    if(!fs.existsSync(file)){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const tmp=`${file}.${randomUUID()}.tmp`;
     try{fs.writeFileSync(tmp,value,{mode:0o600});fs.renameSync(tmp,file);}finally{fs.rmSync(tmp,{force:true});}
     stats.blobBytesWritten+=Buffer.byteLength(value);stats.blobsWritten++;
    }
    const bytes=value.length*2;if(bytes<=8*1024*1024){while(this.cacheBytes+bytes>8*1024*1024 && this.cache.size){const [key,v]=this.cache.entries().next().value;this.cache.delete(key);this.cacheBytes-=v.bytes;}this.cache.set(value,{hash,bytes,sessionId:id});this.cacheBytes+=bytes;}
   } else if(cached.sessionId!==id || !fs.existsSync(this.file(id,hash))) {
    // The content cache cannot skip writing a separate session's owned payload.
    const file=this.file(id,hash);if(!fs.existsSync(file)){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const tmp=`${file}.${randomUUID()}.tmp`;try{fs.writeFileSync(tmp,value,{mode:0o600});fs.renameSync(tmp,file);}finally{fs.rmSync(tmp,{force:true});}stats.blobBytesWritten+=Buffer.byteLength(value);stats.blobsWritten++;}else stats.blobCacheHits++;
   } else stats.blobCacheHits++;
   stats.blobReferences++;return {[KEY]:hash};
  }
  if(value && typeof value.toJSON==='function')return this.encode(id,value.toJSON(),stats);
  if(Array.isArray(value))return value.map(v=>this.encode(id,v,stats));
  if(value && typeof value==='object'){
   const entries=Object.entries(value).map(([k,v])=>[k,this.encode(id,v,stats)]);
   return Object.hasOwn(value,KEY)||Object.hasOwn(value,ESC)||Object.hasOwn(value,JSONKEY)?{[ESC]:entries}:Object.fromEntries(entries);
  }
  return value;
 }
 seal(value){
  if(!value || typeof value!=='object' || this.sealed.has(value))return value;
  const copy=structuredClone(value),freeze=v=>{if(v&&typeof v==='object'){for(const item of Object.values(v))freeze(item);Object.freeze(v);this.sealed.add(v);}return v;};
  return freeze(copy);
 }
 encodeRecord(id,value,stats){
  const key=path.join(this.directory(),id),cached=value&&typeof value==='object'&&this.sealed.has(value)?this.records.get(value):null;
  if(cached?.key===key){stats.blobCacheHits++;return cached.encoded;}
  const encoded=this.encodeRecordUncached(id,value,stats);
  if(value&&typeof value==='object'&&this.sealed.has(value))this.records.set(value,{key,encoded});
  return encoded;
 }
 encodeMessage(id,value,stats){
  const key=path.join(this.directory(),id),cached=this.sealed.has(value)?this.records.get(value):null;
  if(cached?.key===key){stats.blobCacheHits++;return cached.encoded;}
  const encoded=this.encode(id,value,stats);
  if(this.sealed.has(value))this.records.set(value,{key,encoded});return encoded;
 }
 encodeRecordUncached(id,value,stats){
  const text=JSON.stringify(value);
  if(text?.length>1024)return {[JSONKEY]:this.encode(id,text,stats)[KEY]};
  return this.encode(id,value,stats);
 }
 decode(id,value,cache=new Map()){
  if(Array.isArray(value))return value.map(v=>this.decode(id,v,cache));
  if(value && typeof value==='object'){
   if(Object.hasOwn(value,ESC))return Object.fromEntries(value[ESC].map(([k,v])=>[k,this.decode(id,v,cache)]));
   if(Object.hasOwn(value,JSONKEY))return JSON.parse(this.decode(id,{[KEY]:value[JSONKEY]},cache));
   if(Object.hasOwn(value,KEY)){
    const hash=value[KEY];if(cache.has(hash))return cache.get(hash);
    const text=fs.readFileSync(this.file(id,hash),'utf8');if(createHash('sha256').update(text).digest('hex')!==hash)throw Error('Session text integrity check failed; original history has not been overwritten');cache.set(hash,text);return text;
   }
   return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,this.decode(id,v,cache)]));
  }
  return value;
 }
}
module.exports={SessionTextStore,VERSION};
