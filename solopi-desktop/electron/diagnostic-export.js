const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
// The renderer cannot choose arbitrary files or a different user's data root.
// Native Save dialog owns the destination; CLI and UI share the same redaction.
function createDiagnosticExporter({dialog,directory,downloads,bundle=require('./diagnostics').bundle}){
 return async()=>{
  let temporary;
  try{
   const choice=await dialog.showSaveDialog({title:'导出诊断日志',defaultPath:path.join(downloads(),`solopi-desktop-logs-${Date.now()}.json.gz`),filters:[{name:'诊断日志压缩包',extensions:['gz']}],properties:['showOverwriteConfirmation','createDirectory']});
   if(choice.canceled||!choice.filePath)return {success:false,canceled:true};
   temporary=path.join(path.dirname(choice.filePath),`.solopi-logs-${randomUUID()}.tmp`);
   const result=bundle(directory(),temporary);
   fs.renameSync(temporary,choice.filePath);temporary=undefined;
   return {...result,path:choice.filePath};
  }catch(error){return {success:false,error:error.message||'诊断日志导出失败'};}
  finally{if(temporary)try{fs.unlinkSync(temporary);}catch{}}
 };
}
module.exports={createDiagnosticExporter};
