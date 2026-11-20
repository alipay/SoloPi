const fs=require('node:fs'),path=require('node:path');
const within=(root,target)=>{const rel=path.relative(root,target);return !path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep);};
function resolvedTarget(target){let cursor=target,tail=[];while(!fs.existsSync(cursor)){const parent=path.dirname(cursor);if(parent===cursor)throw Error('Path cannot be resolved');tail.unshift(path.basename(cursor));cursor=parent;}return path.resolve(fs.realpathSync(cursor),...tail);}
function workspacePolicy(directory,readDirectories=[]){
 const root=fs.realpathSync(directory),reads=[root,...readDirectories.map(p=>fs.realpathSync(p))];
 return exec=>{
  if(!['read','read_image','write','edit'].includes(exec.name))return;
  const name=exec.arguments?.file_path;if(typeof name!=='string')return;
  const target=resolvedTarget(path.resolve(root,name)),allowed=['read','read_image'].includes(exec.name)?reads:[root];
  if(!allowed.some(r=>within(r,target)))throw Object.assign(Error('文件必须位于当前工作区；Skill目录只读'),{code:'HOST_PATH_DENIED'});
 };
}
module.exports={workspacePolicy};
