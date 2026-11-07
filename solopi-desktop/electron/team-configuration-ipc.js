const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {createImporter,validateManifest,exportManifest,configurationPatch}=require('./team-configuration');
function installTeamConfiguration(deps) {
  const {register,directory,readState,readEnvironment,saveEnvironment,savePatch,pullCases,loadCaseCodec,readActions,writeActions,readDefinition,importScripts,activeActionIds=()=>new Set(),notify=()=>{},reveal=x=>x,saveFile}=deps;
  const metaPath=()=>path.join(directory(),'team-configuration','state.json');
  const readMeta=()=>{try{return JSON.parse(fs.readFileSync(metaPath(),'utf8'));}catch(e){if(e.code==='ENOENT')return {};throw e;}};
  const writeMeta=m=>{fs.mkdirSync(path.dirname(metaPath()),{recursive:true,mode:0o700});const temp=metaPath()+'.tmp';fs.writeFileSync(temp,JSON.stringify(m),{mode:0o600});fs.renameSync(temp,metaPath());};
  let codec;
  const importer=createImporter({readState,readEnvironment,saveEnvironment,savePatch,pullCases:async r=>{codec ||= await loadCaseCodec();return pullCases(r);},parseCases:r=>codec.parseCaseLibraryFilesForCli(r),mergeCases:(...args)=>codec.mergePulledCaseLibraryIntoStateForCli(...args),
    importScripts,
    importAction:async(teamId,a,{overwrite})=>{
      const id='team-'+crypto.createHash('sha256').update(JSON.stringify([teamId,a.id])).digest('hex').slice(0,24);
      const existing=readActions().find(x=>x.id===id);
      if(existing&&!overwrite)return {success:true,unchanged:true};
      if(activeActionIds().has(id))throw Error('快捷操作会话正在运行');
      const dir=path.join(directory(),'quick-actions','team-import',id);fs.mkdirSync(dir,{recursive:true,mode:0o700});
      const file=path.join(dir,a.fileName);
      // Only validated basename targets; no arbitrary paths, symlinks, or executable hooks.
      if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw Error('脚本不能是符号链接');
      const temporary=file+'.tmp';fs.writeFileSync(temporary,a.content,{mode:0o700});fs.renameSync(temporary,file);
      const c=a.configuration||{};
      const action={...readDefinition(file),...c,id,configuredInputs:c.inputs,argsOverride:c.args,userConfigured:true,showInToolbar:a.showInToolbar!==false,teamSource:{id:teamId,actionId:a.id}};
      const actions=readActions();const index=actions.findIndex(x=>x.id===id);if(index>=0)actions[index]=action;else actions.push(action);
      writeActions(actions);notify('quick-actions:changed',{});return {success:true};
    },progress:r=>notify('team-config:progress',r)});
  const status=()=>{
    const s=readState(),e=readEnvironment(),m=readMeta();
    const counts={caseRepositories:(s.caseLibraries||[]).filter(l=>l.repoUrl).length,quickActions:readActions().length,llmProviders:(s.llmProviders||[]).length,tts:!!e.ttsProvider?.url,phone:(s.deviceBindings?.phoneSerials||[]).length,glasses:(s.deviceBindings?.glassesSerials||[]).length,phonePackage:s.deviceBindings?.phoneDefaultPackage||'',glassesPackage:s.deviceBindings?.glassesDefaultPackage||''};
    const configured=readActions().some(a=>a.userConfigured||a.gitSource||a.teamSource)||counts.caseRepositories||counts.llmProviders||counts.tts||counts.phone||counts.glasses||counts.phonePackage||counts.glassesPackage;
    return {success:true,counts,deviceBindings:s.deviceBindings||{},onboarding:m.onboarding||null,showWelcome:!m.onboarding&&!configured,lastImport:m.lastImport||null};
  };
  register('team-config:status',async()=>status());
  register('team-config:onboarding',async(_e,p={})=>{
    if(!Number.isInteger(p.step)||p.step<0||p.step>2||!['active','dismissed','completed'].includes(p.status))throw Error('引导状态无效');
    const m=readMeta();m.onboarding={step:p.step,status:p.status,version:1};writeMeta(m);notify('team-config:changed',{});return {success:true};
  });
  register('team-config:devices',async(_e,p={})=>{
    const m=validateManifest({schemaVersion:'lenswiper.team-config.v1',id:'local',name:'local',version:'1',deviceBindings:p.deviceBindings});
    if(!p.deviceBindings)throw Error('缺少设备映射');
    const result=await savePatch(s=>configurationPatch(s,m,true));notify('team-config:changed',{});return result;
  });
  register('team-config:validate',async(_e,p={})=>{
    try{const m=validateManifest(p.manifest);return {success:true,summary:{id:m.id,name:m.name,version:m.version,caseRepositories:m.caseRepositories?.length||0,shortcutRepositories:m.shortcutRepositories?.length||0,quickActions:m.quickActions?.length||0,llmProviders:m.llmProviders?.length||0,tts:!!m.ttsProvider,devices:!!m.deviceBindings}};}
    catch(error){return {success:false,error:error.message};}
  });
  register('team-config:import',async(_e,p={})=>{
    if(p.overwrite!==undefined&&typeof p.overwrite!=='boolean')return {success:false,error:'覆盖选项无效'};
    const r=await importer(p.manifest,{overwrite:p.overwrite!==false});
    if(r.errorCode!=='TEAM_IMPORT_BUSY'){const m=readMeta();m.lastImport={id:r.id||'',version:r.version||'',success:r.success,steps:r.steps||[],time:new Date().toISOString()};writeMeta(m);}
    notify('team-config:changed',{});return r;
  });
  register('team-config:export',async(_e,p={})=>{
    if(typeof p.includeKeys!=='boolean')return {success:false,error:'请选择是否包含 Key'};
    const state=readState(),environment=readEnvironment();
    // Do not request OS secret access when the user excluded credentials.
    const manifest=exportManifest({state:p.includeKeys?reveal(state):state,environment:p.includeKeys?reveal(environment):environment,actions:readActions(),includeKeys:p.includeKeys,id:p.id||'my-team',name:p.name||'我的团队配置',version:p.version||'1',readScript:file=>fs.readFileSync(file,'utf8')});
    return saveFile(JSON.stringify(manifest,null,2)+'\n');
  });
  return {status};
}
module.exports={installTeamConfiguration};
