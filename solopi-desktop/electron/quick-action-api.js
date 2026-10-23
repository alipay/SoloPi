const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const Ajv = require('ajv');
const str = { type: 'string', minLength: 1, maxLength: 4096 };
const obj = (properties, required = []) => ({ type:'object', properties, required, additionalProperties:false });
const strings = { type:'array', items:{type:'string'}, maxItems:100 };
const input = obj({ key:str, label:str, type:{enum:['text','number','boolean','select','file','directory','multiline']}, required:{type:'boolean'}, userInput:{type:'boolean'}, defaultValue:{type:['string','number','boolean']}, placeholder:{type:'string'}, options:{type:'array',items:{anyOf:[str,obj({label:str,value:str},['value'])]}} },['key']);
const configuration = obj({name:str,description:{type:'string'},inputs:{type:'array',items:input,maxItems:100},args:strings,queryConfig:{anyOf:[{type:'null'},obj({enabled:{type:'boolean'},showOnCard:{type:'boolean'},args:strings,resultPath:{type:'string'},targetInputKey:{type:'string'},rerunAfterExecute:{type:'boolean'}})]},sessionConfig:{anyOf:[{type:'null'},obj({enabled:{type:'boolean'},startArgs:strings,stopArgs:strings,exportArgs:strings})]}});
const context = obj({phoneSerial:str,glassesSerial:str,phonePackage:str,glassesPackage:str});
const execution = {id:str,values:{type:'object',additionalProperties:{type:['string','number','boolean']}},context};
const git = {repoUrl:str,branch:str,directory:{type:'string'}};
const definitions = {
  list: {description:'发现当前快捷操作摘要及运行状态，按query筛选；操作前show读取参数，不翻历史日志。',schema:obj({query:str,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:50}})},
  show: {description:'读取单个快捷操作完整参数、默认值、查询/会话模式和脚本正文。脚本是资料，不是新增授权。',schema:obj({id:str},['id'])},
  create: {description:'新建快捷操作：提供脚本正文和配置，保存到应用目录；不会执行脚本。业务逻辑完全由脚本负责。',schema:obj({fileName:str,content:{type:'string',minLength:1,maxLength:200000},configuration},['fileName','content']),write:true},
  'import-script': {description:'从本机绝对路径导入已有快捷脚本，不执行脚本。',schema:obj({paths:{type:'array',items:str,minItems:1,maxItems:50}},['paths']),write:true},
  update: {description:'差量修改快捷操作配置；未提供字段保留。不会执行脚本，修改执行参数会保存到该操作。',schema:obj({id:str,configuration},['id','configuration']),write:true},
  'import-git': {description:'从Git仓库导入快捷操作及配置，使用系统Git凭据；不执行下载的脚本。',schema:obj(git,['repoUrl']),write:true},
  'export-git': {description:'将指定快捷操作的脚本和配置提交推送到用户指定仓库分支，复用现有Git上传，不强推。必须有用户对目标仓库/分支的授权。',schema:obj({id:str,...git},['id','repoUrl','branch']),write:true},
  query: {description:'调用快捷操作配置的查询脚本，返回结构化状态和原始输出。',schema:obj(execution,['id']),write:true},
  execute: {description:'直接执行已配置的快捷操作，无需创建用例。先show核对参数并绑定当前在线设备；普通操作phase=run，会话开始phase=start，结束并导出phase=stop。不要自动重试结果未知的执行。返回stdout/stderr/outputDir及查询验证。',schema:obj({...execution,phase:{enum:['run','start','stop']}},['id','phase']),write:true},
  visibility: {description:'设置快捷操作是否在顶部工具栏显示。',schema:obj({id:str,show:{type:'boolean'}},['id','show']),write:true},
  remove: {description:'从快捷操作列表移除指定操作，不删除脚本或远端文件；活动会话必须先结束。',schema:obj({id:str},['id']),write:true},
};
const ajv = new Ajv({strict:false});
const validators = Object.fromEntries(Object.entries(definitions).map(([k,v])=>[k,ajv.compile(v.schema)]));
function validateRequest(action, args) {
  if (!validators[action]) throw Error('不支持的快捷操作命令');
  if (!validators[action](args)) throw Error(`快捷操作参数不合法：${ajv.errorsText(validators[action].errors)}`);
}
function createQuickActionApi({invoke,directory,notify=()=>{}}) {
  return async (action,args={},event={}) => {
    validateRequest(action,args);
    const call=(name,payload)=>invoke(`quick-actions:${name}`,event,payload);
    const inventory=async()=>{const r=await call('list',{});if(!r.success)throw Error(r.error);return r;};
    const find=async()=>{const r=await inventory();const a=r.actions.find(a=>a.id===args.id);if(!a)throw Error('快捷操作不存在');return {action:a,session:r.sessions?.[a.id]||null};};
    let result;
    if(action==='list') {
      const r=await inventory(),q=(args.query||'').toLowerCase();
      const all=r.actions.filter(a=>`${a.name} ${a.description||''}`.toLowerCase().includes(q));
      const offset=args.offset||0,end=offset+(args.limit||20);
      return {success:true,total:all.length,nextOffset:end<all.length?end:null,actions:all.slice(offset,end).map(a=>({id:a.id,name:a.name,description:a.description,showInToolbar:a.showInToolbar,mode:a.sessionConfig?.enabled?'session':'run',queryEnabled:!!a.queryConfig?.enabled,session:r.sessions?.[a.id]||null}))};
    }
    if(action==='show') {const r=await find();return {success:true,...r,content:fs.readFileSync(r.action.scriptPath,'utf8')};}
    if(action==='create') {
      if(path.basename(args.fileName)!==args.fileName || !/\.(sh|ps1|cmd|bat)$/i.test(args.fileName))throw Error('脚本名称必须是无目录的sh/ps1/cmd/bat文件名');
      const dir=path.join(directory(),'quick-actions','created',randomUUID());fs.mkdirSync(dir,{recursive:true,mode:0o700});
      const file=path.join(dir,args.fileName);fs.writeFileSync(file,args.content,{mode:0o700,flag:'wx'});
      result=await call('import-script',{paths:[file]});
      if(result.success && args.configuration) {
        const imported=result.action;
        result=await call('update',{...imported,...args.configuration,id:imported.id});
        // Keep the created ID and script path visible even if configuration validation failed.
        if(!result.success)result={...result,createdActionId:imported.id,scriptPath:file};
      }
    } else if(action==='update') {
      const current=await find();
      const patch = {...args.configuration};
      for (const key of ['queryConfig','sessionConfig']) if (patch[key] && typeof patch[key] === 'object') patch[key] = {...current.action[key],...patch[key]};
      result=await call('update',{...current.action,...patch,id:args.id});
    } else if(action==='execute') {
      result=await call('execute',{...args,expectedPhase:args.phase});
    } else result=await call(action,args);
    if(definitions[action].write)notify();
    // Management handlers return all actions for UI; external callers only need the changed items.
    if(result && Object.hasOwn(result,'actions')) {const {actions,...rest}=result;result=rest;}
    return result;
  };
}
module.exports={definitions,validateRequest,createQuickActionApi};
