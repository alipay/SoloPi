import {readDesktop} from './client-task-read';
export type PerformanceState={status:string;performanceOptions:any;performanceReports:Record<string,any>;performanceErrors:Record<string,string>};
// Samples are paged independently from the case index, so report navigation stays light.
export async function loadTaskPerformance(clientId:string,taskId:string,signal:AbortSignal):Promise<PerformanceState>{
 const summary=await readDesktop(clientId,'read_task_report',{taskId,view:'summary',limit:1},signal);
 const task=summary.task;
 if(task?.id!==taskId)throw Error('Client task identity mismatch');
 const state:PerformanceState={status:task.status,performanceOptions:task.performanceOptions||{},performanceReports:{},performanceErrors:{}};
 const targets=['phone','glasses'].filter(target=>task.performanceTargets?.includes(target)||task.performanceReports?.[target]);
 await Promise.all(targets.map(async target=>{
  try{
   const samples:any[]=[];let offset=0,first:any;
   for(;;){
    const page=await readDesktop(clientId,'read_performance_report',{taskId,target,offset,limit:100},signal);
    if(first&&(page.id!==first.id||page.serial!==first.serial||page.total!==first.total))throw Error('Performance report changed during pagination');
    first??=page;samples.push(...page.samples);
    if(page.nextOffset==null){if(samples.length!==page.total)throw Error('Incomplete performance samples');break;}
    if(!Number.isInteger(page.nextOffset)||page.nextOffset<=offset||page.nextOffset!==samples.length)throw Error('Performance pagination did not advance');
    offset=page.nextOffset;
   }
   state.performanceReports[target]={...first,samples};
  }catch(e){if(signal.aborted)throw e;state.performanceErrors[target]=e instanceof Error?e.message:String(e);}
 }));
 return state;
}
