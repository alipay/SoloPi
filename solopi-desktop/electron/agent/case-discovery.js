// Discovery is a small, current-state index. Full documents remain available via read_case.
function listCases(state, args = {}, domain = '') {
  const libraries = state.caseLibraries || [], folders = state.caseFolders || [];
  if (args.libraryId && !libraries.some(x => x.id === args.libraryId)) return { success: false, error: '用例库不存在' };
  if (args.folderId && !folders.some(x => x.id === args.folderId && (!args.libraryId || x.libraryId === args.libraryId))) return { success: false, error: '目录不存在或不属于指定用例库' };
  for(const key of ['excludeFolderIds','excludeCaseIds']) if(args[key]!==undefined&&(!Array.isArray(args[key])||args[key].some(id=>typeof id!=='string'||!id)))return {success:false,error:`${key}必须是非空ID数组`};
  if((args.excludeFolderIds?.length||args.excludeCaseIds?.length)&&!args.libraryId)return {success:false,error:'排除范围必须指定libraryId'};
  if((args.excludeFolderIds||[]).some(id=>!folders.some(f=>f.id===id&&f.libraryId===args.libraryId)))return {success:false,error:'排除目录不存在或不属于指定用例库'};
  const excludedFolders=new Set(args.excludeFolderIds||[]),excludedCases=new Set(args.excludeCaseIds||[]);
  const byFolder = new Map(folders.map(x => [x.id, x]));
  const byLibrary = new Map(libraries.map(x => [x.id, x]));
  const ancestors = id => {
    const result = [], seen = new Set();
    while (id && !seen.has(id)) {
      seen.add(id);
      const folder = byFolder.get(id);
      if (!folder) break;
      result.push(folder); id = folder.parentId;
    }
    return result;
  };
  const query = (args.query || '').trim().toLowerCase();
  const matches = value => String(value || '').toLowerCase().includes(query);
  const cases = (state.cases || []).filter(c => {
    const parents = ancestors(c.folderId);
    const libraryId = c.libraryId || parents.find(f => f.libraryId)?.libraryId;
    return !excludedCases.has(c.id)&&!parents.some(f=>excludedFolders.has(f.id))&&(!args.libraryId || libraryId === args.libraryId)
      && (!args.folderId || parents.some(f => f.id === args.folderId))
      && (!query || matches(c.name) || matches(c.id) || matches(byLibrary.get(libraryId)?.name) || parents.some(f => matches(f.name)));
  });
  const offset = args.offset || 0, end = offset + (args.limit || 20);
  const page = cases.slice(offset, end).map(c => ({ id: c.id, name: c.name, libraryId: c.libraryId || ancestors(c.folderId).find(f => f.libraryId)?.libraryId, folderId: c.folderId, reviewStatus: c.reviewStatus }));
  // Include navigation relevant to this page, never repository credentials or component documents.
  const relatedFolders = new Set(page.flatMap(c => ancestors(c.folderId).map(f => f.id)));
  const relatedLibraries = new Set(page.map(c => c.libraryId));
  const selectors = Object.fromEntries(Object.entries({libraryId:args.libraryId,folderId:args.folderId,query:query || undefined,excludeFolderIds:[...excludedFolders].sort(),excludeCaseIds:[...excludedCases].sort()}).filter(([,v])=>v!==undefined));
  const selection = require('./selection-receipt').create(state, selectors, cases.map(c=>c.id), domain);
  return {
    ...selection,
    success: true, scopeSummary:require('./case-scope-summary').summarize(state,cases.map(c=>c.id)).map(({caseIds,...group})=>group), total: cases.length, nextOffset: end < cases.length ? end : null,
    caseIds: page.map(c => c.id), cases: page,
    libraries: libraries.filter(l => relatedLibraries.has(l.id) || (args.libraryId ? l.id === args.libraryId : matches(l.name))).slice(0, 50).map(({ id, name, gitBranch, branch }) => ({ id, name, branch: gitBranch || branch })),
    folders: folders.filter(f => relatedFolders.has(f.id) || ((!args.libraryId || f.libraryId === args.libraryId) && (args.folderId ? f.id === args.folderId : matches(f.name)))).slice(0, 50).map(({ id, name, libraryId, parentId }) => ({ id, name, libraryId, parentId })),
  };
}
module.exports = { listCases };
