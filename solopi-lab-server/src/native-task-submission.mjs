// Resolve current catalog identities before the atomic task/command transaction.
export async function submitNativeTask(lab,scope,input){
 let normalized;
 try{
  const catalog=lab.catalog(scope,input.clientId);
  const exact=catalog.groups.filter(g=>!g.deleted&&g.groupId===input.groupId);
  const matches=exact.length?exact:catalog.groups.filter(g=>!g.deleted&&g.name===input.groupId);
  if(matches.length!==1)throw Object.assign(Error(matches.length?'设备组名称不唯一，请使用目录中的groupId':'设备组不存在，请读取当前Client目录'),{code:matches.length?'GROUP_AMBIGUOUS':'GROUP_NOT_FOUND',status:422});
  if(matches[0].enabled===false)throw Object.assign(Error('设备组已停用'),{code:'GROUP_DISABLED',status:422});
  normalized={...input,groupId:matches[0].groupId};
 }catch(error){error.submissionOutcome='not-submitted';throw error;}
 try{return await lab.createTask(scope,normalized);}catch(error){
  // Domain validation errors roll back the atomic task+command transaction.
  // Transport, storage and acknowledgement failures remain unknown.
  if(Number.isInteger(error.status)&&error.status>=400&&error.status<500)error.submissionOutcome='not-submitted';
  throw error;
 }
}
