import {lab} from './lab';
export async function supportCommand(clientId:string,tool:string,args:Record<string,unknown>,signal:AbortSignal){
 const requestId=crypto.randomUUID();await lab('commands',{clientId,tool,args,requestId},signal);
 for(let i=0;i<300;i++){
  signal.throwIfAborted();const reply=await lab<any>('commands/'+requestId,undefined,signal);
  if(['succeeded','failed'].includes(reply.status)){if(reply.status==='failed'||reply.result?.success===false)throw Error(reply.result?.error||reply.result?.errorCode||'导出失败');return reply.result;}
  await new Promise<void>((resolve,reject)=>{const stop=()=>{clearTimeout(timer);reject(signal.reason);},timer=setTimeout(()=>{signal.removeEventListener('abort',stop);resolve();},300);signal.addEventListener('abort',stop,{once:true});});
 }
 throw Error('Client 未返回导出结果；请求 ID：'+requestId);
}
function decode(data:string){return Uint8Array.from(atob(data),c=>c.charCodeAt(0));}
export function saveSupportFile(bytes:Uint8Array[],filename:string){const url=URL.createObjectURL(new Blob(bytes as BlobPart[],{type:'application/gzip'})),link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
export async function readClientSupport(clientId:string,args:Record<string,unknown>,signal:AbortSignal,progress:(text:string)=>void){
 progress('正在生成 Client 日志包…');const meta=await supportCommand(clientId,'export_support_bundle',args,signal);
 if(!/^[0-9a-f-]{36}$/i.test(meta.exportId)||!Number.isSafeInteger(meta.size)||meta.size<1||meta.size>32*1024*1024)throw Error('导出回执无效');
 const blocks:Uint8Array[]=[];const length=262144;let next=0,received=0;
 progress('正在下载 Client 日志包 0%');
 const controller=new AbortController(),transferSignal=AbortSignal.any([signal,controller.signal]);
 try{await Promise.all(Array.from({length:Math.min(4,Math.ceil(meta.size/length))},async()=>{
  while(next<meta.size){transferSignal.throwIfAborted();const offset=next;next+=length;
   const part=await supportCommand(clientId,'read_support_export',{exportId:meta.exportId,version:meta.version,offset,length},transferSignal);
   const bytes=decode(part.data);if(part.exportId!==meta.exportId||part.version!==meta.version||part.offset!==offset||part.size!==meta.size||bytes.length!==Math.min(length,meta.size-offset))throw Error('导出内容校验失败');
   blocks[offset/length]=bytes;received+=bytes.length;progress(`正在下载 Client 日志包 ${Math.round(received/meta.size*100)}%`);
  }
 }));}catch(error){controller.abort();throw error;}
 const all=new Uint8Array(meta.size);let pos=0;for(const b of blocks){all.set(b,pos);pos+=b.length;}
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',all)),v=>v.toString(16).padStart(2,'0')).join('');if(hash!==meta.version)throw Error('导出文件摘要不匹配');
 return {meta,blocks};
}
export async function downloadClientSupport(clientId:string,args:Record<string,unknown>,signal:AbortSignal,progress:(text:string)=>void){const {meta,blocks}=await readClientSupport(clientId,args,signal,progress);saveSupportFile(blocks,'solopi-client-support.json.gz');return meta;}
const logBundles=new Map<string,{at:number;payload:any;size:number}>();
export function clearLogDownloadCache(clientId:string,taskId:string){for(const key of logBundles.keys()){const parts=JSON.parse(key);if(parts[0]===clientId&&parts[1]===taskId)logBundles.delete(key);}}
export async function readCaseLogDownload(clientId:string,taskId:string,caseId:string,deviceType:string,ordinal:number,signal:AbortSignal,progress:(text:string)=>void=()=>{}){
 const key=JSON.stringify([clientId,taskId,caseId]),saved=logBundles.get(key);let payload=saved&&Date.now()-saved.at<180000?saved.payload:undefined;
 if(!payload){const {blocks}=await readClientSupport(clientId,{taskId,caseIds:[caseId]},signal,progress);signal.throwIfAborted();
 progress('正在校验日志…');
 const stream=new Blob(blocks as BlobPart[]).stream().pipeThrough(new DecompressionStream('gzip'));
 const reader=stream.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){signal.throwIfAborted();const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>64*1024*1024)throw Error('日志导出包超过浏览器预览上限');chunks.push(value);}}finally{await reader.cancel();}
 payload=JSON.parse(await new Blob(chunks as BlobPart[]).text());if(payload.taskId!==taskId)throw Error('日志导出任务不匹配');signal.throwIfAborted();if(payload.files?.length&&size*2<=16*1024*1024&&!(payload.cases||[]).some((c:any)=>c.missing?.length)){logBundles.set(key,{at:Date.now(),payload,size:size*2});while(logBundles.size>3||[...logBundles.values()].reduce((sum,e)=>sum+e.size,0)>16*1024*1024)logBundles.delete(logBundles.keys().next().value!);}}
 const selected=(payload.files||[]).filter((f:any)=>f.caseId===caseId&&f.deviceType===deviceType&&f.kind!=='recording-diagnostics');const file=selected[ordinal];
 if(!file||file.encoding!=='base64'||typeof file.data!=='string')throw Error('该日志未出现在用例导出包中');
 const bytes=decode(file.data);if(bytes.byteLength>32*1024*1024)throw Error('日志文件超过下载上限');signal.throwIfAborted();
 return {url:URL.createObjectURL(new Blob([bytes],{type:'application/gzip'})),mime:'application/gzip'};
}

export async function downloadServerSupport(signal:AbortSignal){const reply=await lab<any>('diagnostics',undefined,signal);if(reply.encoding!=='base64')throw Error('诊断格式无效');saveSupportFile([decode(reply.data)],'solopi-server-diagnostics.json.gz');}
