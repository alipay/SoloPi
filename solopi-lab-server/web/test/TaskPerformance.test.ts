import {beforeEach,it,expect,vi} from 'vitest';
import {loadTaskPerformance} from '../src/api/task-performance';
const api=vi.hoisted(()=>({read:vi.fn()}));vi.mock('../src/api/client-task-read',()=>({readDesktop:api.read}));
beforeEach(()=>{api.read.mockReset();});
it('loads all sample pages independently and preserves failed samples',async()=>{
 api.read.mockImplementation(async(_c,tool,args)=>tool==='read_task_report'?{task:{id:'task',status:'success',performanceTargets:['phone','glasses'],performanceOptions:{phone:true,glasses:true}}}:args.target==='glasses'?{id:'g',target:'glasses',serial:'g',samples:[{error:'no process'}],total:1,nextOffset:null}:{id:'p',target:'phone',serial:'p',samples:[{cpuPercent:args.offset?80:20}],total:2,nextOffset:args.offset?null:1});
 const r=await loadTaskPerformance('client','task',new AbortController().signal);
 expect(r.performanceReports.phone.samples).toEqual([{cpuPercent:20},{cpuPercent:80}]);expect(r.performanceReports.glasses.samples[0].error).toBe('no process');expect(r.performanceErrors).toEqual({});
});
it('retains the successful target when the other read fails',async()=>{
 api.read.mockImplementation(async(_c,tool,args)=>{if(tool==='read_task_report')return{task:{id:'task',performanceTargets:['phone','glasses']}};if(args.target==='glasses')throw Error('offline');return{id:'p',target:'phone',samples:[{}],total:1,nextOffset:null}});
 const r=await loadTaskPerformance('client','task',new AbortController().signal);expect(r.performanceReports.phone.samples).toHaveLength(1);expect(r.performanceErrors.glasses).toBe('offline');
});
it('rejects a nonadvancing page and never invents an empty performance report',async()=>{
 api.read.mockImplementation(async(_c,tool)=>tool==='read_task_report'?{task:{id:'task',performanceTargets:['phone']}}:{id:'p',samples:[{}],total:2,nextOffset:0});
 const r=await loadTaskPerformance('client','task',new AbortController().signal);expect(r.performanceReports.phone).toBeUndefined();expect(r.performanceErrors.phone).toMatch(/pagination/);
});
