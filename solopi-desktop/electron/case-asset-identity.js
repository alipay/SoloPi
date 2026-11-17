// Compare material identity only during synchronization, not every editor/status save.
// Missing/unreadable files retain their original reference: never infer equivalence
// from a basename, a filename hash suffix, or a failed read.
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const fields=new Set(['localPath','audioPath','imagePath']);
function createAssetIdentity(){
 const cache=new Map();
 function identify(value,base){
  if(typeof value!=='string'||!value.trim())return value;
  if(!path.isAbsolute(value)&&!base)return value;
  const file=path.isAbsolute(value)?value:path.resolve(base,value);
  let fd;
  try{
   fd=fs.openSync(file,'r');const before=fs.fstatSync(fd,{bigint:true});if(!before.isFile())return value;
   const stamp=[before.dev,before.ino,before.size,before.mtimeNs,before.ctimeNs].join(':');
   if(cache.has(stamp))return cache.get(stamp);
   const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(65536);let bytes;
   while((bytes=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,bytes));
   const after=fs.fstatSync(fd,{bigint:true});
   if(before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)throw Error('素材在比较期间发生变化，请重新比较');
   const identity={assetContentSha256:hash.digest('hex')};cache.set(stamp,identity);return identity;
  }catch(error){if(['ENOENT','ENOTDIR','EACCES','EPERM'].includes(error.code))return value;throw error;}
  finally{if(fd!==undefined)fs.closeSync(fd);}
 }
 function normalize(value,base){
  if(Array.isArray(value))return value.map(v=>normalize(v,base));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,fields.has(k)&&typeof v==='string'?identify(v,base):normalize(v,base)]));
  return value;
 }
 return normalize;
}
module.exports={createAssetIdentity};
