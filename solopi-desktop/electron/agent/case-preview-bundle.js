function createPlaybackPreparationQueue(read,onError=()=>{}){
 const pending=new Set(),queue=[];let active=false;
 const pump=async()=>{if(active)return;active=true;while(queue.length){const job=queue.shift();try{await read(job.task,{...job.args,artifactKind:'recordings',artifactIndex:job.index,playback:true,offset:0,length:1});}catch(e){onError(e,job.args);}finally{pending.delete(job.key);}}active=false;};
 return (task,args,refs)=>{for(const item of refs){if(item.ref?.kind!=='recordings'||item.detail?.success===false)continue;const key=JSON.stringify([task.id,args.caseId,args.caseOrdinal,item.ref.index,item.detail?.path,item.detail?.sizeBytes]);if(pending.has(key)||queue.length>=8)continue;pending.add(key);queue.push({key,task,args:{taskId:args.taskId,caseId:args.caseId,caseOrdinal:args.caseOrdinal},index:item.ref.index});}void pump();};
}
const preparePlayback=createPlaybackPreparationQueue((task,args)=>require('./case-artifact-read').readCaseArtifact(task,args),(e,args)=>console.warn('[recording-playback-preparation]',args.taskId,args.caseId,e.code||e.message));
// Optional bounded media bytes travel with the existing artifact metadata page.
// References still resolve through readCaseArtifact; no caller paths or new store.
async function casePreviewBundle(task,args,refs,{read=require('./case-artifact-read').readCaseArtifact,prepare=preparePlayback}={}){
 prepare(task,args,refs);
 const candidates=refs.filter(x=>['screenshots','recordings'].includes(x.ref?.kind)&&x.detail?.success!==false).slice(0,4);
 const loaded=await Promise.all(candidates.map(async x=>{try{const result=await read(task,{taskId:args.taskId,caseId:args.caseId,caseOrdinal:args.caseOrdinal,artifactKind:x.ref.kind,artifactIndex:x.ref.index,...(x.ref.kind==='recordings'?{preview:true}:{}),offset:0,length:262144});return result.nextOffset==null?{ref:x.ref,result}:null;}catch{return null;}}));
 let remaining=262144;return loaded.filter(x=>{if(!x||!x.result.success||!Number.isSafeInteger(x.result.size)||x.result.size<0||x.result.size>remaining)return false;remaining-=x.result.size;return true;});
}
module.exports={casePreviewBundle,createPlaybackPreparationQueue};
