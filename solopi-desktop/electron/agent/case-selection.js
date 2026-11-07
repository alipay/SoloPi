const {listCases}=require('./case-discovery');
function resolveCaseSelection(state,args,domain=''){
  if(args.selectionId){
    if(['caseIds','libraryId','folderId','query','excludeFolderIds','excludeCaseIds'].some(k=>args[k]!==undefined))throw Object.assign(Error('selectionId不能与另一种查询范围混用'),{code:'SELECTION_SOURCE_CONFLICT'});
    const receipt=require('./selection-receipt').decode(state,args.selectionId,domain);
    const current=listCases(state,{...receipt.selectors,limit:Math.max(1,(state.cases||[]).length)},domain);
    if(!current.success)throw Object.assign(Error(current.error),{code:'SELECTION_SOURCE_UNAVAILABLE'});
    if(current.selectionRevision!==receipt.membership)throw Object.assign(Error('选择成员已变化，请重新查询；未提交任务'),{code:'SELECTION_MEMBERS_CHANGED'});
    if(!current.caseIds.length)throw Error('提交范围没有用例，任务未提交。');
    if(args.expectedCaseCount!==undefined&&args.expectedCaseCount!==current.total)throw Error('选择数量与expectedCaseCount不一致，未提交任务');
    return current.caseIds;
  }
  if(Boolean(args.caseIds)===Boolean(args.libraryId))throw Error('请仅选择caseIds或libraryId一种提交范围。');
  let ids=args.caseIds;
  if(args.libraryId){
    if(!Number.isSafeInteger(args.expectedCaseCount)||args.expectedCaseCount<1)throw Error('按库提交必须提供已核对的expectedCaseCount。');
    const result=listCases(state,{...args,limit:Math.max(1,(state.cases||[]).length)});
    if(!result.success)throw Error(result.error);
    ids=result.caseIds;
    if(args.expectedSelectionRevision && args.expectedSelectionRevision!==result.selectionRevision)throw Object.assign(Error('用例范围已变化（成员发生变化）；任务未提交，请重新查询范围。'),{code:'SELECTION_MEMBERS_CHANGED'});
  }else if(args.folderId||args.excludeFolderIds?.length||args.excludeCaseIds?.length)throw Error('folderId只能与libraryId共同使用。');
  if(!Array.isArray(ids)||!ids.length)throw Error('提交范围没有用例，任务未提交。');
  if(new Set(ids).size!==ids.length)throw Error('caseIds 含重复用例，任务未提交。请使用发现结果中的唯一ID；按轮重复执行使用stress rounds参数。');
  if(args.expectedCaseCount!==undefined&&ids.length!==args.expectedCaseCount)throw Error(`用例范围已变化：期望${args.expectedCaseCount}条，当前${ids.length}条；任务未提交，请重新核对范围。`);
  const live=new Set((state.cases||[]).map(c=>c.id));
  for(const id of ids)if(!live.has(id))throw Error(`用例不存在：${id}；请使用当前list_cases，不从Git文件或历史记录恢复清单。`);
  return ids;
}
module.exports={resolveCaseSelection};
