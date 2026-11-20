// Sizes only: no prompt, argument, Skill text or credentials enter diagnostics.
const size=value=>typeof value==='string'?value.length:JSON.stringify(value ?? '').length;
function footprint(session,messages,tools,system){
  const skillCalls=new Set((session.calls || []).filter(c=>['read_skill','read_skill_reference'].includes(c.name)).map(c=>c.modelCallId));
  const systemCharacters=messages.filter(m=>m.role==='system').reduce((n,m)=>n+size(m.content),0);
  const historyCharacters=messages.filter(m=>m.role!=='system').reduce((n,m)=>n+size(m.content),0);
  const skillCharacters=messages.filter(m=>m.role==='tool'&&skillCalls.has(m.tool_call_id)).reduce((n,m)=>n+size(m.content),0);
  return {basePromptRevision:require('node:crypto').createHash('sha256').update(system).digest('hex').slice(0,16),systemCharacters,basePromptCharacters:size(system),toolSchemaCharacters:JSON.stringify(tools).length,historyCharacters,skillCharacters,
    workStateCharacters:size(session.workState),beforeTokensEstimate:require('./request-policy').inputEstimate(messages,tools)};
}
module.exports={footprint};
