import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
// Read-only diagnostics. Unknown names are reported, never rewritten or aliased.
export const contextKeys = new Set(['phoneSerial','glassesSerial','phonePackage','glassesPackage','adbPath','outputDir','appDataDir','platform','arch','resourcesDir']);
export function auditQuickActionTemplates(action) {
  const issues=[];
  const inspect=(value,field,keys)=>{
    if(typeof value==='string')for(const match of value.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)){
      const variable=match[1];
      if(variable.startsWith('inputs.')?!keys.has(variable.slice(7)):!contextKeys.has(variable))issues.push({field,variable,reason:variable.startsWith('inputs.')?'unknown-input':'unknown-context'});
    }
    else if(Array.isArray(value))value.forEach((item,index)=>inspect(item,`${field}.${index}`,keys));
    else if(value&&typeof value==='object')Object.entries(value).forEach(([key,item])=>inspect(item,`${field}.${key}`,keys));
  };
  const activeKeys=new Set((action.inputs||[]).map(i=>i.key));
  for(const name of ['inputs','configuredInputs']){
    const inputs=action[name];if(!Array.isArray(inputs))continue;
    const keys=new Set(inputs.map(i=>i.key));inputs.forEach((input,index)=>inspect(input.defaultValue,`${name}.${index}.defaultValue`,keys));
  }
  for(const [key,override] of Object.entries(action.inputOverrides||{}))inspect(override.defaultValue,`inputOverrides.${key}.defaultValue`,activeKeys);
  for(const name of ['args','argsOverride'])inspect(action[name],name,activeKeys);
  inspect(action.queryConfig?.args,'queryConfig.args',activeKeys);
  for(const name of ['startArgs','stopArgs','exportArgs'])inspect(action.sessionConfig?.[name],`sessionConfig.${name}`,activeKeys);
  return issues;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const file=process.argv[2];if(!file)throw Error('Usage: node scripts/audit-quick-action-templates.mjs <definitions.json>');
  const data=JSON.parse(fs.readFileSync(file,'utf8')),actions=Array.isArray(data)?data:data.actions||[data.action||data];
  const results=actions.map(a=>({id:a.id,name:a.name,issues:auditQuickActionTemplates(a)}));
  console.log(JSON.stringify({success:results.every(r=>!r.issues.length),results},null,2));
  if(results.some(r=>r.issues.length))process.exitCode=1;
}
