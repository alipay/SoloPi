import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';
import {NativeTaskReport,clearNativeReportCache} from '../src/pages/NativeTaskReport';
const api=vi.hoisted(()=>({lab:vi.fn()}));vi.mock('../src/api/lab',()=>({lab:api.lab}));
vi.mock('../src/components/TaskLiveScreens',()=>({TaskLiveScreens:(p:any)=><div data-testid="task-live-screens" data-task={p.task.id}/> }));
let commands:Map<string,any>;
afterEach(cleanup);beforeEach(()=>{clearNativeReportCache();location.hash='#/native-report?clientId=lab-a&taskId=old-cli-task&caseId=failed-case';commands=new Map();api.lab.mockReset();api.lab.mockImplementation(async(path:string,body:any)=>{if(path==='commands'){commands.set(body.requestId,body);return {};}
 const c=commands.get(path.slice('commands/'.length));let result:any={success:true};
 if(c.tool==='read_task_report')result.task={id:'old-cli-task',name:'Existing regression',status:'failed',summary:{completed:1},totalCaseCount:1,cases:[{caseId:'failed-case',caseOrdinal:31,name:'Exact failed case',status:'failed'}],nextOffset:null};
 if(c.tool==='read_case_results')Object.assign(result,{status:'failed',caseName:'Exact failed case',identity:{taskId:'old-cli-task',caseId:'failed-case',logs:[{path:'/owned.log',deviceType:'glasses'}]},caseSnapshot:{id:'failed-case',name:'Exact failed case',steps:[]},results:[{stepId:'observe',stepName:'Observe result',status:'failed'}],artifacts:{recordings:{items:[{deviceType:'glasses',success:false,errorCode:'SCRCPY_RECORDING_FAILED'}]}},nextOffset:null});
 if(c.tool==='search_task_log')Object.assign(result,{taskId:'old-cli-task',scope:{caseId:'failed-case'},matches:[{line:4,text:'saved case-owned log'}],nextLine:81});
 if(c.tool==='read_case_results'&&c.args.view==='artifacts')result={success:true,identity:{taskId:'old-cli-task',caseId:'failed-case'},artifacts:[{ref:{kind:'logs',index:0},detail:{path:'/owned.log',deviceType:'glasses'}},{ref:{kind:'recordings',index:0},detail:{deviceType:'glasses',success:false,errorCode:'SCRCPY_RECORDING_FAILED'}}],nextOffset:null};
 return {status:'succeeded',result};});});
async function originalFrame(){const frame=await screen.findByTitle('Desktop 原生测试报告') as HTMLIFrameElement;const post=vi.spyOn(frame.contentWindow!,'postMessage');fireEvent.load(frame);await waitFor(()=>expect(post).toHaveBeenCalled());return{frame,post};}
function fromFrame(frame:HTMLIFrameElement,data:any,origin=location.origin){window.dispatchEvent(new MessageEvent('message',{origin,source:frame.contentWindow,data:{taskId:'old-cli-task',caseId:'failed-case',...data}}));}
it('case page hosts the original Desktop renderer and passes intact evidence instead of replacing it with the new workbench',async()=>{render(<NativeTaskReport/>);const {post}=await originalFrame();await waitFor(()=>expect(post.mock.calls.some(c=>c[0].task.cases[0].artifacts?.recordings?.[0]?.errorCode==='SCRCPY_RECORDING_FAILED')).toBe(true));const payload=post.mock.calls.at(-1)![0];expect(payload.task.id).toBe('old-cli-task');expect(payload.caseId).toBe('failed-case');expect(payload.task.cases[0].caseSnapshot.id).toBe('failed-case');expect(document.querySelector('.rw-workbench')).toBeNull();expect(screen.queryByRole('button',{name:'导出日志'})).toBeNull();expect(screen.queryByRole('button',{name:'查看当前设备组投屏'})).toBeNull();expect(screen.queryByRole('button',{name:'任务操作与性能'})).toBeNull();expect([...commands.values()].some(c=>c.tool==='submit_task')).toBe(false)});
it('rejects another task returned by Desktop',async()=>{api.lab.mockImplementation(async(path:string)=>path==='commands'?{}:{status:'succeeded',clientId:'lab-a',result:{success:true,task:{id:'another-task',cases:[]}}});render(<NativeTaskReport/>);await screen.findByText(/Client task identity mismatch|Desktop 返回了其他任务/);expect(document.querySelector('iframe')).toBeNull()});
it('rejects case evidence with another identity',async()=>{const original=api.lab.getMockImplementation()!;api.lab.mockImplementation(async(path:string,body:any)=>{const r=await original(path,body);if(path.startsWith('commands/')&&r.result?.identity)r.result.identity.caseId='other-case';return r});render(<NativeTaskReport/>);await screen.findByText('Client case identity mismatch');expect(document.querySelector('iframe')).toBeNull()});
it('task URL loads only the case index and uses the original task-report renderer',async()=>{location.hash='#/native-report?clientId=lab-a&taskId=old-cli-task';render(<NativeTaskReport/>);const {post}=await originalFrame();expect([...commands.values()].filter(c=>c.args.view!=='summary').map(c=>c.tool)).toEqual(['read_task_report']);expect(post.mock.calls.at(-1)![0].caseId).toBeUndefined();expect(post.mock.calls.at(-1)![0].task.cases[0].caseName).toBe('Exact failed case');expect(document.querySelector('.screen-frame')).toBeNull()});
it('original flow back and case navigation validate frame, origin, task and case identity',async()=>{render(<NativeTaskReport/>);const {frame}=await originalFrame();fromFrame(frame,{type:'desktop-report-back'},'https://other.test');expect(location.hash).toContain('caseId=failed-case');fromFrame(frame,{type:'desktop-report-back',taskId:'foreign'});expect(location.hash).toContain('caseId=failed-case');fromFrame(frame,{type:'desktop-report-case',selectedCaseId:'not-a-case'});expect(location.hash).toContain('caseId=failed-case');fromFrame(frame,{type:'desktop-report-back'});await waitFor(()=>expect(location.hash).toBe('#/native-report?clientId=lab-a&taskId=old-cli-task'))});
it('case-owned artifact clicks adapt the original Desktop open-file action without accepting arbitrary paths',async()=>{render(<NativeTaskReport/>);const {frame}=await originalFrame();await waitFor(()=>expect([...commands.values()].filter(c=>c.args.view==='artifacts')).toHaveLength(1));fromFrame(frame,{type:'desktop-report-artifact',path:'/owned.log'});await screen.findByText('4 saved case-owned log',{exact:false});expect([...commands.values()].at(-1).args).toMatchObject({taskId:'old-cli-task',caseId:'failed-case',deviceType:'glasses',fromLine:1});fireEvent.click(screen.getByRole('button',{name:'关闭产物'}));fromFrame(frame,{type:'desktop-report-artifact',path:'/foreign.log'});await screen.findByText('该文件不属于当前用例')});
it('starts the index, details and attachments in parallel and can show the original case flow before a slow index completes',async()=>{const original=api.lab.getMockImplementation()!;let release!:()=>void;const pending=new Promise<void>(r=>release=r);api.lab.mockImplementation(async(path:string,body:any)=>{if(path.startsWith('commands/')){const c=commands.get(path.slice(9));if(c?.tool==='read_task_report')await pending}return original(path,body)});render(<NativeTaskReport/>);await originalFrame();expect([...commands.values()].filter(c=>c.args.view!=='summary').slice(0,3).map(c=>c.tool)).toEqual(['read_task_report','read_case_results','read_case_results']);release()});
it('refresh keeps the original iframe mounted and uses current case identity',async()=>{render(<NativeTaskReport/>);const {frame}=await originalFrame();fireEvent.click(screen.getByRole('button',{name:'刷新报告'}));await waitFor(()=>expect([...commands.values()].filter(c=>c.tool==='read_case_results'&&c.args.view==='artifacts')).toHaveLength(2));expect(screen.getByTitle('Desktop 原生测试报告')).toBe(frame)});
it('warm navigation keeps the existing report cache rather than rereading all evidence',async()=>{const now=Date.now(),date=vi.spyOn(Date,'now').mockReturnValue(now);const view=render(<NativeTaskReport/>);await originalFrame();await waitFor(()=>expect([...commands.values()].filter(c=>c.tool==='read_case_results')).toHaveLength(2));view.unmount();const before=commands.size;date.mockReturnValue(now+60000);render(<NativeTaskReport/>);await originalFrame();expect(commands.size).toBe(before);date.mockRestore()});
it('clicking an original task card starts the selected case reads without a full page reload',async()=>{location.hash='#/native-report?clientId=lab-a&taskId=old-cli-task';render(<NativeTaskReport/>);const {frame}=await originalFrame();window.dispatchEvent(new MessageEvent('message',{origin:location.origin,source:frame.contentWindow,data:{type:'desktop-report-case',taskId:'old-cli-task',selectedCaseId:'failed-case'}}));await waitFor(()=>expect([...commands.values()].filter(c=>c.tool==='read_case_results')).toHaveLength(2));expect(location.hash).toContain('caseId=failed-case');await screen.findByTitle('Desktop 原生测试报告')});
it('visible original case cards hydrate lazily and image previews use only report-owned artifacts',async()=>{
 vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn(()=> 'blob:original-thumbnail'),revokeObjectURL:vi.fn()}));
 const original=api.lab.getMockImplementation()!;api.lab.mockImplementation(async(path:string,body:any)=>{const r=await original(path,body);const c=commands.get(path.slice(9));if(c?.tool==='read_case_results'&&c.args.view==='artifacts'){r.result.artifacts.push({ref:{kind:'screenshots',index:0},detail:{path:'/owned.png',deviceType:'glasses'}});r.result.mediaPreviews=[{ref:{kind:'screenshots',index:0},result:{identity:{taskId:'old-cli-task',caseId:'failed-case'},mime:'image/png',data:btoa('image')}}]}return r});
 location.hash='#/native-report?clientId=lab-a&taskId=old-cli-task';render(<NativeTaskReport/>);const {frame,post}=await originalFrame();expect([...commands.values()].filter(c=>c.args.view!=='summary')).toHaveLength(1);fromFrame(frame,{type:'desktop-report-visible-case',caseId:undefined,selectedCaseId:'failed-case'});await waitFor(()=>expect(post.mock.calls.some(c=>c[0].task?.cases[0].artifacts?.screenshots?.[0]?.path==='/owned.png')).toBe(true));fromFrame(frame,{type:'desktop-report-read-image',caseId:undefined,path:'/owned.png',id:'preview'});await waitFor(()=>expect(post.mock.calls.some(c=>c[0].type==='desktop-report-image-result'&&c[0].result.dataUrl==='blob:original-thumbnail')).toBe(true));fromFrame(frame,{type:'desktop-report-read-image',caseId:undefined,path:'/foreign.png',id:'foreign'});await waitFor(()=>expect(post.mock.calls.some(c=>c[0].id==='foreign'&&c[0].result.success===false)).toBe(true));expect([...commands.values()].some(c=>c.tool==='read_case_artifact')).toBe(false);vi.unstubAllGlobals();
});
it('shows steps before slow attachments finish and exposes independent loading states',async()=>{
 const original=api.lab.getMockImplementation()!;let release!:()=>void;
 const slow=new Promise<void>(r=>release=r);
 api.lab.mockImplementation(async(path:string,body:any)=>{const command=commands.get(path.slice(9));if(command?.tool==='read_case_results'&&command.args.view==='artifacts')await slow;return original(path,body)});
 location.hash='#/native-report?clientId=lab-a&taskId=old-cli-task';render(<NativeTaskReport/>);
 const {frame,post}=await originalFrame();
 expect(post.mock.calls.at(-1)![0].task.cases[0].detailLoading).toBe(true);
 fromFrame(frame,{type:'desktop-report-visible-case',caseId:undefined,selectedCaseId:'failed-case'});
 await waitFor(()=>expect(post.mock.calls.some(c=>c[0].task?.cases[0]?.results?.[0]?.stepId==='observe'&&c[0].task.cases[0].artifactsLoading===true)).toBe(true));
 release();await waitFor(()=>expect(post.mock.calls.some(c=>c[0].task?.cases[0]?.artifactsLoading===false)).toBe(true));
 const count=commands.size;cleanup();render(<NativeTaskReport/>);const again=await originalFrame();
 fromFrame(again.frame,{type:'desktop-report-visible-case',caseId:undefined,selectedCaseId:'failed-case'});
 await waitFor(()=>expect(again.post.mock.calls.some(c=>c[0].task?.cases[0]?.results?.[0]?.stepId==='observe')).toBe(true));
 expect(commands.size).toBe(count);
 cleanup();clearNativeReportCache(false);render(<NativeTaskReport/>);const restored=await originalFrame();
 expect(restored.post.mock.calls.at(-1)![0].task.cases[0].results[0].stepId).toBe('observe');
 expect(commands.size).toBe(count);
});
it('opens a task-card artifact in a modal without navigating away from the task',async()=>{
 location.hash='#/native-report?clientId=lab-a&taskId=old-cli-task';render(<NativeTaskReport/>);const {frame,post}=await originalFrame();
 fromFrame(frame,{type:'desktop-report-visible-case',caseId:undefined,selectedCaseId:'failed-case'});
 await waitFor(()=>expect(post.mock.calls.some(c=>c[0].task?.cases[0].artifacts?.logs?.[0]?.path==='/owned.log')).toBe(true));
 fromFrame(frame,{type:'desktop-report-artifact',caseId:undefined,path:'/owned.log'});await screen.findByText('4 saved case-owned log',{exact:false});
 expect(screen.getByRole('dialog',{name:'执行产物查看'})).toBeTruthy();expect(location.hash).not.toContain('caseId=');expect(screen.getByRole('button',{name:'下载产物'})).toBeTruthy();
});
it('hydrates performance for an existing terminal report and caches samples across visits',async()=>{
 location.hash='#/native-report?clientId=lab-a&taskId=old-cli-task';
 const original=api.lab.getMockImplementation()!;
 api.lab.mockImplementation(async(path:string,body:any)=>{
  const c=commands.get(path.slice(9));
  if(c?.tool==='read_performance_report')return{status:'succeeded',result:{success:true,id:c.args.target,target:c.args.target,samples:[{cpuPercent:77}],total:1,nextOffset:null}};
  const r=await original(path,body);
  if(c?.tool==='read_task_report'&&c.args.view==='summary')Object.assign(r.result.task,{performanceOptions:{phone:true,glasses:true},performanceTargets:['phone','glasses']});
  return r;
 });
 const view=render(<NativeTaskReport/>);const first=await originalFrame();
 await waitFor(()=>expect(first.post.mock.calls.some(c=>c[0].task.performanceReports?.phone?.samples?.[0]?.cpuPercent===77)).toBe(true));
 expect([...commands.values()].filter(c=>c.tool==='read_performance_report')).toHaveLength(2);
 view.unmount();const count=commands.size;clearNativeReportCache(false);render(<NativeTaskReport/>);const second=await originalFrame();
 expect(second.post.mock.calls.at(-1)![0].task.performanceReports.glasses.samples).toHaveLength(1);expect(commands.size).toBe(count);
});

it('shows the shared live group above the report only while the task is executing',async()=>{
 location.hash='#/native-report?clientId=lab-a&taskId=old-cli-task';let status='running';
 const original=api.lab.getMockImplementation()!;api.lab.mockImplementation(async(path:string,body:any)=>{const r=await original(path,body);if(r.result?.task)r.result.task.status=status;return r});
 render(<NativeTaskReport/>);await originalFrame();const screens=screen.getByTestId('task-live-screens');expect(screens.dataset.task).toBe('old-cli-task');expect(screens.compareDocumentPosition(screen.getByTitle('Desktop 原生测试报告'))&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 status='success';fireEvent.click(screen.getByRole('button',{name:'刷新报告'}));await waitFor(()=>expect(screen.queryByTestId('task-live-screens')).toBeNull());
});
it('shows the original validation rejection instead of a nonexistent native report or invented execution results',async()=>{
 location.hash='#/native-report?clientId=lab-a&taskId=old-cli-task';const original=api.lab.getMockImplementation()!;
 api.lab.mockImplementation(async(path:string,body:any)=>{if(path==='tasks/old-cli-task')return {taskId:'old-cli-task',clientId:'lab-a',name:'Existing library run',status:'failed',group:{name:'Test group'},cases:[{caseId:'broken',name:'Existing draft'}],report:{validation:{success:false,phase:'validation',validationErrors:[{caseId:'broken',caseName:'Existing draft',code:'CASE_EDGE_CYCLE',message:'End connects to itself'}]}}};if(path.startsWith('commands/'))return {status:'succeeded',result:{success:false,errorCode:'REPORT_DETAIL_NOT_FOUND',error:'Missing native report'}};return original(path,body);});
 render(<NativeTaskReport/>);await screen.findByText('提交校验未通过 · 未执行');expect(screen.getByText('End connects to itself')).toBeTruthy();expect(screen.getByText('设备组：Test group · 已执行 0 / 1 条用例')).toBeTruthy();expect(screen.queryByTitle('Desktop 原生测试报告')).toBeNull();expect(screen.queryByText('Missing native report')).toBeNull();expect([...commands.values()].every(c=>c.tool.startsWith('read_'))).toBe(true);
});
