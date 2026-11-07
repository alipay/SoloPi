const stepSchema = {
  type:'object', required:['id','type','device'], additionalProperties:true,
  properties:{
    id:{type:'string',minLength:1}, name:{type:'string'},
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
function readCase(state, {caseId, includeComponents='referenced'}) {
  const stored=state.cases?.find(c=>c.id===caseId);if(!stored) throw Error('用例不存在');
  const c=require('../workflow-failure-policy').normalizeCaseFailurePolicy(require('../case-assets').withAssetContext(state,stored), state.components || []);
  const {components:local=[],...document}=c;
  const effective=new Map((state.components||[]).map(c=>[c.id,c]));
  for(const component of local) effective.set(component.id,component);
  const used=new Set((c.steps||[]).map(s=>s.componentId));
  const selected=includeComponents==='none'?[]:[...effective.values()].filter(c=>includeComponents==='all'||used.has(c.id));
  const localIds=new Set(local.map(component=>component.id));
  return {case:includeComponents==='all'?c:document,edges:state.caseEdges?.[caseId] || c.edges,
    components:selected,componentSources:Object.fromEntries(selected.map(component=>[component.id,localIds.has(component.id)?'case':'global'])),
    componentScope:includeComponents,updateSemantics:'case 为可保存文档；顶层 components 为解析后的组件参考，不要复制到 document.components。省略字段保留，steps/edges/components 数组整体替换。'};
}
function assertLogSampleExtraction(state, document, existing, options) {
  return require('../workflow-log-text').assertLogSampleExtraction(state,document,existing,options);
}
module.exports={documentSchema,assertPreservedStepFields,assertLogSampleExtraction,readCase};
