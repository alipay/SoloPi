// Completed reports are immutable until an explicit refresh. Failures and active
// reports are never persisted. Cache access is optional and cannot block reads.
const STORE='solopi.completed-reports.v1', TTL=7*86400000, LIMIT=3*1024*1024;
export const isCompletedReport=(status?:string)=>['success','failed','stopped','cancelled','succeeded'].includes(status||'');
type Entry={at:number;value:any};
let lastRaw='',lastEntries:Record<string,Entry>={};
function entries():Record<string,Entry>{try{const raw=localStorage.getItem(STORE)||'{}';if(raw!==lastRaw){lastEntries=JSON.parse(raw);lastRaw=raw;}return {...lastEntries};}catch{return {}}}
export function readCompletedReport(key:string){const e=entries()[key];return e&&Date.now()-e.at<TTL?e.value:null;}
export function saveCompletedReport(key:string,value:any){if(!isCompletedReport(value?.status)||value.evidenceReady===false)return;try{const all=entries();delete all[key];all[key]={at:Date.now(),value};let keys=Object.keys(all);let text=JSON.stringify(all);while(keys.length>100||text.length*2>LIMIT){delete all[keys.shift()!];text=JSON.stringify(all);if(!keys.length)break;}localStorage.setItem(STORE,text);}catch{/* Browser quota/privacy mode: use normal reads. */}}
export function invalidateCompletedReport(clientId?:string,taskId?:string){try{if(!clientId){localStorage.removeItem(STORE);return}const all=entries();for(const k of Object.keys(all)){const parts=JSON.parse(k);if(parts[0]===clientId&&parts[1]===taskId)delete all[k];}localStorage.setItem(STORE,JSON.stringify(all));}catch{}}
const MEDIA='solopi.report-media.v1';
function mediaRequest(scope:string,key:string){return new Request(new URL('/__report_cache__/'+encodeURIComponent(scope)+'/'+encodeURIComponent(key),location.origin))}
export function completedMediaCache(baseScope:string){const generationKey='solopi.report-media-generation.'+baseScope;let generation='0';try{generation=localStorage.getItem(generationKey)||'0'}catch{}const scope=baseScope+'@'+generation;return{
 async get(key:string):Promise<Blob|undefined>{try{if(!globalThis.caches)return;const c=await caches.open(MEDIA),r=await c.match(mediaRequest(scope,key));if(!r)return;if(Date.now()-Number(r.headers.get('x-stored-at'))>TTL){await c.delete(mediaRequest(scope,key));return}return await r.blob();}catch{return}},
 async set(key:string,value:Blob){try{if(!globalThis.caches||value.size>8*1024*1024)return;const c=await caches.open(MEDIA);await c.put(mediaRequest(scope,key),new Response(value,{headers:{'content-type':value.type,'x-stored-at':String(Date.now()),'x-bytes':String(value.size)}}));const keys=await c.keys();let bytes=0;for(const request of [...keys].reverse()){const r=await c.match(request);bytes+=Number(r?.headers.get('x-bytes')||0);if(bytes>48*1024*1024||keys.indexOf(request)<keys.length-128)await c.delete(request);}}catch{}},
 async clear(){try{localStorage.setItem(generationKey,String(Date.now()));if(!globalThis.caches)return;const c=await caches.open(MEDIA),prefix=new URL('/__report_cache__/'+encodeURIComponent(scope)+'/',location.origin).href;for(const request of await c.keys())if(request.url.startsWith(prefix))await c.delete(request);}catch{}}
};}
