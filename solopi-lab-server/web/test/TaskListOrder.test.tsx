import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {compareTaskTime,mergeClientTaskRefresh} from '../src/api/task-list-order';
import {clearTaskWorkspaceCache,saveTaskWorkspaceCache} from '../src/api/task-workspace-cache';
const mocks=vi.hoisted(()=>({lab:vi.fn(),list:vi.fn()}));
vi.mock('../src/api/lab',()=>({lab:mocks.lab}));
vi.mock('../src/api/client-tasks',()=>({listClientTasks:mocks.list,nativeTaskLink:(c:string,t:string)=>`#/native-report?clientId=${c}&taskId=${t}`}));
vi.mock('@desktop-report/ReportWorkbench',()=>({Status:({value}:any)=><span>{value}</span>}));
vi.mock('../src/pages/NativeTaskReport',()=>({NativeTaskReport:()=>null}));
import {ExecutionTasks} from '../src/pages/ExecutionTasks';
const clients=[{clientId:'a',hostname:'Mac',updatedAt:1,devices:[],groups:[],cases:[]},{clientId:'b',hostname:'Linux',updatedAt:1,devices:[],groups:[],cases:[]}];
const row=(id:string,clientId:string,date:string,status='success')=>({id,name:id,clientId,hostname:clientId==='a'?'Mac':'Linux',updatedAt:date,status});
const ordered=()=>screen.queryAllByRole('link').filter(a=>a.getAttribute('href')?.startsWith('#/native-report')).map(a=>a.textContent);
beforeEach(()=>{clearTaskWorkspaceCache();sessionStorage.clear();location.hash='#/tasks';mocks.lab.mockImplementation(async(p:string)=>({items:p==='catalog'?clients:[]}));});
afterEach(()=>{cleanup();vi.useRealTimers();vi.clearAllMocks();clearTaskWorkspaceCache();sessionStorage.clear();});
it('sorts all computers and fallback tasks together, then keeps descending order after filters',async()=>{
 mocks.lab.mockImplementation(async(p:string)=>({items:p==='catalog'?clients:[{taskId:'server-middle',clientId:'b',name:'server-middle',status:'failed',updatedAt:Date.parse('2026-11-10T09:00:00Z'),group:{name:'Linux group'}}]}));
 mocks.list.mockImplementation(async(c:any)=>c.clientId==='a'?[row('old-a','a','2026-11-08T10:00:00Z','failed'),row('new-a','a','2026-11-10T10:00:00Z','failed')]:[row('middle-b','b','2026-11-09T10:00:00Z')]);
 render(<ExecutionTasks/>);await screen.findByRole('link',{name:'new-a'});
 expect(ordered()).toEqual(['new-a','server-middle','middle-b','old-a']);
 fireEvent.change(screen.getByLabelText('筛选任务状态'),{target:{value:'failed'}});expect(ordered()).toEqual(['new-a','server-middle','old-a']);
 fireEvent.change(screen.getByLabelText('筛选电脑'),{target:{value:'a'}});expect(ordered()).toEqual(['new-a','old-a']);
 fireEvent.change(screen.getByLabelText('开始时间'),{target:{value:'2026-11-09T00:00'}});expect(ordered()).toEqual(['new-a']);
});
it('waits for the complete multi-client snapshot instead of publishing each arriving page',async()=>{
 let finish!:(v:any)=>void;const delayed=new Promise(r=>finish=r);
 mocks.list.mockImplementation((c:any)=>c.clientId==='a'?Promise.resolve([row('first-client','a','2026-11-09')]):delayed);
 render(<ExecutionTasks/>);await act(async()=>{await Promise.resolve();});expect(ordered()).toEqual([]);expect(screen.getByText('正在读取任务列表…')).toBeTruthy();
 await act(async()=>finish([row('last-client-newest','b','2026-11-10')]));expect(ordered()).toEqual(['last-client-newest','first-client']);
});
it('keeps the existing list throughout a background refresh and preserves a failed computer',async()=>{
 vi.useFakeTimers();let finish!:(v:any)=>void;let refresh=false;const delayed=new Promise(r=>finish=r);
 mocks.list.mockImplementation((c:any)=>!refresh?Promise.resolve([row(c.clientId,c.clientId,'2026-11-09')]):c.clientId==='a'?delayed:Promise.reject(Error('offline')));
 render(<ExecutionTasks/>);await act(async()=>{await Promise.resolve();});expect(ordered()).toEqual(['a','b']);refresh=true;
 await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});expect(ordered()).toEqual(['a','b']);
 await act(async()=>finish([row('new-a','a','2026-11-10')]));expect(ordered()).toEqual(['new-a','b']);expect(screen.getByRole('alert').textContent).toContain('offline');
});
it('ties and missing timestamps are deterministic regardless of client completion order',()=>{
 const a=row('same','a','2026-11-10T00:00:00Z'),b=row('same','b','2026-11-10T00:00:00Z'),missing=row('missing','a','invalid');
 expect([missing,b,a].sort(compareTaskTime)).toEqual([a,b,missing]);
 expect(mergeClientTaskRefresh([b],clients,[{status:'fulfilled',value:[a]},{status:'rejected',reason:Error()}])).toEqual([a,b]);
});

it('shows the last complete cached list immediately with a refresh indicator, then replaces it atomically',async()=>{
 saveTaskWorkspaceCache({nativeTasks:[row('cached-task','a','2026-11-08')],catalogs:clients,tasks:[],complete:true,cachedAt:Date.now()-60000});let finish!:()=>void;const wait=new Promise<void>(r=>finish=r);mocks.list.mockImplementation(async(c:any)=>{await wait;return [row('fresh-'+c.clientId,c.clientId,'2026-11-10')];});
 render(<ExecutionTasks/>);expect(ordered()).toEqual(['cached-task']);expect(screen.getByRole('status').textContent).toContain('正在更新最新任务列表');await act(async()=>{await Promise.resolve();});expect(ordered()).toEqual(['cached-task']);await act(async()=>finish());expect(ordered()).toEqual(['fresh-a','fresh-b']);expect(screen.getByRole('status').textContent).toBe('已更新');
});

it('records the whole initial data load rather than a single page request or DOM render',async()=>{
 let clock=0;const timer=vi.spyOn(performance,'now').mockImplementation(()=>clock);
 let catalogDone!:(v:any)=>void,serverDone!:(v:any)=>void,aDone!:(v:any)=>void,bDone!:(v:any)=>void;
 const catalogWait=new Promise(r=>catalogDone=r),serverWait=new Promise(r=>serverDone=r),aWait=new Promise(r=>aDone=r),bWait=new Promise(r=>bDone=r);
 mocks.lab.mockImplementation((p:string)=>p==='catalog'?catalogWait:p==='tasks'?serverWait:Promise.resolve({success:true}));
 mocks.list.mockImplementation((c:any)=>c.clientId==='a'?aWait:bWait);
 const completed=()=>mocks.lab.mock.calls.filter(([p,args])=>p==='diagnostics/events'&&args.toolName==='task_list.cold.complete');
 try{
  render(<ExecutionTasks/>);await act(async()=>{await Promise.resolve();});
  clock=1840;await act(async()=>catalogDone({items:clients}));expect(completed()).toHaveLength(0);
  clock=8000;await act(async()=>aDone([row('first','a','2026-11-16')]));expect(completed()).toHaveLength(0);
  clock=12000;await act(async()=>bDone([row('last','b','2026-11-16')]));expect(ordered()).toEqual(['first','last']);expect(completed()).toHaveLength(0);
  clock=18000;await act(async()=>serverDone({items:[]}));expect(completed()).toHaveLength(1);
  expect(completed()[0][1]).toMatchObject({durationMs:18000,status:'succeeded'});
 }finally{timer.mockRestore();}
});
