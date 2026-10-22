const path=require('node:path'),fs=require('node:fs');
function assetBaseDirectory(state,c){
 if(c?.assetBaseDir)return String(c.assetBaseDir);
 const libraryId=c?.libraryId || state.caseFolders?.find(f=>f.id===c?.folderId)?.libraryId;
 return state.caseLibraries?.find(l=>l.id===libraryId)?.localRepoPath || '';
}
function withAssetContext(state,c,sourceCaseId){
 const source=sourceCaseId?state.cases?.find(x=>x.id===sourceCaseId):null;
 if(sourceCaseId&&!source)throw Error('复制来源用例不存在');
 const base=c.assetBaseDir || (source && assetBaseDirectory(state,source)) || assetBaseDirectory(state,c);
 if(base&&!path.isAbsolute(base))throw Object.assign(Error('素材基准目录必须是绝对路径；不会按进程工作目录猜测'),{code:'ASSET_BASE_DIR_INVALID'});
 return base?{...c,assetBaseDir:base}:{...c};
}
function validateCaseAssets(state,c){
 const components=new Map([...(state.components || []),...(c.components || [])].map(x=>[x.id,x]));
 const base=assetBaseDirectory(state,c),errors=[];
 if(base&&!path.isAbsolute(base))return {success:false,validationErrors:[{caseId:c.id,code:'ASSET_BASE_DIR_INVALID',message:'素材基准目录必须是绝对路径'}]};
 for(const step of c.steps || []){
  if(components.get(step.componentId)?.kind!=='audio'&&!['send_audio','push_audio'].includes(step.type))continue;
  const inputs=step.inputs || {},config=step.config || {};
  if(String(inputs.sourceType ?? config.sourceType ?? 'file').toLowerCase()==='tts')continue;
  const raw=String(inputs.localPath ?? inputs.audioPath ?? config.localPath ?? config.audioPath ?? '').trim();
  if(!raw || /\$\{[^{}]+\}|\{\{[^{}]+\}\}/.test(raw))continue;
  const resolved=path.isAbsolute(raw)?raw:base?path.resolve(base,raw):'';
  let readable=false;try{readable=!!resolved&&fs.statSync(resolved).isFile();if(readable)fs.accessSync(resolved,fs.constants.R_OK);}catch{readable=false;}
  if(!readable)errors.push({caseId:c.id,node:step.id,field:inputs.localPath!==undefined?'inputs.localPath':'config.localPath',code:resolved?'AUDIO_ASSET_NOT_FOUND':'ASSET_BASE_DIR_MISSING',configuredPath:raw,assetBaseDir:base,resolvedPath:resolved,
   message:resolved?`在已声明的素材目录中无法读取音频：${resolved}`:'相对素材路径缺少基准目录，尚不能判定素材不存在；不会按进程工作目录猜测。',
   recoveryActions:['先核对复制来源用例及所属库的素材根目录，复用已存在文件；仅此路径不可读不能证明素材从未创建。','确认原素材确实缺失后再报告缺失；不要要求用户重复配置已有素材或擅自改成TTS。']});
 }
 return {success:!errors.length,validationErrors:errors};
}
module.exports={assetBaseDirectory,withAssetContext,validateCaseAssets};
