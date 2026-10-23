const {resolveCaseSelection}=require('./case-selection');
const {caseRevision}=require('./case-batch');
const {read,segments}=require('./edit-scope');
const {isDeepStrictEqual}=require('node:util');
function validateStepPointer(pointer){
  let parts;
  try{parts=segments(pointer);}catch{parts=null;}
  if(!parts || ['steps','case','document','components'].includes(parts[0]) || parts.includes('*')){
    throw Object.assign(Error(`字段路径无效：${pointer}。query_case_steps 的根是单个步骤；使用 /inputs/lineRegex、/inputs/conditions 或 /componentId，不要加 /steps/*、/case 或 /document 前缀，不支持通配符。字段查询不读取组件定义。`),{code:'INVALID_STEP_FIELD_PATH'});
  }
}
function query(state,args,domain=''){
  for(const pointer of [...args.fields,...(args.fieldFilters || []).map(filter=>filter.path)])validateStepPointer(pointer);
  const ids=resolveCaseSelection(state,args,domain), rows=[];
  for(const id of ids){
    const c=state.cases.find(c=>c.id===id);
    const revision=caseRevision(state,id);
    const components=new Map((state.components || []).map(component=>[component.id,{...component,source:'global'}]));
    for(const component of c.components || [])components.set(component.id,{...component,source:'case'});
    for(const step of c.steps || []){
      if(args.componentIds?.length&&!args.componentIds.includes(step.componentId))continue;
      const component=components.get(step.componentId);
      if(args.componentKinds?.length&&!args.componentKinds.includes(component?.kind))continue;
      if(args.fieldFilters?.some(filter=>{
        const field=read(step,filter.path);
        if(!field.exists)return true;
        if(filter.operator==='equals')return !isDeepStrictEqual(field.value,filter.value);
        if(filter.operator==='contains')return typeof field.value!=='string'||!field.value.includes(filter.value);
        throw Error('未知字段筛选操作');
      }))continue;
      rows.push({caseId:id,caseName:c.name,caseRevision:revision,stepId:step.id,componentId:step.componentId,
        componentKind:component?.kind ?? null,componentName:component?.name ?? null,
        componentSource:component?.source ?? (step.componentId?'missing':'none'),
        fields:Object.fromEntries(args.fields.map(p=>[p,read(step,p)]))});
    }
  }
  const offset=args.offset||0,end=offset+(args.limit||20);
  return {success:true,source:'current-platform-state',fieldRoot:'step',componentSourceMeaning:'组件定义来源，不表示步骤参数的位置；case为随用例保存的定义。exists:false仅表示当前步骤的指定路径不存在，不能推断字段位于组件中。',total:rows.length,caseCount:ids.length,matchedCaseCount:new Set(rows.map(row=>row.caseId)).size,nextOffset:end<rows.length?end:null,rows:rows.slice(offset,end)};
}
module.exports={query};
