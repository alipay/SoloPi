import {listClientTasks, type ClientTask} from './client-tasks';
import type {Catalog} from './lab';

export type WorkingTask = ClientTask & {completed?:number;total?:number;devices:Record<string,{serial?:string}>};
export type WorkingGroup = {group:Catalog['groups'][number];tasks:WorkingTask[]};
export type WorkingSnapshot = {groups:WorkingGroup[];unmatched:WorkingTask[];observedAt:number};
const isWorking = (status:string) => status === 'running' || status === 'stopping';

/** Read the same Client ledger used by the task page, irrespective of task origin.
 * Match physical serial + role within this Client only. Ambiguous membership is
 * shown as unresolved instead of assigning a task to an arbitrary saved group. */
export async function readWorkingGroups(catalog:Catalog,signal:AbortSignal):Promise<WorkingSnapshot> {
  const ledger=await listClientTasks(catalog,signal,{statuses:['running','stopping'],includeDevices:true});
  return projectWorkingGroups(catalog,ledger.filter(t=>isWorking(t.status)).map(t=>({...t,devices:t.devices||{}})));

}
export function projectWorkingGroups(catalog:Catalog,tasks:WorkingTask[]):WorkingSnapshot {
  const grouped=new Map<string,WorkingGroup>(),unmatched:WorkingTask[]=[];
  for(const task of tasks){
    const devices=Object.entries(task.devices).filter(([,d])=>d?.serial);
    const candidates=catalog.groups.filter(g=>!(g as {deleted?:boolean}).deleted && devices.length>0 && devices.every(([role,d])=>g.members.some(m=>m.role===role && catalog.devices.some(device=>device.deviceId===m.deviceId && device.serial===d.serial))));
    if(candidates.length!==1){unmatched.push(task);continue;}
    const group=candidates[0],entry=grouped.get(group.groupId)||{group,tasks:[]};
    entry.tasks.push(task);grouped.set(group.groupId,entry);
  }
  return {groups:[...grouped.values()],unmatched,observedAt:Date.now()};
}
