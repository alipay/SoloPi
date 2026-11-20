// Generic structured receipt access. JSON strings are decoded only while traversing
// an explicitly requested pointer; no business fields or command-name routing.
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const decode=value=>{if(typeof value==='string'){try{return JSON.parse(value);}catch{}}return value;};
function select(value,pointer){
 if(typeof pointer!=='string'||pointer.length>1000||pointer!==''&&!pointer.startsWith('/'))throw Error('字段路径须为JSON Pointer，可用*选择数组全部成员');
 let values=[{pointer:'',value}];
 for(const raw of pointer===''?[]:pointer.slice(1).split('/')){
  const key=raw.replace(/~1/g,'/').replace(/~0/g,'~'),next=[];
  for(const item of values){const obj=decode(item.value);if(!obj||typeof obj!=='object')continue;
   const keys=key==='*'?Object.keys(obj):[key];
   for(const k of keys)if(Object.hasOwn(obj,k))next.push({pointer:item.pointer+'/'+k.replace(/~/g,'~0').replace(/\//g,'~1'),value:obj[k]});
  }
  values=next;
 }
 return values;
}
function outline(value){
 const items=[];
 function walk(v,p,depth){if(items.length>=36)return;const parsed=decode(v);
  if(parsed && typeof parsed==='object'){
   items.push({pointer:p,kind:Array.isArray(parsed)?'array':'object',...(Array.isArray(parsed)?{count:parsed.length}:{keys:Object.keys(parsed).slice(0,16)}),...(parsed!==v?{jsonString:true}:{})});
   if(depth<3)for(const k of Object.keys(parsed).slice(0,6))walk(parsed[k],p+'/'+k.replace(/~/g,'~0').replace(/\//g,'~1'),depth+1);
  }
 }
 walk(value,'',0);return items;
}
function project(value,pointers,{directory,evidenceId,maxCharacters=12000}={}){
 if(!Array.isArray(pointers)||!pointers.length||pointers.length>20)throw Error('请选择1至20个字段路径');
 const fields=pointers.map(pointer=>({pointer,matches:select(value,pointer)}));
 const payload={fields},serialized=JSON.stringify(payload,null,2),key=createHash('sha256').update(JSON.stringify(pointers)).digest('hex').slice(0,16);
 const projectionPath=path.join(directory,`${evidenceId}-projection-${key}.json`);
 fs.writeFileSync(projectionPath,serialized,{mode:0o600});
 const complete=serialized.length<=maxCharacters;
 return{success:true,evidenceId,projectionPath,projectionComplete:complete,totalCharacters:serialized.length,...(complete?payload:{fields:fields.map(f=>({pointer:f.pointer,matchCount:f.matches.length})),message:'字段原值完整保存到projectionPath，脚本直接读取；未截断字段，不要分页拼接URL。'})};
}
module.exports={select,outline,project};
