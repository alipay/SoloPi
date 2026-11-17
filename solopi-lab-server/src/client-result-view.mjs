import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import evidence from './desktop-agent/evidence-projection.js';
import receipts from './desktop-agent/context-receipts.js';
// The on-disk value is the original command receipt, with no evidence envelope.
// Keep IDs/scalars intact; values that exceed the inline budget are omitted,
// never shortened into an invalid ID, URL, JSON value or submission token.
export async function clientResultView(value,{directory,authorize}={}){
 const serialized=JSON.stringify(value??null);
 if(serialized.length<=6000||!directory||!['succeeded','failed'].includes(value?.status))return value;
 const target=join(directory,'client-results',createHash('sha256').update(serialized).digest('hex')+'.json');
 await authorize?.({name:'write',arguments:{file_path:target}});
 mkdirSync(join(directory,'client-results'),{recursive:true,mode:0o700});
 const temporary=target+'.'+randomUUID()+'.tmp';writeFileSync(temporary,serialized,{mode:0o600});renameSync(temporary,target);
 const scalars={};let bytes=0,omitted=false;
 const failure=value.status==='failed'||value.result?.success===false;
 const details=failure?Object.fromEntries(['error','errorCode','code','message','validationErrors','issues','missingFields','submissionOutcome'].filter(k=>value.result?.[k]!==undefined).map(k=>[k,value.result[k]])):null;
 const failureText=details?JSON.stringify(details):null;
 const failureSummary=failureText?{...receipts.facts(value.result),details:failureText.length<=3000?details:undefined,detailsComplete:failureText.length<=3000,detailsPointer:'/result'}:undefined;
 function visit(v,p,depth){if(depth>2||Array.isArray(v))return;if(v&&typeof v==='object'){for(const [k,x] of Object.entries(v))visit(x,p+'/'+k.replace(/~/g,'~0').replace(/\//g,'~1'),depth+1);return;}
  const n=JSON.stringify([p,v]).length;if(bytes+n<=2400){scalars[p]=v;bytes+=n;}else omitted=true;
 }
 visit(value,'',0);
 // Host CLI receipts already own complete stdout/stderr files. Expose exact
 // pointers without requiring another envelope read or truncating a path.
 const files={};let fileBytes=0;
 for(const key of ['operationId','stdoutFile','outputFile','stderrFile'])if(typeof value[key]==='string'){
  const size=JSON.stringify([key,value[key]]).length;
  if(fileBytes+size<=1200){files[key]=value[key];fileBytes+=size;}else omitted=true;
 }
 return{...receipts.facts(value),commandId:value.commandId,clientId:value.clientId,receiptId:value.receiptId,status:value.status,...(failureSummary?{failureSummary}:{}),...files,fullResultPath:target,rootPointer:'',inlineScalars:scalars,inlineScalarsTruncated:omitted,sourceStructure:evidence.outline(value),message:'完整原始工具回执已保存为JSON文件。路径从文件根开始（无/content包装）；字段以inlineScalars/sourceStructure实际路径为准。CLI原文优先用read_attachment读取stdoutFile，混合输出用outputFile；列表筛选/批量计算用已有文件或脚本返回所需字段，不重复查询或逐页回读。'};
}
