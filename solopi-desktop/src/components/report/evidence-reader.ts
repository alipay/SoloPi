import type {EvidenceReader,ReportArtifact} from './ReportWorkbench';
type Read=(tool:string,args:Record<string,unknown>,signal:AbortSignal)=>Promise<any>;
export function createEvidenceReader(taskId:string,read:Read,persistent?:{get:(key:string)=>Promise<Blob|undefined>;set:(key:string,value:Blob)=>Promise<void>}):EvidenceReader{
 type Entry={controller:AbortController;promise:Promise<any>;users:number;done:boolean;size:number;at:number};
 const cache=new Map<string,Entry>();let bytes=0;
 const remove=(key:string,e:Entry)=>{if(cache.get(key)===e){cache.delete(key);bytes-=e.size;}};
 const shared=<T,>(key:string,load:(s:AbortSignal)=>Promise<T>,signal:AbortSignal):Promise<T>=>{
  signal.throwIfAborted();let entry=cache.get(key);
  if(entry&&Date.now()-entry.at>300000){remove(key,entry);entry=undefined;}
  if(!entry){const controller=new AbortController();const e:Entry={controller,promise:Promise.resolve(),users:0,done:false,size:0,at:Date.now()};entry=e;cache.set(key,e);
   e.promise=(async()=>{if(persistent&&key.startsWith('artifact:')){const hit=await persistent.get(key);controller.signal.throwIfAborted();if(hit)return hit as T;}const value=await load(controller.signal);if(persistent&&value instanceof Blob)void persistent.set(key,value);return value;})().then(value=>{e.done=true;e.size=value instanceof Blob?value.size:JSON.stringify(value).length*2;if(cache.get(key)===e)bytes+=e.size;while(cache.size>64||bytes>32*1024*1024){const first=cache.entries().next().value;if(!first)break;remove(first[0],first[1]);}return value;},error=>{e.done=true;remove(key,e);throw error;});
  }
  const e=entry;e.users++;
  return new Promise<T>((resolve,reject)=>{let done=false;const finish=(error?:unknown,value?:T)=>{if(done)return;done=true;signal.removeEventListener('abort',cancel);e.users--;if(!e.done&&!e.users){remove(key,e);e.controller.abort();}if(error)reject(error);else resolve(value!);};const cancel=()=>finish(signal.reason||new DOMException('Aborted','AbortError'));signal.addEventListener('abort',cancel,{once:true});e.promise.then(v=>finish(undefined,v),error=>finish(error));});
 };
 const reader:EvidenceReader={
  prime(items){for(const {caseId,kind,index,preview,data,mime} of items){if(!['image/png','image/jpeg'].includes(mime)||data.length>350000)continue;const key='artifact:'+JSON.stringify({caseId,kind,index,...(preview?{preview:true}:{})});if(cache.has(key))continue;const blob=new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:mime});if(persistent)void persistent.set(key,blob);const e:Entry={controller:new AbortController(),promise:Promise.resolve(blob),users:0,done:true,size:blob.size,at:Date.now()};cache.set(key,e);bytes+=e.size;while(cache.size>64||bytes>32*1024*1024){const first=cache.entries().next().value;if(!first)break;remove(first[0],first[1]);}}},
  log(args,signal){return shared('log:'+JSON.stringify(args),async s=>{const r=await read('search_task_log',{taskId,...args,limit:80},s);if(r.taskId!==taskId||r.scope?.caseId!==args.caseId)throw Error('日志与当前用例不匹配');return {text:(r.matches||[]).map((line:any)=>line.line+'  '+line.text).join('\n'),nextLine:r.nextLine??null};},signal);},
  async artifact(args,signal){const blob=await shared('artifact:'+JSON.stringify(args),async s=>{
   const chunks:Uint8Array[]=[];const length=524288;
   const chunk=async(offset:number,version='',size?:number,mime?:string)=>{s.throwIfAborted();const r=await read('read_case_artifact',{taskId,caseId:args.caseId,artifactKind:args.kind,artifactIndex:args.index,...(args.preview?{preview:true}:args.kind==='recordings'&&!args.original?{playback:true}:{}),offset,length,...(version?{version}:{})},s);
    if(r.identity?.taskId!==taskId||r.identity?.caseId!==args.caseId||r.offset!==offset||version&&r.version!==version||size!=null&&(r.size!==size||r.mime!==mime))throw Error('附件归属或读取边界不一致');
    const bytes=Uint8Array.from(atob(r.data),c=>c.charCodeAt(0)),next=r.nextOffset??null;if(next!=null&&(!Number.isSafeInteger(next)||next<=offset))throw Error('附件分页未推进');
    if(Number.isSafeInteger(r.size)&&!args.preview&&(r.size<0||r.size>256*1024*1024||bytes.length!==Math.min(length,r.size-offset)||next!==(offset+bytes.length<r.size?offset+bytes.length:null)))throw Error('附件分页长度不一致');return {r,bytes,next};};
   const first=await chunk(0);chunks.push(first.bytes);const {version,mime,size}=first.r;
   if(first.next!=null&&Number.isSafeInteger(size)){
    // Keep the file version from the first block; fetch the remaining ranges
    // in bounded parallel windows rather than paying one remote round trip each.
    let next=first.next;await Promise.all([0,1,2,3].map(async()=>{while(next<size){const offset=next;next+=length;const value=await chunk(offset,version,size,mime);chunks[offset/length]=value.bytes;}}));
   }else{let offset=first.next;while(offset!=null){const value=await chunk(offset,version);chunks.push(value.bytes);offset=value.next;}}
   s.throwIfAborted();return new Blob(chunks as BlobPart[],{type:mime});
  },signal);signal.throwIfAborted();return {url:URL.createObjectURL(blob),mime:blob.type};},
  async prefetch(caseId,artifacts,signal){
   const jobs:(()=>Promise<unknown>)[]=[];
   for(const kind of ['screenshots','recordings'] as const)(artifacts[kind] as ReportArtifact[]||[]).forEach((a,index)=>{if(a.success===false||!a.path)return;jobs.push(async()=>{const r=await reader.artifact({caseId,kind,index,...(kind==='recordings'?{preview:true}:{})},signal);URL.revokeObjectURL(r.url);});});
   let videoBudget=8*1024*1024;(artifacts.recordings as ReportArtifact[]||[]).forEach((a,index)=>{const size=(a as {sizeBytes?:number}).sizeBytes;if(a.success===false||!a.path||!Number.isSafeInteger(size)||!size||size>videoBudget)return;videoBudget-=size;jobs.push(async()=>{const r=await reader.artifact({caseId,kind:'recordings',index},signal);URL.revokeObjectURL(r.url);});});
   const roles=[...new Set((artifacts.logs as ReportArtifact[]||[]).filter(a=>a.path).map(a=>a.deviceType).filter((r):r is string=>!!r))];for(const deviceType of roles)jobs.push(()=>reader.log({caseId,deviceType,query:'',fromLine:1},signal));
   let next=0;await Promise.all([0,1,2,3].map(async()=>{while(next<jobs.length&&!signal.aborted){const job=jobs[next++];try{await job();}catch{/* Tab reads expose the original error and can retry. */}}}));
  },
 };
 return reader;
}
