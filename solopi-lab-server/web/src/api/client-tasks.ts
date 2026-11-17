import {seedTask} from './task-navigation';
import {readDesktop} from './client-task-read';
export type ClientTask={id:string;name:string;status:string;clientId:string;hostname:string;summary?:any;updatedAt?:string;devices?:Record<string,{serial?:string}>;completed?:number;total?:number};
export async function listClientTasks(client:{clientId:string;hostname:string},signal:AbortSignal,options:{statuses?:string[];includeDevices?:boolean}={},onPage?:(tasks:ClientTask[])=>void){
 const tasks:ClientTask[]=[];
 const page=async(offset:number)=>{const result=await readDesktop(client.clientId,'list_tasks',{offset,limit:50,...options},signal);if(!Array.isArray(result.tasks))throw Error('Client 任务列表格式无效');signal.throwIfAborted();const next=result.nextOffset;if(next!=null&&(!Number.isInteger(next)||next<=offset))throw Error('Client 任务分页未推进');const rows=result.tasks.map((t:any)=>({...t,clientId:client.clientId,hostname:client.hostname}));rows.forEach(seedTask);return {rows,next:next??null,total:result.total};};
 const first=await page(0);tasks.push(...first.rows);onPage?.([...tasks]);let offset:number|null=first.next;
 if(offset===50&&first.rows.length===50&&Number.isSafeInteger(first.total)&&first.total>50&&first.total<=5000){
  // The ledger remains the existing Client list_tasks tool. Bound parallel reads
  // to three pages per Client rather than adding a second task store/API.
  const offsets=Array.from({length:Math.ceil(first.total/50)-1},(_,i)=>(i+1)*50),pages=new Map<number,Awaited<ReturnType<typeof page>>>();let cursor=0,failed=false;
  const results=await Promise.allSettled(Array.from({length:Math.min(3,offsets.length)},async()=>{while(!failed&&cursor<offsets.length){const at=offsets[cursor++];try{pages.set(at,await page(at));}catch(e){failed=true;throw e;}}}));
  const rejection=results.find((r):r is PromiseRejectedResult=>r.status==='rejected');if(rejection)throw rejection.reason;
  for(const at of offsets)tasks.push(...pages.get(at)!.rows);onPage?.([...tasks]);offset=pages.get(offsets[offsets.length-1])!.next;
 }
 while(offset!==null){const result=await page(offset);tasks.push(...result.rows);onPage?.([...tasks]);offset=result.next;}
 return [...new Map(tasks.map(t=>[t.id,t])).values()];
}

export const nativeTaskLink=(clientId:string,taskId:string,caseId='')=>'#/native-report?'+new URLSearchParams({clientId,taskId,...(caseId?{caseId}:{})});
