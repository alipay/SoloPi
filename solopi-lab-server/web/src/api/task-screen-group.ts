import type {Catalog} from './lab';

// A group label is not a screen identity. Duplicate registrations with the
// exact same role/device membership resolve to the same physical screens.
export function taskScreenGroup(catalog:Catalog|undefined, task:any) {
 const binding=task.groupExecution?.groupId||task.group?.groupId;
 const devices=Object.entries(task.devices||{}).filter(([,d]:any)=>d?.serial) as [string,{serial:string}][];
 const matches=catalog?.groups.filter(g=>!(g as any).deleted&&(binding?g.groupId===binding:devices.length>0&&devices.every(([role,d])=>g.members.some(m=>m.role===role&&catalog.devices.some(x=>x.deviceId===m.deviceId&&x.serial===d.serial)))))||[];
 if(matches.length===1)return matches[0];
 const membership=(group:Catalog['groups'][number])=>JSON.stringify(group.members.map(m=>[m.role,m.deviceId]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
 if(matches.length>1&&new Set(matches.map(membership)).size===1)return [...matches].sort((a,b)=>a.groupId.localeCompare(b.groupId))[0];
 return undefined;
}
