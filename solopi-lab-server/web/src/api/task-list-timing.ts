import {lab} from './lab';
type Outcome='succeeded'|'failed'|'cancelled';
type Emit=(name:string,status:Outcome,durationMs:number)=>void;
// Data readiness spans the complete loader, never a request or a React render.
export function taskListLoadTiming({startedAt,hasCache,now=()=>performance.now(),emit}:{startedAt:number;hasCache:boolean;now?:()=>number;emit?:Emit}){
 const id=crypto.randomUUID(),prefix=hasCache?'task_list.warm':'task_list.cold';
 const record:Emit=emit||((name,status,durationMs)=>{
  try{void lab('diagnostics/events',{event:status==='succeeded'?'web.read.completed':'web.read.failed',requestId:id,toolName:name,stage:'task-list-data',durationMs,status},AbortSignal.timeout(3000)).catch(()=>{});}catch{/* Diagnostics must not delay or fail the list. */}
 });
 let native:{rows:number;status:Outcome}|undefined,server:typeof native,first=false,complete=false;
 const send=(name:string,status:Outcome)=>record(name,status,Math.max(0,now()-startedAt));
 const check=()=>{
  if(complete)return;
  if(native&&!first&&(native.rows>0||server)){
   first=true;send(prefix+'.first_data',native.rows>0||server?.rows? 'succeeded':native.status==='succeeded'&&server?.status==='succeeded'?'succeeded':'failed');
  }
  if(native&&server){complete=true;send(prefix+'.complete',native.status==='succeeded'&&server.status==='succeeded'?'succeeded':'failed');}
 };
 return {
  settle(part:'native'|'server',rows:number,status:Outcome){if(complete)return;if(part==='native')native={rows,status};else server={rows,status};check();},
  cancel(){if(!complete){complete=true;send(prefix+'.complete','cancelled');}},
 };
}
export function recordTaskListRefresh(startedAt:number,status:Outcome){
 try{void lab('diagnostics/events',{event:status==='succeeded'?'web.read.completed':'web.read.failed',requestId:crypto.randomUUID(),toolName:'task_list.background.complete',stage:'task-list-data',durationMs:Math.max(0,performance.now()-startedAt),status},AbortSignal.timeout(3000)).catch(()=>{});}catch{}
}
