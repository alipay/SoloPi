import {beforeEach,it,expect,vi} from 'vitest';
import {readDesktop} from '../src/api/client-task-read';
const api=vi.hoisted(()=>({lab:vi.fn()}));vi.mock('../src/api/lab',()=>({lab:api.lab}));
beforeEach(()=>api.lab.mockReset());
it.each(['cli-task-original','agent-original'])('uses the original Client task identity for %s',async taskId=>{
 api.lab.mockImplementation(async(path:string)=>path==='commands'?{}:{status:'succeeded',result:{success:true,taskId,scope:{caseId:'case-original'},matches:[]}});
 await readDesktop('client-original','search_task_log',{taskId,caseId:'case-original'},new AbortController().signal);
 expect(api.lab.mock.calls[0][1]).toMatchObject({clientId:'client-original',tool:'search_task_log',args:{taskId,caseId:'case-original'}});
});
it('a pending request is reconciled by reading its receipt without posting it again',async()=>{
 api.lab.mockResolvedValue({status:'succeeded',result:{success:true,taskId:'original',scope:{caseId:'case'}}});const control={requestId:'same-request',submitted:true,settled:false};
 await readDesktop('client','search_task_log',{taskId:'original',caseId:'case'},new AbortController().signal,control);expect(api.lab.mock.calls.filter(c=>c[0]!=='diagnostics/events').map(c=>c[0])).toEqual(['commands/same-request']);expect(api.lab.mock.calls.filter(c=>c[0]==='commands')).toHaveLength(0);expect(control.settled).toBe(true);
});
it('cannot turn a report read into a second task execution entry',async()=>{
 await expect(readDesktop('client','submit_task',{taskId:'original'},new AbortController().signal)).rejects.toThrow('Read-only');expect(api.lab).not.toHaveBeenCalled();
});
it('supports the legacy performance response bound to the requested target',async()=>{
 api.lab.mockImplementation(async(path:string)=>path==='commands'?{}:{status:'succeeded',result:{success:true,target:'phone',samples:[],total:0}});
 await expect(readDesktop('client','read_performance_report',{taskId:'original',target:'phone'},new AbortController().signal)).resolves.toMatchObject({target:'phone'});
});
it.each([{target:'glasses',samples:[]},{target:'phone',taskId:'foreign',samples:[]},{target:'phone'}])('rejects mismatched performance evidence %j',async result=>{
 api.lab.mockImplementation(async(path:string)=>path==='commands'?{}:{status:'succeeded',result:{success:true,...result}});
 await expect(readDesktop('client','read_performance_report',{taskId:'original',target:'phone'},new AbortController().signal)).rejects.toThrow('performance identity');
});
it('preserves typed report-not-found errors for submission receipt recovery',async()=>{api.lab.mockImplementation(async(path:string)=>path==='commands'?{}:{status:'succeeded',result:{success:false,errorCode:'REPORT_DETAIL_NOT_FOUND',error:'Missing native report'}});await expect(readDesktop('client','read_task_report',{taskId:'original'},new AbortController().signal)).rejects.toMatchObject({code:'REPORT_DETAIL_NOT_FOUND',message:'Missing native report'});});
