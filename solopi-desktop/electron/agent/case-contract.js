const stepSchema = {
  type:'object', required:['id','type','device'], additionalProperties:true,
  properties:{
    id:{type:'string',minLength:1}, name:{type:'string'}, phase:{enum:['main','cleanup'],description:'cleanup区域按steps数组顺序始终执行，不能连业务边；失败不阻止后续清理节点。'},
    type:{enum:['start','if','component','launch_test_page','broadcast_scene','http_request','llm_text_generate','tts_synthesize','send_audio','wait','push_audio','debug_forward','rpc_assert','end']},
    device:{enum:['phone','glasses','pc']}, componentId:{type:'string'},
    inputs:{type:'object',description:'步骤参数；替换已有步骤时必须保留原值及类型，历史布尔参数不转字符串。显式 {} 表示清空。',additionalProperties:{anyOf:[{type:'string'},{type:'boolean'}]}},
    config:{type:'object'}, timeoutMs:{type:'number'}, postDelayMs:{type:'number'}, retry:{type:'integer'},
    continueOnError:{type:'boolean',description:'仅非断言操作节点适用'}, acceptedExitCodes:{type:'array',items:{type:'integer'}},
    onError:{enum:['fail','continue','branch']}, outputMapping:{type:'object'},
  },
};
const documentSchema = {type:'object',required:['id'],additionalProperties:false,properties:{
  id:{type:'string'},assetBaseDir:{type:'string'},name:{type:'string'},description:{type:'string'},schemaVersion:{type:'string'},
  folderId:{type:'string'},libraryId:{type:'string'},reviewStatus:{enum:['draft','confirmed']},conversionSource:{type:'object'},
  tags:{type:'array',items:{type:'string'}},variables:{type:'object'},defaults:{type:'object'},
  steps:{type:'array',minItems:2,items:stepSchema,description:'完整步骤数组，整体替换而非追加或按id合并；保留未修改步骤及所有原字段。'},
  edges:{type:'array',items:{type:'object',required:['source','target'],properties:{source:{type:'string'},target:{type:'string'}},additionalProperties:true}},
  components:{type:'array',items:{type:'object'},description:'完整用例私有组件数组；整体替换，不修改全局组件。'},
}};
const compactProperties={
 format:{const:'solopi.workflow.v2'},
 nodes:{type:'object',additionalProperties:{type:'object',required:['op','device'],properties:{op:stepSchema.properties.type,device:stepSchema.properties.device,use:{type:'object',required:['id'],properties:{id:{type:'string'},revision:{type:'string',pattern:'^[a-f0-9]{64}$'}},additionalProperties:false},args:{type:'object'},settings:{type:'object'},policy:{type:'object'},extra:{type:'object'},inherit:{type:'array',items:{type:'integer',minimum:0}},typedArgs:{type:'array',items:{type:'string'}}},additionalProperties:true}},
 cleanup:{type:'object'},routes:{type:'array',items:{type:'array',minItems:2,maxItems:3}},
 order:{type:'array',items:{type:'string'},uniqueItems:true},editor:{type:'object'},
 localComponents:{type:'array',items:{type:'string'}},componentVersions:{type:'object',additionalProperties:{type:'object'}},
};
Object.assign(documentSchema.properties,compactProperties);
documentSchema.allOf=[{if:{required:['format']},then:{required:['nodes','routes'],not:{required:['steps']}}}];
function assertPreservedStepFields(existing, document, components = []) {
  if (!existing || !Array.isArray(document?.steps)) return;
  existing = require('../workflow-failure-policy').normalizeCaseFailurePolicy(existing, components);
  const byId=new Map((existing.steps || []).map(s=>[s.id,s]));
  for(const step of document.steps) {
    const old=byId.get(step.id); if(!old) continue;
    const missing=Object.keys(old).filter(k=>old[k] !== undefined && !Object.hasOwn(step,k));
    if(missing.length) throw Error(`步骤 ${step.id} 替换遗漏原字段 ${missing.join(', ')}；读取原步骤并保留字段，需要清空时显式传空值。未保存。`);
  }
}
function readCase(state, {caseId, includeComponents='referenced',format='compact'}) {
  const stored=state.cases?.find(c=>c.id===caseId);if(!stored) throw Error('用例不存在');
  const c=require('../workflow-failure-policy').normalizeCaseFailurePolicy(require('../case-assets').withAssetContext(state,stored), state.components || []);
  const {components:local=[],...document}=c;
  const effective=new Map((state.components||[]).map(c=>[c.id,c]));
  for(const component of local) effective.set(component.id,component);
  const used=new Set((c.steps||[]).map(s=>s.componentId));
  const selected=includeComponents==='none'?[]:[...effective.values()].filter(c=>includeComponents==='all'||used.has(c.id));
  const localIds=new Set(local.map(component=>component.id));
  if(format==='compact'){
    const versions={},compact=require('../case-storage').encodeCase(includeComponents==='all'?c:document,state.caseEdges?.[caseId]||c.edges,[...(state.components||[]),...local],versions);
    return {case:{...compact,...(includeComponents==='all'?{componentVersions:versions}:{})},components:selected,componentSources:Object.fromEntries(selected.map(component=>[component.id,localIds.has(component.id)?'case':'global'])),componentScope:includeComponents,
      updateSemantics:'case是可保存的solopi.workflow.v2文档。nodes键为稳定节点ID，routes使用Object.keys(nodes)+Object.keys(cleanup)或order的索引；[源索引,目标索引,可选分支属性]。args为参数，settings为原节点配置，policy为执行策略，cleanup始终清理。引用已有组件填use.id即可；保留已有revision，不手算版本。修改私有组件定义时format=legacy。'};
  }
  return {case:includeComponents==='all'?c:document,edges:state.caseEdges?.[caseId] || c.edges,
    components:selected,componentSources:Object.fromEntries(selected.map(component=>[component.id,localIds.has(component.id)?'case':'global'])),
    componentScope:includeComponents,updateSemantics:'case 为可保存文档；顶层 components 为解析后的组件参考，不要复制到 document.components。省略字段保留，steps/edges/components 数组整体替换。'};
}
function assertLogSampleExtraction(state, document, existing, options) {
  return require('../workflow-log-text').assertLogSampleExtraction(state,document,existing,options);
}
module.exports={documentSchema,compactProperties,assertPreservedStepFields,assertLogSampleExtraction,readCase};
