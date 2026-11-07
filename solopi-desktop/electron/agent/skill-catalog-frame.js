const {createHash}=require('node:crypto');
// Mirror the upstream separation: catalog metadata is current availability,
// loaded instruction bodies remain on-demand tool receipts, never this frame.
function updateSkillCatalog(session,catalog,roots) {
 const complete=!(catalog.diagnostics || []).some(d=>roots.includes(d.directory));
 if(!complete){session.skillCatalogView={...session.skillCatalogView,complete:false};return;}
 const entries=catalog.skills.filter(s=>s.enabled).map(s=>({name:s.name,description:s.description.replace(/\s+/g,' ').slice(0,160)})).sort((a,b)=>a.name.localeCompare(b.name));
 const revision=createHash('sha256').update(JSON.stringify(entries)).digest('hex');
 session.skillCatalogView={revision,complete:true,entries};
}
function skillCatalogFrame(session) {
 const catalog=session.skillCatalogView;if(!catalog)return '';
 if(!catalog.complete)return '\n<current-skill-catalog>当前目录扫描未完整完成，不得据此推断任何Skill已删除；按需重试对应加载，普通工具不受目录扫描影响。</current-skill-catalog>';
 return '\n<current-skill-catalog>此完整可用目录取代历史目录；只使用其中的准确名称。这里只是路由摘要，正文须按当前任务需要用read_skill加载，不推断未读规则。历史加载记录不是当前依赖，不追读无关历史Skill；已加载且未变化的正文可复用。缺失只影响对应Skill加载或显式依赖调用，不能用“门禁失败”推断CLI不存在。\n'+JSON.stringify(catalog)+'\n</current-skill-catalog>';
}
module.exports={updateSkillCatalog,skillCatalogFrame};
