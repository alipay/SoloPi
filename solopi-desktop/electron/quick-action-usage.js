// Derived from configuration, never guessed from an action or business name.
const CONTEXT_FLAGS = Object.freeze({phoneSerial:'--phone',glassesSerial:'--glasses',phonePackage:'--phone-package',glassesPackage:'--glasses-package'});
const RUNTIME_KEYS=new Set(['adbPath','outputDir','appDataDir','platform','arch','resourcesDir']);
const contextBinding=key=>({key,source:CONTEXT_FLAGS[key]?'context':RUNTIME_KEYS.has(key)?'runtime':'unresolved',...(CONTEXT_FLAGS[key]?{cliFlag:CONTEXT_FLAGS[key]}:{})});
const REFERENCES=/\{\{\s*([\w.-]+)\s*\}\}/g;
function normalizeUsageInstructions(value='') {
  if(typeof value!=='string'||value.length>12000)throw Error('使用说明须为不超过12000字的文本');
  return value.trim();
}
function contextReferences(template) {
  return [...new Set([...String(template??'').matchAll(REFERENCES)].map(m=>m[1]).filter(k=>!k.startsWith('inputs.')))];
}
function inputBinding(input,inputs) {
  const hidden=input.userInput===false;
  return {key:input.key,label:input.label||input.key,required:!!input.required,
    valueSource:hidden?'default-or-context':'values-or-default',
    ...(hidden?{}:{valuesKey:input.key}),
    inputReferences:[...String(input.defaultValue??'').matchAll(REFERENCES)].map(m=>m[1]).filter(k=>k.startsWith('inputs.')),
    contextBindings:contextReferences(input.defaultValue,inputs).map(key=>({...contextBinding(key),when:hidden?'default':'when-value-omitted'})),
    ...(input.placeholder?{format:input.placeholder}:{}),
    ...(input.type==='select'?{options:(input.options||[]).map(o=>typeof o==='string'?o:o.value)}:{})};
}
function quickActionUsage(action) {
  const inputs=action.inputs||[],bindings=inputs.map(i=>inputBinding(i,inputs));
  const phases=action.sessionConfig?.enabled?['start','stop']:['run'];
  const templates=[...(action.args||[]),...(action.queryConfig?.enabled?action.queryConfig.args||[]:[]),
    ...(action.sessionConfig?.enabled?[...(action.sessionConfig.startArgs||[]),...(action.sessionConfig.stopArgs||[]),...(action.sessionConfig.exportArgs||[])]:[])];
  const contextKeys=[...new Set([...bindings.flatMap(i=>i.contextBindings.map(b=>b.key)),...templates.flatMap(t=>contextReferences(t,inputs))])];
  const invocation=(phase,query=false)=>{
    if(phase==='stop')return {phase,parameterSource:'start-snapshot',agent:{id:action.id,phase},cliArgv:['solopi-desktop','quick-actions','execute',action.id,'--phase',phase,'--json']};
    const activeInputs=query?inputs.filter(i=>i.key!==action.queryConfig?.targetInputKey):inputs;
    const activeArgs=query?action.queryConfig.args||[]:phase==='start'?[...(action.sessionConfig.startArgs||[]),...(action.sessionConfig.stopArgs||[]),...(action.sessionConfig.exportArgs||[])]:action.args||[];
    const keys=[...new Set([...activeInputs.flatMap(i=>contextReferences(i.defaultValue)),...activeArgs.flatMap(t=>contextReferences(t))])];
    const context=Object.fromEntries(keys.filter(k=>CONTEXT_FLAGS[k]).map(k=>[k,`<${k}>`]));
    const values=Object.fromEntries(activeInputs.filter(i=>i.userInput!==false&&i.required).map(i=>[i.key,`<${i.key}>`]));
    const cliContext=Object.keys(context).flatMap(k=>[CONTEXT_FLAGS[k],context[k]]);
    const cliValues=Object.keys(values).length?['--values',JSON.stringify(values)]:[];
    return {...(query?{}:{phase,parameterSource:'current-inputs'}),agent:{id:action.id,...(query?{}:{phase}),values,context},
      cliArgv:['solopi-desktop','quick-actions',query?'query':'execute',action.id,...(query?[]:['--phase',phase]),...cliValues,...cliContext,'--json']};
  };
  const instructions=normalizeUsageInstructions(action.usageInstructions??'');
  const configurationIssues=contextKeys.filter(k=>!CONTEXT_FLAGS[k]&&!RUNTIME_KEYS.has(k)).map(key=>({code:'UNRESOLVED_CONTEXT_VARIABLE',key,message:'当前宿主未提供该变量；请核对默认值及参数模板，不猜测其他设备或包名。'}));
  return {schemaVersion:'solopi.quick-action-usage.v1',documentationStatus:instructions?'configured':'needs-review',
    instructions,purpose:action.description||'',inputBindings:bindings,
    contextBindings:contextKeys.map(contextBinding),
    configurationReady:configurationIssues.length===0,configurationIssues,
    phases,queryEnabled:!!action.queryConfig?.enabled,
    invocationExamples:phases.map(phase=>invocation(phase)),
    ...(action.queryConfig?.enabled?{queryExample:invocation('query',true)}:{}),
    rules:['configurationIssues非空时先核对并修正配置，不要把未解析变量或占位符直接用于执行。','values只填写用户输入项；隐藏输入使用defaultValue及context，不会被values覆盖。',
      '示例中的尖括号是占位符；按实际参数、当前设备和已知包名填写。隐藏包名绑定不等于更换安装包。',
      '说明不构成授权或验证结果。query也执行脚本；结果未知先查原回执，不重复执行。',
      ...(instructions?[]:['尚未填写业务使用说明；先核对show返回的配置和脚本，不能猜测前置条件、副作用或成功判据。'])]};
}
function missingHiddenInputMessage(input,inputs) {
  const flags=contextReferences(input.defaultValue,inputs).filter(k=>CONTEXT_FLAGS[k]).map(k=>`${CONTEXT_FLAGS[k]}（context.${k}）`);
  return `隐藏参数“${input.label||input.key}”未获得有效默认值；values.${input.key}不会覆盖隐藏参数。${flags.length?'请提供 '+flags.join('、')+'，或设置有效默认值。':'请在快捷操作配置中设置有效默认值。'}`;
}
module.exports={quickActionUsage,normalizeUsageInstructions,missingHiddenInputMessage};
