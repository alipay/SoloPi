const {createHash}=require('node:crypto');
// Schema projection only. Discovery never executes tools or grants permission.
function createToolSurface(session, available) {
 const revision=()=>createHash('sha256').update(JSON.stringify(available().map(t=>({name:t.name,description:t.description,schema:t.schema,confirm:!!t.confirm})))).digest('hex').slice(0,16);
 const current=()=>{
  const latestUser=session.messages.findLastIndex(m=>m.role==='user');
  const scopeKey=session.messages[latestUser]?.createdAt || String(latestUser);
  const catalogRevision=revision();
  if(session.toolSurface?.scopeKey!==scopeKey || (session.toolSurface.catalogRevision && session.toolSurface.catalogRevision!==catalogRevision))session.toolSurface={scopeKey,names:[]};
  session.toolSurface.catalogRevision=catalogRevision;
  return session.toolSurface;
 };
 const eligible=()=>available();
 const expose=()=>eligible();
 const discover={name:'discover_tools',description:'查询当前工具目录和参数。全部可用工具已直接提供完整参数，无需先查询即可调用。查询不执行工具、不产生授权。',schema:{type:'object',properties:{names:{type:'array',items:{type:'string',minLength:1,maxLength:200},minItems:1,maxItems:12,uniqueItems:true},query:{type:'string',maxLength:200},offset:{type:'integer',minimum:0}},additionalProperties:false},execute:args=>{
  const state=current(),all=eligible(),requested=args.names || [];
  const missing=requested.filter(name=>!all.some(t=>t.name===name));
  if(missing.length)return{success:false,error:'工具不存在或当前请求不可用',missing};
  state.names=[...new Set([...state.names,...requested])].slice(-24);
  const q=(args.query || '').toLowerCase(),offset=args.offset || 0;
  const matches=all.filter(t=>!q || `${t.name} ${t.description}`.toLowerCase().includes(q));
  return{success:true,catalogRevision:state.catalogRevision,loaded:requested,total:matches.length,nextOffset:offset+20<matches.length?offset+20:null,tools:(requested.length?all.filter(t=>requested.includes(t.name)):matches.slice(offset,offset+20)).map(t=>({name:t.name,description:(t.description || '').slice(0,160),requiresConfirmation:!!t.confirm,...(requested.length?{parameters:t.schema}:{})}))};
 }};
 return{discover,tools:()=>[...expose(),discover],frame:()=>{
  const provenance='\n<tool-catalog-state>'+JSON.stringify({catalogRevision:current().catalogRevision,source:'current-process',historyIsCurrentContract:false})+'\n当前进程工具schema决定可用能力；历史回执及外部CLI帮助不代表此入口当前契约。参数以当前schema为准，不能沿用旧接口要求或猜测字段。\n</tool-catalog-state>';
  return provenance+'\n设备角色：phone = 手机；glasses = 眼镜设备（smart glasses）。眼镜端使用glasses字段，称为眼镜端。\n全部当前可用工具的完整参数已随本次请求提供，可直接调用；discover_tools仅供查询，无需先加载。';
 }};
}
module.exports={createToolSurface};
