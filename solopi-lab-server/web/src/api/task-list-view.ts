export interface TaskListView{taskQuery:string;taskFilter:string;computerFilter:string;fromDate:string;toDate:string;scrollTop:number}
const key='solopi.lab.task-list.view.v1';
const defaults:TaskListView={taskQuery:'',taskFilter:'all',computerFilter:'all',fromDate:'',toDate:'',scrollTop:0};
export function readTaskListView():TaskListView{try{const value=JSON.parse(sessionStorage.getItem(key)||'{}');return {...defaults,...Object.fromEntries(Object.keys(defaults).flatMap(k=>k==='scrollTop'?(Number.isFinite(value[k])&&value[k]>=0?[[k,value[k]]]:[]):typeof value[k]==='string'?[[k,value[k].slice(0,500)]]:[]))};}catch{return {...defaults};}}
export function saveTaskListView(patch:Partial<TaskListView>){try{sessionStorage.setItem(key,JSON.stringify({...readTaskListView(),...patch}));}catch{/* Navigation remains usable when storage is unavailable. */}}
