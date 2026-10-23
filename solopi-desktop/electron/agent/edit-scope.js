const {isDeepStrictEqual:equal}=require('node:util');
function segments(pointer){
  if(typeof pointer!=='string'||!pointer.startsWith('/')||/~(?![01])/u.test(pointer))throw Error('需要合法的JSON Pointer路径');
  return pointer.slice(1).split('/').map(s=>s.replaceAll('~1','/').replaceAll('~0','~'));
}
function object(value){
  if(typeof value==='string'){try{return JSON.parse(value);}catch{}}
  return value;
}
function read(value,pointer){
  for(const key of segments(pointer)){value=object(value);if(!value||typeof value!=='object'||!Object.hasOwn(value,key))return {exists:false};value=value[key];}
  return {exists:true,value};
}
function changedPaths(before,after,parts=[],out=[]){
  if(equal(before,after))return out;
  // Decode structured strings only when both sides are structured. Free text
  // edits and replacement with invalid JSON remain a change to the whole field.
  const a=object(before),b=object(after);
  if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)){
    for(const key of new Set([...Object.keys(a),...Object.keys(b)]))changedPaths(a[key],b[key],[...parts,key],out);
    if(Array.isArray(a)&&a.length!==b.length)out.push([...parts,'length']);
  }else out.push(parts);
  return out;
}
const pointer=parts=>'/'+parts.map(p=>p.replaceAll('~','~0').replaceAll('/','~1')).join('/');
function assertScope(before,after,allowedPaths){
  const changes=changedPaths(before,after);
  if(allowedPaths){
    if(!Array.isArray(allowedPaths)||!allowedPaths.length||allowedPaths.length>40)throw Error('allowedPaths需要1至40个字段路径');
    const patterns=allowedPaths.map(segments);
    const outside=changes.filter(parts=>!patterns.some(pattern=>pattern.length<=parts.length&&pattern.every((p,i)=>p==='*'||p===parts[i])));
    if(outside.length)throw Object.assign(Error(`修改超出本次字段范围：${outside.slice(0,10).map(pointer).join(', ')}；未写入任何用例`),{code:'EDIT_SCOPE_EXCEEDED'});
  }
  return changes.map(pointer);
}
module.exports={segments,read,assertScope};
