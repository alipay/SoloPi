const path=require('node:path');
function catalog(task){
 const records=[...(task.taskLogs || task.logs || []),...(task.artifacts?.logs || []),...(task.cases || []).flatMap(c=>c.artifacts?.logs || [])],files=new Map();
 for(const r of records){const file=r.path || r.outputPath || r.filePath;if(!file)continue;const item=files.get(file)||{path:file,roles:new Set()};if(r.deviceType)item.roles.add(r.deviceType);files.set(file,item);}
 return [...files.values()].map((r,index)=>({index,path:r.path,name:path.basename(r.path),...(r.roles.size===1?{deviceType:[...r.roles][0]}:{})}));
}
function select(task,{fileIndex,deviceType}={}){
 const entries=catalog(task),files=entries.map(({path,...r})=>r);
 if(fileIndex!==undefined && (!Number.isSafeInteger(fileIndex)||fileIndex<0))throw Error('日志文件索引无效');
 let candidates=fileIndex===undefined?entries:entries.filter(r=>r.index===fileIndex);
 if(deviceType)candidates=candidates.filter(r=>r.deviceType===deviceType);
 if(candidates.length!==1)return{error:{success:false,errorCode:'LOG_SOURCE_SELECTION_REQUIRED',error:'日志来源不唯一或与指定设备不匹配；请用deviceType或返回的fileIndex明确选择，不默认使用第0个文件。',files}};
 return {file:candidates[0].path,fileIndex:candidates[0].index,deviceType:candidates[0].deviceType,files};
}
module.exports={catalog,select};
