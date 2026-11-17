import {afterEach,expect,it,vi} from 'vitest';
import {readCompletedReport,saveCompletedReport,invalidateCompletedReport,isCompletedReport,completedMediaCache} from '../src/api/report-cache';
afterEach(()=>{localStorage.clear();vi.useRealTimers();vi.unstubAllGlobals();});
it('keeps completed reports across memory lifetimes and isolates client/task/case',()=>{
 const a=JSON.stringify(['a','task','case']),b=JSON.stringify(['b','task','case']);
 saveCompletedReport(a,{status:'success',identity:{taskId:'task',caseId:'case'},results:[{stepId:'actual'}]});
 expect(readCompletedReport(a).results[0].stepId).toBe('actual');expect(readCompletedReport(b)).toBeNull();
 invalidateCompletedReport('b','task');expect(readCompletedReport(a)).not.toBeNull();invalidateCompletedReport('a','task');expect(readCompletedReport(a)).toBeNull();
});
it('expires completed records and caps stored data',()=>{
 vi.useFakeTimers();saveCompletedReport('a',{status:'success'});vi.advanceTimersByTime(8*86400000);expect(readCompletedReport('a')).toBeNull();
 saveCompletedReport('huge',{status:'success',body:'x'.repeat(2*1024*1024)});expect(readCompletedReport('huge')).toBeNull();
 saveCompletedReport('active',{status:'running'});expect(readCompletedReport('active')).toBeNull();expect(isCompletedReport('running')).toBe(false);expect(isCompletedReport('pending')).toBe(false);
});
it('storage denial never breaks a report read',()=>{vi.spyOn(Storage.prototype,'setItem').mockImplementationOnce(()=>{throw Error('quota')});expect(()=>saveCompletedReport('a',{status:'failed'})).not.toThrow();});

it('persists image blobs across instances and refresh isolates late old writes',async()=>{
 vi.stubGlobal('Blob',(await import('node:buffer')).Blob);
 const rows=new Map<string,Response>();const cache={match:async(r:Request)=>rows.get(r.url)?.clone(),put:async(r:Request,v:Response)=>{rows.set(r.url,v.clone())},keys:async()=>[...rows.keys()].map(u=>new Request(u)),delete:async(r:Request)=>rows.delete(r.url)};
 vi.stubGlobal('caches',{open:async()=>cache});const first=completedMediaCache('client-task');
 await first.set('image',new Blob(['pixels'],{type:'image/png'}));
 expect(await (await completedMediaCache('client-task').get('image'))?.text()).toBe('pixels');
 await first.clear();await first.set('image',new Blob(['late stale pixels']));
 expect(await completedMediaCache('client-task').get('image')).toBeUndefined();
});
