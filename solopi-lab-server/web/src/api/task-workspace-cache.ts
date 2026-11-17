import {connectionGeneration} from './connection';
import type {ClientTask} from './client-tasks';
import type {Catalog,Execution} from './lab';
type Snapshot={nativeTasks:ClientTask[];catalogs:Catalog[];tasks:Execution[];complete:boolean;cachedAt?:number};
const key='solopi.lab.task-list.snapshot.v2',maxAge=7*24*60*60*1000;
let cached:{generation:number;value:Snapshot}|undefined;
const validRow=(r:any)=>r&&['id','name','status','clientId','hostname'].every(k=>typeof r[k]==='string');
function project(value:Snapshot):Snapshot{
 return {complete:true,cachedAt:value.cachedAt??Date.now(),nativeTasks:value.nativeTasks.map(t=>({id:t.id,name:t.name,status:t.status,clientId:t.clientId,hostname:t.hostname,updatedAt:t.updatedAt,summary:t.summary?{successCount:t.summary.successCount,failedCount:t.summary.failedCount}:undefined})),catalogs:value.catalogs.map(c=>({clientId:c.clientId,hostname:c.hostname,updatedAt:c.updatedAt,devices:[],groups:[],cases:[]})),tasks:value.tasks.map(t=>({taskId:t.taskId,name:t.name,status:t.status,clientId:t.clientId,source:t.source,createdAt:t.createdAt,updatedAt:t.updatedAt,group:{groupId:t.group.groupId,name:t.group.name,revision:t.group.revision,members:[]},cases:[],progress:null,report:null}))};
}
export function readTaskWorkspaceCache(){
 const generation=connectionGeneration();if(cached&&cached.generation!==generation){clearTaskWorkspaceCache();return;}
 if(!cached&&generation===0){try{const stored=JSON.parse(localStorage.getItem(key)||'null');if(stored?.origin===location.origin&&stored.version===2&&stored.value?.complete&&typeof stored.value.cachedAt==='number'&&Number.isFinite(stored.value.cachedAt)&&Array.isArray(stored.value.nativeTasks)&&stored.value.nativeTasks.every(validRow)&&Array.isArray(stored.value.tasks)&&Array.isArray(stored.value.catalogs)&&stored.value.nativeTasks.length<=5000&&stored.value.tasks.length<=2000){cached={generation,value:project(stored.value)};}}catch{/* Invalid/blocked storage falls back to the live list. */}}
 const at=cached?.value.cachedAt;if(!cached||typeof at!=='number'||!Number.isFinite(at)||at>Date.now()+60000||Date.now()-at>maxAge){if(cached)clearTaskWorkspaceCache();return;}
 return cached.value;
}
export function saveTaskWorkspaceCache(value:Snapshot){
 if(!value.complete||value.nativeTasks.length>5000||value.tasks.length>2000)return;
 const projected=project(value),encoded=JSON.stringify({version:2,origin:location.origin,value:projected});if(encoded.length>2*1024*1024)return;
 const generation=connectionGeneration();cached={generation,value:projected};
 // The /lab endpoint is fixed to this origin's project. Never persist manual
 // connection credentials/scope, nor reuse this snapshot after identity changes.
 try{if(generation===0)localStorage.setItem(key,encoded);else localStorage.removeItem(key);}catch{/* The in-memory cache and live reads remain usable. */}
}
export function clearTaskWorkspaceCache(){cached=undefined;try{localStorage.removeItem(key);}catch{/* Storage may be unavailable. */}}
