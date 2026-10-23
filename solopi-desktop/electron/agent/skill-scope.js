const {canonicalSkillName}=require('./skill-names');
// Read receipts are durable provenance, not an implicit dependency list. A new
// human request starts with no active Skills; a continuation can reuse a receipt
// by explicitly declaring it, without rereading unchanged files.
function skillScope(session) {
 const userIndex=(session.messages || []).findLastIndex(m=>m.role==='user' && m.source!=='platform');
 if(session.activeSkillScope?.version!==1 || session.activeSkillScope.userIndex!==userIndex)
  session.activeSkillScope={version:1,userIndex,names:[]};
 return session.activeSkillScope;
}
function activateSkills(session,names) {
 const scope=skillScope(session);
 scope.names=[...new Set([...scope.names,...names.map(canonicalSkillName).filter(name=>typeof name==='string'&&name)])];
}
function activeSkillNames(session) {return new Set(skillScope(session).names.map(canonicalSkillName));}
module.exports={skillScope,activateSkills,activeSkillNames};
