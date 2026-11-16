const {randomUUID}=require('node:crypto');
const str={type:'string',minLength:1,maxLength:1000};
const schema=(properties,required=[])=>({type:'object',additionalProperties:false,properties,required});
const definitions={
 list:{schema:schema({}),description:'列出用例库及Git仓库、分支、用例数量，不返回凭据。'},
 configure:{schema:schema({library:str,name:str,repoUrl:str,branch:str,create:{type:'boolean'},dryRun:{type:'boolean'}},['library']),description:'创建或修改用例库Git配置；create=true才新建。默认只更新明确提供的字段，保留用例和凭据。dryRun仅预览，不访问远端、不拉取推送。'},
 pull:{schema:schema({library:str,dryRun:{type:'boolean'}},['library']),description:'从已配置用例仓库拉取并导入该库及素材，不执行测试。dryRun会读远端/缓存但不写用例；先核对数量与commit，远端未提交的本机修改不会自动同步。'},
 push:{schema:schema({library:str,message:str,dryRun:{type:'boolean'}},['library','message']),description:'将指定用例库和素材提交并推送到已配置Git分支；不是快捷操作脚本。须用户明确授权推送；先dryRun核对变更，失败/回执不明不自动重试，不强推。'}
};
function publicLibrary(library,state){const folders=(state.caseFolders||[]).filter(f=>f.libraryId===library.id);const ids=new Set(folders.map(f=>f.id));return {id:library.id,libraryId:library.id,name:library.name,repoUrl:library.repoUrl||'',branch:library.gitBranch||library.branch||'master',caseCount:(state.cases||[]).filter(c=>ids.has(c.folderId)).length,folderCount:folders.length};}
function selection(state,selector){const matches=(state.caseLibraries||[]).filter(l=>l.id===selector||l.name===selector);if(matches.length!==1)throw Object.assign(Error(matches.length?'用例库名称不唯一，请使用ID':'用例库不存在；新建请显式create'),{code:'CASE_LIBRARY_SELECTION_FAILED'});return matches[0];}
function configureLibrary(state,args){
 const old=args.create?null:selection(state,args.library);
 if(args.create && (state.caseLibraries||[]).some(l=>l.id===args.library||l.name===args.library))throw Error('用例库已存在，不可重复创建');
 if(args.repoUrl!==undefined){const url=args.repoUrl;if(/[\x00-\x20]/.test(url)||!(/^(https?:\/\/|ssh:\/\/|file:\/\/|[^@\s]+@[^:]+:)/.test(url)))throw Error('仓库地址需要HTTP(S)、SSH或file URL');if(/^https?:/.test(url)){const parsed=new URL(url);if(parsed.username||parsed.password||parsed.search||parsed.hash)throw Error('仓库URL不允许内嵌凭据、查询参数或片段；使用系统Git认证');}}
 if(args.branch!==undefined && (/^[.-]|\.\.|[\s~^:?*\[\\\x00-\x1f]|@\{|\/$|\.lock$/.test(args.branch)))throw Error('Git分支名无效');
 if(args.create&&!args.repoUrl)throw Error('新建Git用例库需要repoUrl');
 const library={...(old||{id:args.library||randomUUID(),name:args.name||args.library,autoUpdate:false}),...(args.name!==undefined?{name:args.name}:{}),...(args.repoUrl!==undefined?{repoUrl:args.repoUrl}:{}),...(args.branch!==undefined?{branch:args.branch,gitBranch:args.branch}:{})};
 return {state:{...state,caseLibraries:[...(state.caseLibraries||[]).filter(l=>l.id!==library.id),library]},library};
}
function createCaseLibraryApi({readState,writeState,loadCodec,dataDir}){let busy=false;return async(action,args={})=>{
 const definition=definitions[action];if(!definition)throw Error('未知用例库操作');
 if(!new(require('ajv'))().validate(definition.schema,args))throw Error('用例库参数无效');
 if(action==='list'){const state=readState().state;return {success:true,libraries:(state.caseLibraries||[]).map(l=>publicLibrary(l,state))};}
 if(busy)return {success:false,errorCode:'CASE_LIBRARY_BUSY',error:'用例库正在同步，请等待当前操作完成'};
 busy=true;try{
  if(action==='configure'){const next=configureLibrary(readState().state,args);if(!args.dryRun)await writeState(next.state,['caseLibraries']);return {success:true,dryRun:!!args.dryRun,library:publicLibrary(next.library,next.state)};}
  const codec=await loadCodec(),command=['cases',action,'--library',args.library,...(args.dryRun?['--dry-run']:[]),...(args.message?['--message',args.message]:[])];
  return await codec[action==='pull'?'getCaseLibraryPullPayloadForCli':'getCaseLibraryPushPayloadForCli'](command,{readState,writeState,dataDir});
 }finally{busy=false;}
};}
module.exports={definitions,selection,configureLibrary,createCaseLibraryApi};
