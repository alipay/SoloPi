function createTtsTextExtractor(pattern, caseSensitive = true) {
  let sourcePattern = String(pattern || '');

  if (!sourcePattern) {
    throw new Error('日志文本提取断言缺少提取正则');
  }

  const regexp = new RegExp(sourcePattern, caseSensitive ? '' : 'i');

  return (line) => {
    const match = regexp.exec(line);

    if (!match) {
      return null;
    }

    return match.groups?.ttsText ?? match[1] ?? '';
  };
}

function assertLogSampleExtraction(state, document, existing, options = {}) {
  const diagnostics = [];
  const components=new Map((state.components || []).map(c=>[c.id,c]));
  for(const c of document.components || existing?.components || [])components.set(c.id,c);
  const oldComponents=new Map((state.components || []).map(c=>[c.id,c]));
  for(const c of existing?.components || [])oldComponents.set(c.id,c);
  const values=(step,component)=>({...Object.fromEntries((component?.params || []).map(p=>[p.key,p.defaultValue])),...step?.inputs});
  const keys=['extractRegex','sampleLog','sampleExtractText','caseSensitive'];
  for(const step of document.steps || []) {
    const component=components.get(step.componentId);
    if(component?.kind!=='tts_assert')continue;
    const input=values(step,component),oldStep=existing?.steps?.find(s=>s.id===step.id);
    const oldInput=values(oldStep,oldComponents.get(oldStep?.componentId));
    if(oldStep && keys.every(k=>input[k]===oldInput[k]))continue;
    if(!input.sampleLog || !input.extractRegex)continue;
    if(keys.some(k=>typeof input[k]==='string' && /\$\{|\{\{/.test(input[k])))continue;
    let field='inputs.extractRegex';
    try {
      const extract=createTtsTextExtractor(input.extractRegex,input.caseSensitive!==false && input.caseSensitive!=='false');
      const actual=extract(String(input.sampleLog));
      if(actual===null) {
        field='inputs.sampleLog';
        throw Error('配置正则未匹配此样例，需核对正则与样例来源');
      }
      if(input.sampleExtractText!==undefined && String(input.sampleExtractText)!==actual) {
        field='inputs.sampleExtractText';
        throw Error(`实际提取 ${JSON.stringify(actual)}，样例期望 ${JSON.stringify(input.sampleExtractText)}`);
      }
    } catch(error) {
      if (options.preserveSourceSamples === true && ['inputs.sampleLog','inputs.sampleExtractText'].includes(field)) {
        diagnostics.push({stepId:step.id,field,message:error.message}); continue;
      }
      throw Object.assign(Error(`步骤 ${step.id} 的日志样例校验未通过（${field}）：${error.message}。请用真实样例核对相关字段；平台不自动改写。`),{stepId:step.id,field});
    }
  }
  return diagnostics;
}
module.exports={createTtsTextExtractor,assertLogSampleExtraction};
