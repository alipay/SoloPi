'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const builtins=[{id:'codex',name:'Codex',command:'codex',args:[],family:'codex'},{id:'claude',name:'Claude Code',command:'claude',args:[],family:'claude'}];
function validate(items){
 if(!Array.isArray(items)||items.length>100)throw Error('运行时配置须为最多100项的数组');
 const ids=new Set(),strings=a=>Array.isArray(a)&&a.length<=100&&a.every(v=>typeof v==='string'&&v.length<=10000);
 for(const d of items){
  if(!d||typeof d!=='object'||Object.keys(d).some(k=>!['id','name','command','args','family','modelsCommand'].includes(k))||!(/^[a-z][a-z0-9_-]{0,79}$/).test(d.id)||ids.has(d.id))throw Error('运行时ID重复或配置字段无效');
  ids.add(d.id);
  if(typeof d.name!=='string'||!d.name.trim()||d.name.length>200||typeof d.command!=='string'||!d.command.trim()||d.command.length>4096||!strings(d.args)||!['codex','claude'].includes(d.family))throw Error('运行时命令、参数或协议无效');
  if(d.modelsCommand){const c=d.modelsCommand;if(typeof c!=='object'||Object.keys(c).some(k=>!['command','args'].includes(k))||typeof c.command!=='string'||!c.command.trim()||c.command.length>4096||!strings(c.args))throw Error('模型目录命令无效');}
 }
 return JSON.parse(JSON.stringify(items));
}
function configPath(directory){
 if(directory)return path.join(directory,'runtime-definitions.json');
 if(process.env.SOLOPI_RUNTIME_CONFIG){if(!path.isAbsolute(process.env.SOLOPI_RUNTIME_CONFIG))throw Error('SOLOPI_RUNTIME_CONFIG须为绝对路径');return process.env.SOLOPI_RUNTIME_CONFIG;}
 const dir=process.env.SOLOPI_DESKTOP_DATA_DIR||process.env.GLASSBOX_CLI_DATA_DIR;
 const base=process.platform==='darwin'?path.join(os.homedir(),'Library/Application Support'):process.platform==='win32'?(process.env.APPDATA||path.join(os.homedir(),'AppData/Roaming')):(process.env.XDG_CONFIG_HOME||path.join(os.homedir(),'.config'));
 return path.join(dir||require('../product-identity').defaultDataDirectory(base),'runtime-definitions.json');
}
function configured(directory){try{return validate(JSON.parse(fs.readFileSync(configPath(directory),'utf8')));}catch(e){if(e.code==='ENOENT')return[];throw e;}}
function definitions(directory){return [...new Map([...builtins,...configured(directory)].map(d=>[d.id,d])).values()];}
function save(directory,items,{overwrite=true}={}){const incoming=validate(items),current=configured(directory),map=new Map(current.map(d=>[d.id,d]));for(const d of incoming)if(overwrite||!map.has(d.id))map.set(d.id,d);const file=configPath(directory);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+require('node:crypto').randomUUID();try{fs.writeFileSync(tmp,JSON.stringify([...map.values()],null,2)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}return{success:true,count:map.size};}
module.exports={validate,configured,definitions,configPath,save};
