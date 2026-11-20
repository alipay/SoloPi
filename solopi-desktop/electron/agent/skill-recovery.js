// Project an explicit stale Skill prerequisite into read-only model tools.
// Never load arbitrary Skills or replay the operation that was blocked.
function createSkillRecovery() {
 const names=new Set(),requested=new Map();
 const add=doc=>{if(doc?.name&&doc?.file){names.add(doc.name);requested.set(`${doc.name}:${doc.file}`,doc);}};
 return {
  reset(){names.clear();requested.clear();},
  observe(result){if(result?.errorCode==='SKILL_RELOAD_REQUIRED')for(const doc of result.skillReload?.documents||[])add(doc);},
  frame(session){
   const active=require('./skill-scope').activeSkillNames(session);
   for(const doc of Object.values(session.skillUpdates||{})) {
    const read=session.skillReads?.[`${doc.name}:SKILL.md`];
    if(active.has(doc.name)&&(doc.file==='SKILL.md'||read?.requiredReading?.includes(doc.file)))add(doc);
   }
   for(const name of names){
    const entry=session.skillReads?.[`${name}:SKILL.md`];
    if(!entry?.complete)add({name,file:'SKILL.md'});
    else for(const file of entry.requiredReading||[])if(!session.skillReads?.[`${name}:${file}`]?.complete)add({name,file});
   }
   for(const [key] of requested)if(session.skillReads?.[key]?.complete&&!session.skillUpdates?.[key])requested.delete(key);
   const documents=[...requested.values()].map(({name,file})=>({tool:file==='SKILL.md'?'read_skill':'read_skill_reference',arguments:file==='SKILL.md'?{name}:{name,file}}));
   return {documents,toolNames:[...new Set(documents.map(d=>d.tool))]};
  },
 };
}
module.exports={createSkillRecovery};
