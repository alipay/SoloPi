import {readDesktop} from './client-task-read';
import type {ClientTask} from './client-tasks';
const seeds=new Map<string,ClientTask>();
const pages=new Map<string,{at:number;promise:Promise<any>;terminal?:boolean}>();
const key=(clientId:string,taskId:string)=>JSON.stringify([clientId,taskId]);
export function seedTask(task:ClientTask){seeds.set(key(task.clientId,task.id),task);while(seeds.size>600)seeds.delete(seeds.keys().next().value!);}
export function taskSeed(clientId:string,taskId:string){return seeds.get(key(clientId,taskId));}
export function firstTaskPage(clientId:string,taskId:string,refresh=false){const id=key(clientId,taskId),previous=pages.get(id);if(!refresh&&previous&&Date.now()-previous.at<(previous.terminal?300000:30000))return previous.promise;
 const c=new AbortController(),timeout=setTimeout(()=>c.abort(),30000);
 const promise=readDesktop(clientId,'read_task_report',{taskId,view:'cases',offset:0,limit:200,...(refresh?{refresh:true}:{})},c.signal).finally(()=>clearTimeout(timeout));const entry:{at:number;promise:Promise<any>;terminal?:boolean}={at:Date.now(),promise};promise.then(r=>{entry.terminal=['success','failed','stopped','cancelled','succeeded'].includes(r.task?.status);},()=>{});pages.set(id,entry);while(pages.size>80)pages.delete(pages.keys().next().value!);promise.catch(()=>{if(pages.get(id)===entry)pages.delete(id);});return promise;
}
export const prefetchTask=(clientId:string,taskId:string)=>{void firstTaskPage(clientId,taskId).catch(()=>{});};
export function clearTaskNavigation(){seeds.clear();pages.clear();}
