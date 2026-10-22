function summarize(state, ids){
 const folders=new Map((state.caseFolders||[]).map(f=>[f.id,f]));
 const libraries=new Map((state.caseLibraries||[]).map(l=>[l.id,l]));
 const cases=new Map((state.cases||[]).map(c=>[c.id,c]));
 const groups=new Map();
 for(const id of ids){
  const c=cases.get(id);let libraryId=c?.libraryId,folderId=c?.folderId;const seen=new Set();
  while(!libraryId&&folderId&&!seen.has(folderId)){seen.add(folderId);const f=folders.get(folderId);libraryId=f?.libraryId;folderId=f?.parentId;}
  const key=libraryId||null;
  if(!groups.has(key))groups.set(key,{libraryId:key,libraryName:libraries.get(key)?.name||null,caseCount:0,caseIds:[]});
  const group=groups.get(key);group.caseCount++;group.caseIds.push(id);
 }
 return [...groups.values()];
}
module.exports={summarize};
