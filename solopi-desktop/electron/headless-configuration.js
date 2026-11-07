const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {createCredentialStorage}=require('./credential-storage');
const {protectSecrets,prepareSecretsForDisplay,revealSecrets}=require('./secret-storage');
const {createSettingsService}=require('./settings-service');
const {installTeamConfiguration}=require('./team-configuration-ipc');
const {acquireConfigurationLock}=require('./configuration-lock');
const {readQuickActionDefinition}=require('./quick-actions');
const {importGitScripts}=require('./quick-action-git');
async function runHeadlessConfiguration({directory,payload,codec,pullCases,runGit}) {
  const mutating=!(payload.operation==='get'||payload.dryRun);
  const release=mutating?acquireConfigurationLock(directory):()=>{};
  try {
    const storage=createCredentialStorage({directory});
    const read=(relative,fallback={})=>{try{return JSON.parse(fs.readFileSync(path.join(directory,relative),'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw Error('配置文件无法读取，未覆盖原文件');}};
    const write=(relative,value)=>{
      const file=path.join(directory,relative),tmp=file+'.'+crypto.randomUUID()+'.tmp';
      fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
      try{fs.writeFileSync(tmp,JSON.stringify(protectSecrets(value,storage),null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
    };
    const readState=()=>prepareSecretsForDisplay(read('workflow-editor-state.json'));
    const readEnvironment=()=>prepareSecretsForDisplay(read('environment-config.json'));
    const readActions=()=>read('quick-actions/actions.json',{actions:[]}).actions;
    const writeActions=actions=>write('quick-actions/actions.json',{version:1,actions});
    if(payload.action==='settings')return await createSettingsService({readState,readEnvironment,writeState:s=>write('workflow-editor-state.json',s),writeEnvironment:e=>write('environment-config.json',e)})(payload);
    const handlers=new Map();
    installTeamConfiguration({register:(name,handler)=>handlers.set(name,handler),directory:()=>directory,readState,readEnvironment,
      savePatch:async prepare=>{write('workflow-editor-state.json',{...readState(),...prepare(readState())});return {success:true};},
      saveEnvironment:async ttsProvider=>{write('environment-config.json',{...readEnvironment(),ttsProvider});return {success:true};},
      loadCaseCodec:async()=>codec,pullCases:repo=>pullCases(revealSecrets(repo,storage)),readActions,writeActions,readDefinition:readQuickActionDefinition,
      importScripts:async(repo,{overwrite})=>{
        if(!overwrite&&readActions().some(a=>a.gitSource?.repoUrl===repo.repoUrl&&(a.gitSource.branch||'')===(repo.branch||'')&&(a.gitSource.directory||'')===(repo.directory||'')))return {success:true,unchanged:true};
        const auth=revealSecrets(repo,storage);
        const result=await importGitScripts({root:path.join(directory,'quick-actions','repositories.noindex'),repoUrl:repo.repoUrl,branch:repo.branch||'',directory:repo.directory||'',run:(cmd,args)=>runGit(cmd,args,auth),readDefinition:readQuickActionDefinition,getActions:readActions,saveActions:writeActions});
        const actions=readActions();
        for(const action of actions){if(action.gitSource?.repoUrl!==repo.repoUrl||(action.gitSource.branch||'')!==(repo.branch||'')||(action.gitSource.directory||'')!==(repo.directory||''))continue;const override=(repo.overrides||[]).find(x=>x.relativePath===action.gitSource.relativePath);if(override){const c=override.configuration||{};Object.assign(action,c,{configuredInputs:c.inputs,argsOverride:c.args,userConfigured:true,...(override.showInToolbar!==undefined?{showInToolbar:override.showInToolbar}:{})});}}
        writeActions(actions);return result;
      },reveal:value=>revealSecrets(value,storage)});
    return await handlers.get(payload.dryRun?'team-config:validate':'team-config:import')(null,{manifest:payload.manifest});
  } finally {release();}
}
module.exports={runHeadlessConfiguration};
