// Only trusted registered tool metadata can refine host-wide Skill dependencies.
// This is not a request argument and does not grant operation authorization.
export function requiredSkillsForTool(tool,defaults=[]){
 const names=tool?.requiredSkills??defaults;
 if(!Array.isArray(names)||names.some(name=>typeof name!=='string'||!name.trim()))
  throw Object.assign(Error('Invalid registered tool Skill dependencies'),{code:'TOOL_SKILL_REQUIREMENTS_INVALID'});
 return names;
}
