import {readFileSync} from 'node:fs';
import {join} from 'node:path';
const invalid=message=>Object.assign(Error(message),{code:'ENTRY_CONFIG_INVALID',status:422});
export function entryChannel(value='web'){
 if(typeof value!=='string'||!(/^[a-z][a-z0-9._-]{0,63}$/).test(value))throw Object.assign(Error('消息来源标识无效'),{code:'INVALID_CHANNEL',status:422});
 return value;
}
export function entryPoints(directory){
 let config;try{config=JSON.parse(readFileSync(join(directory,'entry-points.json'),'utf8'))}catch(e){if(e.code==='ENOENT')return {items:[]};throw invalid('任务入口配置无法读取')}
 if(!Array.isArray(config?.items)||config.items.length>20)throw invalid('任务入口配置无效');
 const ids=new Set();const items=config.items.map(item=>{
  if(!item||typeof item.id!=='string'||ids.has(item.id)||typeof item.url!=='string'||item.url.length>2000||typeof item.label!=='string'||!item.label.trim()||item.label.length>80)throw invalid('任务入口配置无效');entryChannel(item.id);ids.add(item.id);
  let url;try{url=new URL(item.url)}catch{throw invalid('任务入口地址无效')}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||[...url.searchParams.keys()].some(k=>/^(?:token|api[_-]?key|authorization|password|secret)$/i.test(k)))throw invalid('任务入口地址不能包含凭据或脚本');
  return {id:item.id,label:item.label,url:url.href};
 });return {items};
}
