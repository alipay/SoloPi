import type {ClientTask} from './client-tasks';

// Match the visible update-time column. Invalid/missing times sort last, with
// stable identity ties so client response order cannot move otherwise equal rows.
export function compareTaskTime(a:{updatedAt?:string;clientId:string;id:string},b:{updatedAt?:string;clientId:string;id:string}){
 const time=(value?:string)=>{const n=Date.parse(value||'');return Number.isFinite(n)?n:0;};
 return time(b.updatedAt)-time(a.updatedAt)||a.clientId.localeCompare(b.clientId)||a.id.localeCompare(b.id);
}

// Publish one completed refresh, never the order in which client/pages arrive.
// A failed client keeps its last complete rows rather than disappearing.
export function mergeClientTaskRefresh(previous:ClientTask[],clients:{clientId:string}[],results:PromiseSettledResult<ClientTask[]>[]){
 const rows=clients.flatMap((client,index)=>{const result=results[index];return result?.status==='fulfilled'?result.value:previous.filter(t=>t.clientId===client.clientId);});
 return [...new Map(rows.map(t=>[t.clientId+':'+t.id,t])).values()].sort(compareTaskTime);
}
