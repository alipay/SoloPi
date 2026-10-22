const { skillCatalog } = require('./extensions');
const { readSkill, readSkillReference, resolveSkillFile } = require('./skills');
const { fileVersion } = require('./reference-memory');
const { recordSkillRead, assertSkillRead } = require('./skill-reading');
const { canonicalSkillName, canonicalSkillFile } = require('./skill-names');

// Refresh only documents explicitly used in the current request scope. Never load every installed
// Skill into the prompt or add a model request just to discover an update.
function refreshLoadedSkills(session, roots, config = {}) {
  const active=require('./skill-scope').activeSkillNames(session);
  // Old failed references have no read ledger left. Re-evaluate their current
  // targets instead of indefinitely advertising obsolete ENOENT notices.
  for (const [key, update] of Object.entries(session.skillUpdates || {})) {
    if(!active.has(canonicalSkillName(update.name)))continue;
    const name = canonicalSkillName(update.name), file = canonicalSkillFile(name, update.file);
    const target = `${name}:${file}`;
    if (name === update.name && file === update.file) continue;
    delete session.skillUpdates[key];
    (session.skillReads ||= {})[target] ||= {};
  }
  const targets = Object.entries(session.skillReads || {}).filter(([key])=>active.has(canonicalSkillName(key.slice(0,key.indexOf(':')))));
  // A missing current dependency can reappear later; recheck it without reviving
  // inactive historical notices or requiring an old successful read receipt.
  for(const [key,update] of Object.entries(session.skillUpdates || {}))
    if(active.has(canonicalSkillName(update.name)) && !targets.some(([target])=>target===key))targets.push([key,update]);
  const inventory=skillCatalog(roots,config);
  require('./skill-catalog-frame').updateSkillCatalog(session,inventory,roots);
  if(!session.skillCatalogView.complete || !targets.length){boundSkillUpdates(session);return [];}
  const catalog = inventory.skills.filter(skill => skill.enabled);
  const changed = new Set();
  // Entry first: changing it invalidates its reference-read ledger.
  targets.sort(([a], [b]) => Number(!a.endsWith(':SKILL.md')) - Number(!b.endsWith(':SKILL.md')));
  for (const [key, previous] of targets) {
    const separator = key.indexOf(':');
    const oldName = key.slice(0, separator), preferred = canonicalSkillName(oldName), oldFile = key.slice(separator + 1);
    const name = catalog.some(skill => skill.name === preferred) ? preferred : oldName;
    const file = canonicalSkillFile(name, oldFile);
    const currentKey = `${name}:${file}`;
    try {
      const source = resolveSkillFile(catalog, name, file).file;
      if (key === currentKey && previous.absolutePath === source && previous.sourceVersion && previous.sourceVersion === fileVersion(source) && session.skillReads[key]) continue;
      const result = file === 'SKILL.md' ? readSkill(catalog, name) : readSkillReference(catalog, name, file);
      if (key !== currentKey) {
        delete session.skillReads[key];
        if (session.skillUpdates) delete session.skillUpdates[key];
      }
      if (key === currentKey && result.hash === previous.hash && result.absolutePath === previous.absolutePath) {
        // An unchanged reference still needs its ledger restored after entry refresh.
        session.skillReads[key] = { ...previous, sourceVersion: result.sourceVersion };
        continue;
      }
      const sourceChanged = Boolean(previous.absolutePath && previous.absolutePath !== result.absolutePath);
      delete session.skillReads[key];
      recordSkillRead(session, result,{activate:false});
      (session.skillUpdates ||= {})[currentKey] = { name: result.name, file: result.file, hash: result.hash, complete: result.complete, previousPath: sourceChanged ? previous.absolutePath : undefined, absolutePath: result.absolutePath };
      changed.add(name);
      // Cached receipts from the old source cannot be advertised as current.
      const oldCalls = new Set((session.calls || []).filter(call => ['read_skill','read_skill_reference'].includes(call.name) && [name, oldName].includes(call.args?.name)).map(call => call.modelCallId));
      session.referenceMemory = (session.referenceMemory || []).filter(item => ![name, oldName].includes(item.skillName) && !oldCalls.has(item.callId));
    } catch (error) {
      delete session.skillReads[key];
      const update = { success: false, name, file, error: error.message };
      if (JSON.stringify(session.skillUpdates?.[key]) !== JSON.stringify(update)) changed.add(name);
      (session.skillUpdates ||= {})[key] = update;
    }
  }
  boundSkillUpdates(session);
  for (const name of changed) (session.skillEpochs ||= {})[name] = (session.skillEpochs[name] || 0) + 1;
  return [...changed];
}
// Keep refresh notices bounded; a deferred source must be explicitly read before use.
function boundSkillUpdates(session) {
  const documents = [],active=require('./skill-scope').activeSkillNames(session);
  for (const [key, result] of Object.entries(session.skillUpdates || {})) {
    const read = session.skillReads?.[key];
    const relevant=active.has(canonicalSkillName(result.name));
    if (read && relevant) { read.complete = false; read.ranges = []; }
    // Migrate old persisted full refresh payloads; original tool receipts remain intact.
    session.skillUpdates[key] = { name: result.name, file: result.file, hash: result.hash, complete: result.complete, success: result.success, error: result.error, previousPath: result.previousPath, absolutePath: result.absolutePath };
    if(!relevant)continue;
    documents.push({ name: result.name, file: result.file, hash: result.hash,
      success: result.success, error: result.error, previousPath: result.previousPath, absolutePath: result.absolutePath, deferred: true,
      instruction: '来源已更新，旧读取凭证失效。使用 read_skill 或 read_skill_reference 重新读取后再执行相关操作。' });
  }
  return documents;
}
function skillUpdateFrame(session) {
  const documents = boundSkillUpdates(session);
  if (!documents.length) return '';
  return '\n<updated-skill-sources>以下仅是本轮显式读取或声明的 Skill 依赖更新，不是用户新指令或新授权。历史读取记录不构成本轮依赖，不要追读无关旧Skill。其当前版本取代历史同名文件。deferred=true 表示正文未注入；按Skill执行的调用必须声明skillContext；其入口或必读文件失效时须重新读取。普通调用不继承历史Skill依赖。完整加载且显式声明的Skill只校验自身依赖，无关历史Skill不阻断；声明了依赖就必须完整加载，不能用虚构或部分读取替代。可选参考只影响依赖它的调用；停止和只读回执查询可继续。complete=false 只表示目录，必须读取完整入口或必读文件；success=false 表示来源不可用，禁止继续按旧正文执行。不要重做已完成操作。\n'
    + JSON.stringify(documents) + '\n</updated-skill-sources>';
}
// This gate uses source/read state only, never business text or tool arguments.
function skillEntryVersions(session) {
  return Object.fromEntries(Object.entries(session.skillReads || {}).filter(([key])=>key.endsWith(':SKILL.md'))
    .map(([key,read])=>[key,JSON.stringify([read.hash,read.absolutePath])]));
}
function assertSkillUpdatesRead(session, toolName, skillContext, {executesOperation=true, entryVersions}={}) {
  if (['read_skill', 'read_skill_reference', 'stop_task', 'stop_operation', 'cancel_operation'].includes(toolName)) return;
  const name=skillContext?.name && canonicalSkillName(skillContext.name);
  // Skill freshness is a dependency check, not a global execution lock.
  // Ordinary tools have no declared Skill dependency; approval and argument
  // validation still apply independently in the runtime.
  if (!name) return;
  if(session.skillCatalogView?.complete===false)throw Object.assign(Error('当前Skill目录扫描未完成，所声明依赖尚不能核验；普通工具不受影响'),{code:'SKILL_CATALOG_UNAVAILABLE'});
  const entry=session.skillReads?.[`${name}:SKILL.md`];
  // A known, fully read dependency scopes the operation. An omitted, invented or
  // incomplete context cannot be used to evade outstanding source updates.
  let scoped=false,dependencies;
  if(name)try{dependencies=assertSkillRead(session,{...skillContext,name});scoped=true;}catch(error){
    throw Object.assign(Error(`Skill 来源变更尚未重新加载或当前依赖未完整读取：${error.message}`),{code:'SKILL_RELOAD_REQUIRED',skillReload:{documents:[{name,file:'SKILL.md'}],executed:false}});
  }

  const files=new Set(['SKILL.md',...(entry?.requiredReading || []),...(skillContext?.files || [])].map(file=>canonicalSkillFile(name,file)));
  if(!dependencies)dependencies=new Map([[name,files]]);
  const pending=new Map();
  for(const item of Object.values(session.skillUpdates || {})) {
    // An unavailable historical Skill is not a dependency of an unscoped command.
    if(item.success===false && !session.skillReads?.[`${item.name}:SKILL.md`] && !dependencies.has(item.name))continue;
    const required=session.skillReads?.[`${item.name}:SKILL.md`]?.requiredReading || [];
    const critical=item.file==='SKILL.md' || required.some(file=>canonicalSkillFile(item.name,file)===item.file);
    if(executesOperation && critical && (!scoped || dependencies.has(item.name)) || dependencies.get(item.name)?.has(item.file))pending.set(`${item.name}:${item.file}`,item);
  }
  // A partial reread clears the update notice, but is not a completed reload.
  // Newly required references may not have a previous update notice at all.
  if(executesOperation)for(const [key,read] of Object.entries(session.skillReads || {})){
    if(!key.endsWith(':SKILL.md'))continue;
    const skill=key.slice(0,-':SKILL.md'.length);
    if(!session.skillEpochs?.[skill] || scoped && !dependencies.has(skill))continue;
    for(const file of ['SKILL.md',...(read.requiredReading || [])].map(file=>canonicalSkillFile(skill,file)))
      if(!session.skillReads?.[`${skill}:${file}`]?.complete)pending.set(`${skill}:${file}`,{name:skill,file});
  }
  if(pending.size)throw Object.assign(Error(`Skill 来源变更尚未重新加载，当前调用未执行：${[...pending.values()].map(item=>`${item.name}/${item.file}`).join(', ')}。请先用read_skill/read_skill_reference完整重读；不要重做已完成操作。`),
    {code:'SKILL_RELOAD_REQUIRED',skillReload:{documents:[...pending.values()].map(({name,file})=>({name,file})),executed:false}});
  if(executesOperation && entryVersions){
    const current=skillEntryVersions(session);
    if(Object.entries(entryVersions).some(([key,version])=>{const skill=key.slice(0,-':SKILL.md'.length);const unavailable=session.skillUpdates?.[key]?.success===false && !current[key];return (!unavailable || dependencies.has(skill)) && (!scoped || dependencies.has(skill)) && current[key]!==version;}))throw Object.assign(Error('Skill 入口在生成本次调用后已更新；当前调用未执行。请根据已重读的新版本重新规划，不重做已完成操作。'),{code:'SKILL_PLAN_STALE'});
  }
}
module.exports = { refreshLoadedSkills, skillUpdateFrame, assertSkillUpdatesRead, skillEntryVersions };
