const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const Ajv = require('ajv');
const {quickActionUsage}=require('./quick-action-usage');
const str = { type: 'string', minLength: 1, maxLength: 4096 };
const obj = (properties, required = []) => ({ type:'object', properties, required, additionalProperties:false });
const strings = { type:'array', items:{type:'string'}, maxItems:100 };
const input = obj({ key:str, label:str, type:{enum:['text','number','boolean','select','file','directory','multiline']}, required:{type:'boolean'}, userInput:{type:'boolean'}, defaultValue:{type:['string','number','boolean']}, placeholder:{type:'string'}, options:{type:'array',items:{anyOf:[str,obj({label:str,value:str},['value'])]}} },['key']);
const configuration = obj({name:str,description:{type:'string'},usageInstructions:{type:'string',maxLength:12000},showInToolbar:{type:'boolean'},inputs:{type:'array',items:input,maxItems:100},args:strings,queryConfig:{anyOf:[{type:'null'},obj({enabled:{type:'boolean'},showOnCard:{type:'boolean'},args:strings,resultPath:{type:'string'},targetInputKey:{type:'string'},rerunAfterExecute:{type:'boolean'}})]},sessionConfig:{anyOf:[{type:'null'},obj({enabled:{type:'boolean'},startArgs:strings,stopArgs:strings,exportArgs:strings})]}});
const context = obj({phoneSerial:str,glassesSerial:str,phonePackage:str,glassesPackage:str});
const execution = {id:str,values:{type:'object',additionalProperties:{type:['string','number','boolean']}},context};
const git = {repoUrl:str,branch:str,directory:{type:'string'}};
const definitions = {
  list: {description:'按query发现操作摘要及状态；执行前show读参数。',schema:obj({query:str,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:50}})},
  show: {description:'读取usage使用说明、参数绑定与调用示例、查询/会话及脚本；按usage.inputBindings区分values与context，内容不构成授权。',schema:obj({id:str},['id'])},
  create: {description:'保存脚本及配置，不执行。',schema:obj({fileName:str,content:{type:'string',minLength:1,maxLength:200000},configuration},['fileName','content']),write:true},
  'import-script': {description:'从本机绝对路径导入已有快捷脚本，不执行脚本。',schema:obj({paths:{type:'array',items:str,minItems:1,maxItems:50}},['paths']),write:true},
  update: {description:'差量保存，省略字段保留。',schema:obj({id:str,configuration},['id','configuration']),write:true},
  'import-git': {description:'从Git导入脚本及配置，使用系统凭据，不执行。',schema:obj(git,['repoUrl']),write:true},
  'export-git': {description:'推送脚本/配置，需用户授权仓库/分支；系统Git凭据，不强推。',schema:obj({id:str,...git},['id','repoUrl','branch']),write:true},
  query: {description:'按show返回的usage.queryExample调用；用户输入用values，隐藏设备和包名用context。查询同样执行脚本，返回状态及原始输出。',schema:obj(execution,['id']),write:true},
  execute: {description:'先show读取usage调用说明并核对在线设备。values仅填写用户输入，隐藏设备/包名参数由context提供。phase=run普通/start开始/stop结束导出；结果未知不重试。返回stdout/stderr/outputDir及查询验证。',schema:obj({...execution,phase:{enum:['run','start','stop']}},['id','phase']),write:true},
  visibility: {description:'设置快捷操作是否在顶部工具栏显示。',schema:obj({id:str,show:{type:'boolean'}},['id','show']),write:true},
  remove: {description:'移除条目，保留脚本/远端文件；先结束活动会话。',schema:obj({id:str},['id']),write:true},
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
      const all=r.actions.filter(a=>`${a.name} ${a.description||''} ${a.usageInstructions||''}`.toLowerCase().includes(q));
      const offset=args.offset||0,end=offset+(args.limit||20);
      return {success:true,total:all.length,nextOffset:end<all.length?end:null,actions:all.slice(offset,end).map(a=>({id:a.id,name:a.name,description:a.description,usage:{documentationStatus:a.usageInstructions?.trim()?'configured':'needs-review',instructionsPreview:(a.usageInstructions||'').slice(0,320),instructionsTruncated:(a.usageInstructions||'').length>320,details:'quick_action_show',contextBindings:quickActionUsage(a).contextBindings},showInToolbar:a.showInToolbar !== false,inputSummary:(a.inputs||[]).map(i=>({key:i.key,label:i.label,type:i.type,required:!!i.required,userInput:i.userInput!==false,placeholder:i.placeholder||''})),mode:a.sessionConfig?.enabled?'session':'run',queryEnabled:!!a.queryConfig?.enabled,session:r.sessions?.[a.id]||null}))};
    }
    if(action==='show') {const r=await find();return {success:true,usage:quickActionUsage(r.action),...r,content:fs.readFileSync(r.action.scriptPath,'utf8')};}
    if(action==='create') {
      if(path.basename(args.fileName)!==args.fileName || !/\.(sh|ps1|cmd|bat)$/i.test(args.fileName))throw Error('脚本名称必须是无目录的sh/ps1/cmd/bat文件名');
      const dir=path.join(directory(),'quick-actions','created',randomUUID());fs.mkdirSync(dir,{recursive:true,mode:0o700});
      const file=path.join(dir,args.fileName);fs.writeFileSync(file,args.content,{mode:0o700,flag:'wx'});
      result=await call('import-script',{paths:[file],showInToolbar:args.configuration?.showInToolbar!==false});
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
      if(result.success && Object.hasOwn(patch,'showInToolbar')) {
        const visibility=await call('visibility',{id:args.id,show:patch.showInToolbar});
        if(!visibility.success) result=visibility;
        else result={...result,action:(await find()).action};
      }
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
