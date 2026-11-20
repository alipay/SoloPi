// Do not include argument values or parser snippets: they may contain credentials.
// Resolve only schema-declared const/enum discriminators. Values select a
// contract but are never included in diagnostics (arguments can contain secrets).
function selectedSchema(schema,value){
  let out={...schema,...(schema.properties?{properties:{...schema.properties}}:{})};
  for(const branch of schema.allOf||[]){
    const conditions=branch.if?.properties;
    if(!conditions || !Object.keys(conditions).length || !value || typeof value!=='object')continue;
    if(!Object.values(conditions).every(rule=>Object.hasOwn(rule,'const')||Array.isArray(rule.enum)))continue;
    const matches=Object.entries(conditions).every(([key,rule])=>
      Object.hasOwn(value,key) && (Object.hasOwn(rule,'const') ? value[key]===rule.const : Array.isArray(rule.enum) && rule.enum.includes(value[key])));
    const chosen=matches?branch.then:branch.else;
    if(chosen)out={...out,...chosen,properties:{...out.properties,...chosen.properties},required:[...new Set([...(out.required||[]),...(chosen.required||[])])]};
  }
  return out;
}
function schemaGuide(schema,depth=0,value){
  if(!schema || depth>6)return undefined;
  schema=selectedSchema(schema,value);
  const out={};
  for(const key of ['type','required','additionalProperties','minItems','maxItems','minLength','maxLength','minimum','maximum']){
    const value=schema[key];
    if(value!==undefined && (typeof value!=='object' || ['required','type'].includes(key) && Array.isArray(value)))out[key]=value;
  }
  if(Object.hasOwn(schema,'const'))out.const=schema.const;
  if(Array.isArray(schema.enum))out.enum=schema.enum;
  for(const key of ['anyOf','oneOf','not'])if(schema[key])out[key]=Array.isArray(schema[key])?schema[key].map(s=>schemaGuide(s,depth+1,value)):schemaGuide(schema[key],depth+1,value);
  if(schema.properties)out.properties=Object.fromEntries(Object.entries(schema.properties).slice(0,80).map(([key,child])=>[key,schemaGuide(child,depth+1,value?.[key])]));
  if(schema.items)out.items=schemaGuide(schema.items,depth+1);
  return out;
}
function validationDiagnostic(stage, call, error, errors, schema) {
  const raw = call.function?.arguments;
  const result = { stage, toolName: call.function?.name, toolCallId: call.id, argumentLength: typeof raw === 'string' ? raw.length : 0 };
  if (stage === 'json') {
    const offset = /position (\d+)/.exec(error.message)?.[1];
    if (offset) result.offset = Number(offset);
    const stack = []; let quoted = false, escaped = false;
    for (const c of typeof raw === 'string' ? raw : '') {
      if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
      if (c === '"') quoted = true;
      else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
      else if (c === '}' || c === ']') { if (stack.at(-1) === c) stack.pop(); }
    }
    result.reason = quoted ? 'unterminated_string' : stack.length ? 'unclosed_container' : 'invalid_json';
    if (stack.length) result.expectedClosing = stack.reverse().join('').slice(0, 80);
    // Supply the current shape even when JSON parsing failed. Do not echo or
    // repair raw arguments: they may contain secrets or unintended commands.
    if(schema)result.expectedSchema=schemaGuide(schema);
    result.recovery='regenerate_complete_json_object';
  } else if (stage === 'schema') {
    result.issues = (errors || []).slice(0, 8).map(e => ({ path: e.instancePath, keyword: e.keyword, message: e.message,
      ...(typeof e.params?.additionalProperty==='string' && /^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(e.params.additionalProperty)?{additionalProperty:e.params.additionalProperty}:{}),
      ...(typeof e.params?.missingProperty==='string' && /^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(e.params.missingProperty)?{missingProperty:e.params.missingProperty}:{}) }));
    if(schema){let args;try{args=JSON.parse(raw);}catch{}result.expectedSchema=schemaGuide(schema,0,args);}
  } else result.reason = stage === 'object' ? 'arguments_must_be_object' : 'tool_unavailable';
  return result;
}
module.exports = { validationDiagnostic,schemaGuide };
