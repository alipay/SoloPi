'use strict';
const path=require('node:path');
const failure=(code,message)=>Object.assign(Error(message),{code,status:422});
// Trusted deployment extensions own provider authentication, discovery and wire protocols.
// No extension means no host-account reads or network discovery.
async function models(options={}){
 options.signal?.throwIfAborted();
 const modulePath=options.modulePath??process.env.SOLOPI_MODEL_CATALOG_EXTENSION;
 if(!modulePath)return {items:[],source:'runtime-default',allowsCustom:true};
 if(typeof modulePath!=='string'||!path.isAbsolute(modulePath))throw failure('RUNTIME_CATALOG_CONFIG','模型目录扩展须配置为宿主上的绝对路径');
 let catalog;
 try{catalog=require(modulePath)}catch{throw failure('RUNTIME_CATALOG_CONFIG','无法加载配置的模型目录扩展')}
 if(typeof catalog.models!=='function')throw failure('RUNTIME_CATALOG_CONFIG','模型目录扩展缺少 models 方法');
 let result;
 try{result=await catalog.models({...options,modulePath:undefined})}catch(e){if(options.signal?.aborted)throw options.signal.reason;throw failure('RUNTIME_CATALOG_UNAVAILABLE','模型目录扩展未能返回结果，请检查宿主扩展配置')}
 options.signal?.throwIfAborted();
 if(!Array.isArray(result?.items)||result.items.length>1000||result.items.some(x=>!x||typeof x.id!=='string'||!x.id.trim()||x.id.length>200||typeof x.name!=='string'||!x.name.trim()||x.name.length>300)||new Set(result.items.map(x=>x.id)).size!==result.items.length)throw failure('RUNTIME_CATALOG_INVALID','模型目录扩展返回的列表无效');
 return {items:result.items.map(({id,name,isDefault})=>({id,name,...(typeof isDefault==='boolean'?{isDefault}:{})})),source:'host-extension',allowsCustom:result.allowsCustom!==false};
}
module.exports={models};
