// Portable team configuration. Import never executes a downloaded action or a test.
const crypto = require('node:crypto');
const { validateRepository } = require('./quick-action-git');
const { validateRequest } = require('./quick-action-api');
const VERSION = 'lenswiper.team-config.v1';
const clone = value => JSON.parse(JSON.stringify(value));
const text = (value, field, optional = false) => {
  if (optional && value === undefined) return;
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > 200000) throw Error(`${field} 需要有效字符串`);
};
function fields(value, allowed, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) throw Error(`${name} 包含未知字段或格式错误`);
}
function http(value, name) {
  text(value, name); const u = new URL(value);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw Error(`${name} 需要不含密码的 HTTP(S) 地址`);
}
const providerFields = ['id','name','baseUrl','model','apiKey','protocol','responseFormat','thinking','capabilities','contextWindowTokens','maxOutputTokens'];
const ttsFields = ['enabled','name','url','method','params','headersText','bodyTemplate','responseType','responseMappings','audioField','urlField','outputExtension','sampleRate','sampleFormat','channelCnt','timeoutMs'];
const bindingFields = ['phoneSerials','glassesSerials','phoneDefaultPackage','glassesDefaultPackage'];
const repositoryFields = ['id','name','repoUrl','branch','authUsername','authToken'];
function validateManifest(input) {
  let value;
  try { value = typeof input === 'string' ? JSON.parse(input) : clone(input); } catch { throw Error('团队配置不是有效 JSON'); }
  if (Buffer.byteLength(JSON.stringify(value)) > 5 * 1024 * 1024) throw Error('团队配置不能超过 5 MB');
  fields(value, ['schemaVersion','id','name','version','caseRepositories','shortcutRepositories','quickActions','llmProviders','selectedLlmProviderId','ttsProvider','deviceBindings'], '团队配置');
  if (value.schemaVersion !== VERSION) throw Error('不支持的团队配置版本');
  for (const k of ['id','name','version']) text(value[k], k);
  for (const key of ['caseRepositories','shortcutRepositories','quickActions','llmProviders']) {
    if (value[key] === undefined) continue;
    if (!Array.isArray(value[key]) || value[key].length > 100) throw Error(`${key} 必须是最多 100 项的数组`);
    const ids = new Set();
    for (const item of value[key]) {
      text(item?.id, `${key}.id`);
      if (ids.has(item.id)) throw Error(`${key} ID 重复`); ids.add(item.id);
      if (key === 'caseRepositories' || key === 'shortcutRepositories') {
        fields(item, key === 'caseRepositories' ? repositoryFields : [...repositoryFields, 'directory','overrides'], key);
        validateRepository(item.repoUrl, item.branch || '', item.directory || '');
        for (const k of ['name','authUsername','authToken']) text(item[k], k, true);
        if (item.overrides !== undefined) {
          if (!Array.isArray(item.overrides) || item.overrides.length>500) throw Error('快捷仓库 overrides 无效');
          for (const override of item.overrides) {
            fields(override,['relativePath','configuration','showInToolbar'],'快捷仓库覆盖配置');
            text(override.relativePath,'relativePath');
            if (override.relativePath.split(/[\\/]/).includes('..') || override.relativePath.startsWith('/')) throw Error('快捷脚本路径无效');
            validateRequest('update',{id:'validation',configuration:override.configuration});
            if (override.showInToolbar !== undefined && typeof override.showInToolbar!=='boolean') throw Error('showInToolbar 无效');
          }
        }
      } else if (key === 'llmProviders') {
        fields(item, providerFields, key);
        for (const k of ['name','model']) text(item[k], k);
        text(item.apiKey, 'apiKey', true); http(item.baseUrl, 'baseUrl');
        if (item.protocol && item.protocol !== 'openai-compatible') throw Error('不支持的模型协议');
        if (item.thinking && !['default','disabled'].includes(item.thinking)) throw Error('thinking 无效');
        if (item.responseFormat && !['default','json_object'].includes(item.responseFormat)) throw Error('responseFormat 无效');
        for (const k of ['contextWindowTokens','maxOutputTokens']) if (item[k] !== undefined && (!Number.isSafeInteger(item[k]) || item[k] <= 0)) throw Error('模型容量必须为正整数');
        if (item.contextWindowTokens !== undefined && item.contextWindowTokens <= (item.maxOutputTokens || 16384)) throw Error('模型上下文容量须大于输出上限');
        if (item.capabilities) {
          fields(item.capabilities, ['thinking','responseFormat'], 'capabilities');
          if (Object.values(item.capabilities).some(v => !['unknown','supported','unsupported'].includes(v))) throw Error('模型能力值无效');
        }
      } else {
        fields(item, ['id','fileName','content','configuration','showInToolbar'], key);
        validateRequest('create', {fileName:item.fileName, content:item.content, ...(item.configuration ? {configuration:item.configuration} : {})});
        if (!/^[^/\\]+\.(sh|ps1|cmd|bat)$/i.test(item.fileName) || item.fileName.startsWith('.')) throw Error('快捷脚本文件名无效');
        if (item.showInToolbar !== undefined && typeof item.showInToolbar !== 'boolean') throw Error('showInToolbar 无效');
      }
    }
  }
  if (value.ttsProvider !== undefined) {
    const t = value.ttsProvider; fields(t, ttsFields, 'ttsProvider');
    if (t.url) http(t.url, 'ttsProvider.url');
    if (t.enabled !== undefined && typeof t.enabled !== 'boolean') throw Error('TTS enabled 无效');
    if (t.method && !['GET','POST','PUT'].includes(t.method)) throw Error('TTS method 无效');
    for (const k of ['name','headersText','bodyTemplate','audioField','urlField','outputExtension','sampleFormat']) text(t[k], k, true);
    if (t.headersText) { const h=JSON.parse(t.headersText); if (!h || typeof h !== 'object' || Array.isArray(h) || Object.values(h).some(v=>typeof v!=='string')) throw Error('TTS headersText 需要字符串值的 JSON 对象'); }
    for (const k of ['sampleRate','channelCnt','timeoutMs']) if (t[k] !== undefined && (!Number.isFinite(t[k]) || t[k] <= 0)) throw Error(`TTS ${k} 无效`);
    if (t.responseType && !['binary','json-base64','json-url'].includes(t.responseType)) throw Error('TTS responseType 无效');
    for (const [key, keys] of [['params',['key','defaultValue']],['responseMappings',['variableName','responsePath']]]) {
      if (t[key] === undefined) continue;
      if (!Array.isArray(t[key]) || t[key].length > 100) throw Error(`TTS ${key} 无效`);
      for (const entry of t[key]) { fields(entry, keys, key); for (const k of keys) text(entry[k], k, k==='defaultValue'||k==='variableName'); }
    }
  }
  if (value.deviceBindings !== undefined) {
    fields(value.deviceBindings, bindingFields, 'deviceBindings');
    for (const k of ['phoneSerials','glassesSerials']) if (value.deviceBindings[k] !== undefined && (!Array.isArray(value.deviceBindings[k]) || value.deviceBindings[k].length>100 || value.deviceBindings[k].some(v=>typeof v!=='string' || !v.trim()))) throw Error('设备 SN 数组无效');
    for (const k of ['phoneDefaultPackage','glassesDefaultPackage']) if (value.deviceBindings[k] !== undefined && (typeof value.deviceBindings[k] !== 'string' || (value.deviceBindings[k] && !/^[A-Za-z]\w*(?:\.[A-Za-z]\w*)+$/.test(value.deviceBindings[k])))) throw Error('默认包名无效');
    if ((value.deviceBindings.phoneSerials || []).some(s=>(value.deviceBindings.glassesSerials || []).includes(s))) throw Error('同一设备不能同时为手机和眼镜');
  }
  if (value.selectedLlmProviderId !== undefined) text(value.selectedLlmProviderId, 'selectedLlmProviderId');
  return value;
}
function configurationPatch(state, manifest, overwrite = true) {
  const patch = {};
  if (manifest.llmProviders) {
    const map = new Map((state.llmProviders || []).map(p=>[p.id,p]));
    for (const p of manifest.llmProviders) if (overwrite || !map.has(p.id)) map.set(p.id, {...p, protocol:'openai-compatible',apiKey:p.apiKey || ''});
    patch.llmProviders=[...map.values()];
  }
  if (manifest.selectedLlmProviderId && (overwrite || !state.selectedLlmProviderId)) {
    if (!(patch.llmProviders || state.llmProviders || []).some(p=>p.id===manifest.selectedLlmProviderId)) throw Error('默认模型 ID 不存在');
    patch.selectedLlmProviderId=manifest.selectedLlmProviderId;
  }
  if (manifest.deviceBindings) {
    const current=state.deviceBindings || {}; const next={phoneSerials:[],glassesSerials:[],phoneDefaultPackage:'',glassesDefaultPackage:'',...current};
    for (const [k,v] of Object.entries(manifest.deviceBindings)) if (overwrite || !current[k] || (Array.isArray(current[k]) && !current[k].length)) next[k]=v;
    if ((next.phoneSerials || []).some(s=>(next.glassesSerials || []).includes(s))) throw Error('合并后同一设备同时为手机和眼镜');
    patch.deviceBindings=next;
  }
  return patch;
}
const pick=(source,keys)=>Object.fromEntries(keys.filter(k=>source[k]!==undefined).map(k=>[k,source[k]]));
function exportManifest({state,environment,actions,id='team',name='我的团队配置',version='1',includeKeys=false,readScript}) {
  const result={schemaVersion:VERSION,id,name,version,
    caseRepositories:(state.caseLibraries || []).filter(l=>l.repoUrl).map(l=>({...pick(l,repositoryFields),branch:l.gitBranch || l.branch || 'master'})),
    quickActions:actions.filter(a=>!a.gitSource).map(a=>({id:a.teamSource?.actionId||a.id,fileName:require('node:path').basename(a.scriptPath),content:readScript(a.scriptPath),configuration:require('./quick-action-git').portableConfig(a),showInToolbar:a.showInToolbar!==false})),
    shortcutRepositories:[...new Map(actions.filter(a=>a.gitSource).map(a=>[a.gitSource.key,{id:a.gitSource.key,...pick(a.gitSource,['repoUrl','branch','directory']),overrides:actions.filter(x=>x.gitSource?.key===a.gitSource.key).map(x=>({relativePath:x.gitSource.relativePath,configuration:require('./quick-action-git').portableConfig(x),showInToolbar:x.showInToolbar!==false}))}])).values()],
    llmProviders:(state.llmProviders || []).map(p=>pick(p,providerFields)),
    ...(state.selectedLlmProviderId ? {selectedLlmProviderId:state.selectedLlmProviderId} : {}),
    ...(environment.ttsProvider ? {ttsProvider:pick(environment.ttsProvider,ttsFields)} : {}),
    ...(state.deviceBindings ? {deviceBindings:pick(state.deviceBindings,bindingFields)} : {})};
  if (!includeKeys) {
    result.llmProviders.forEach(p=>delete p.apiKey);
    result.caseRepositories.forEach(p=>{delete p.authToken;});
    if (result.ttsProvider) delete result.ttsProvider.headersText;
  }
  return validateManifest(result);
}
function createImporter({readState,savePatch,readEnvironment,saveEnvironment,pullCases,parseCases,mergeCases,importScripts,importAction,progress=()=>{}}) {
  let busy=false;
  return async (input,{overwrite=true}={})=>{
    if (busy) return {success:false,errorCode:'TEAM_IMPORT_BUSY',error:'团队配置正在导入'};
    busy=true; const steps=[]; let manifest;
    const step=async(id,label,run)=>{
      progress({id,label,status:'running'});
      try { const r=await run(); if (r?.success===false) throw Object.assign(Error(r.error || '保存失败'),{code:r.errorCode,needsGitLfs:r.needsGitLfs}); const receipt={id,label,status:'success',...(r?.unchanged?{unchanged:true}:{})};steps.push(receipt);progress(receipt);return r; }
      catch(e){const errorCode=e.needsGitLfs?'GIT_LFS_MISSING':/^[A-Z0-9_]{1,64}$/.test(e.code||'')?e.code:'TEAM_STEP_FAILED';const receipt={id,label,status:'failed',errorCode};steps.push(receipt);progress(receipt);throw e;}
    };
    try {
      const m=validateManifest(input);manifest=m;
      configurationPatch(readState(),m,overwrite); // Validate cross references before any write/network.
      await step('configuration','模型、常用设备与默认包',()=>savePatch(s=>configurationPatch(s,m,overwrite)));
      if (m.ttsProvider) await step('tts','TTS 配置',async()=>{
        if (!overwrite && readEnvironment().ttsProvider?.url) return {success:true,unchanged:true};
        return saveEnvironment({...m.ttsProvider,headersText:m.ttsProvider.headersText || ''});
      });
      for (const repo of m.caseRepositories || []) await step(`cases:${repo.id}`,`用例库 · ${repo.name || repo.id}`,async()=>{
        const existing=(readState().caseLibraries || []).find(l=>l.id===repo.id || (l.repoUrl===repo.repoUrl && (l.gitBranch||l.branch||'master')===(repo.branch||'master')));
        if (existing && !overwrite) return {success:true,unchanged:true};
        const r=await pullCases(repo); if (!r.success) return r;
        const library={...repo,id:existing?.id||repo.id,gitBranch:repo.branch||'master',authToken:repo.authToken||''};
        const parsed=parseCases({...r,libraryId:library.id,repoUrl:repo.repoUrl});
        if (parsed.parseErrors?.length || !parsed.cases?.length) throw Error('用例库文件解析失败或没有可用用例');
        return savePatch(s=>{
          // Capture this library's definitions in its own cases. Global catalog
          // IDs may be shared across libraries with different defaults.
          const importedDefinitions=new Map((parsed.components||[]).map(c=>[c.id,c]));
          const isolated={...parsed,cases:parsed.cases.map(c=>{
            const definitions=new Map((c.components||[]).map(x=>[x.id,x]));
            for(const st of c.steps||[])if(st.componentId&&!definitions.has(st.componentId)&&importedDefinitions.has(st.componentId))definitions.set(st.componentId,importedDefinitions.get(st.componentId));
            return {...c,components:[...definitions.values()]};
          })};
          const next=mergeCases(s,library,isolated,r.gitInfo);
          next.caseLibraries=next.caseLibraries.map(l=>l.id===library.id?{...l,...pick(library,['repoUrl','authUsername','authToken','gitBranch']),localRepoPath:r.repoPath,localComponentIds:(parsed.components||[]).map(c=>c.id)}:l);
          const foreignFolders=new Set((s.caseFolders||[]).filter(f=>f.libraryId!==library.id).map(f=>f.id));
          if ((parsed.folders||[]).some(f=>foreignFolders.has(f.id))) throw Error('文件夹 ID 与其他本地用例库冲突');
          const ownFolders=new Set((s.caseFolders||[]).filter(f=>f.libraryId===library.id).map(f=>f.id));
          const outside=new Set((s.cases||[]).filter(c=>!ownFolders.has(c.folderId)).map(c=>c.id));
          const externalComponents=new Set((s.cases||[]).filter(c=>outside.has(c.id)).flatMap(c=>(c.steps||[]).map(st=>st.componentId)));
          const previousComponents=new Map((s.components||[]).map(c=>[c.id,c]));
          next.components=next.components.map(c=>externalComponents.has(c.id)&&previousComponents.has(c.id)?previousComponents.get(c.id):c);
          if (parsed.cases.some(c=>outside.has(c.id))) throw Error('用例 ID 与其他本地用例库冲突');
          const fields=['cases','caseLibraries','caseFolders','components','caseEdges','nodePositions','selectedCaseId','selectedCaseLibraryId'];
          return pick(next,fields);
        });
      });
      for (const repo of m.shortcutRepositories || []) await step(`shortcuts:${repo.id}`,`快捷仓库 · ${repo.name || repo.id}`,()=>importScripts(repo,{overwrite}));
      for (const action of m.quickActions || []) await step(`action:${action.id}`,`快捷操作 · ${action.configuration?.name || action.id}`,()=>importAction(m.id,action,{overwrite}));
      return {success:true,id:m.id,version:m.version,steps};
    } catch(error) {
      // Do not echo input (may contain keys) or arbitrary provider/Git errors into diagnostics.
      return {success:false,id:manifest?.id,version:manifest?.version,errorCode:'TEAM_IMPORT_FAILED',error:steps.at(-1)?.errorCode==='BUNDLED_GIT_LFS_UNAVAILABLE'?'内置 Git LFS 不可用，请修复或重新安装 solopi-desktop；已完成项目保留。':steps.at(-1)?.errorCode==='GIT_LFS_MISSING'?'本机缺少 Git LFS，请先完成 Git LFS 配置后重试；已完成项目保留。':'导入未全部完成，已完成项目保留；请检查失败项目的来源、权限或配置后重试。',steps,validationError:steps.length===0 ? error.message : undefined};
    } finally {busy=false;}
  };
}
module.exports={VERSION,validateManifest,configurationPatch,exportManifest,createImporter};
