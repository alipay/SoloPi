import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ExecutionTasks} from '../src/pages/ExecutionTasks';
import {clearTaskWorkspaceCache} from '../src/api/task-workspace-cache';
import {readTaskListView,saveTaskListView} from '../src/api/task-list-view';
const mocks=vi.hoisted(()=>({lab:vi.fn(),list:vi.fn()}));
vi.mock('../src/api/lab',()=>({lab:(...args:any[])=>mocks.lab(...args)}));
vi.mock('../src/api/client-tasks',()=>({listClientTasks:(...args:any[])=>mocks.list(...args),nativeTaskLink:(c:string,t:string)=>`#/native-report?clientId=${c}&taskId=${t}`}));
vi.mock('../src/api/task-navigation',()=>({prefetchTask:()=>{},seedTask:()=>{}}));
vi.mock('../src/pages/NativeTaskReport',()=>({NativeTaskReport:(p:any)=><section data-testid="native-report">{p.clientId}:{p.taskId}<a href="#/tasks">返回全部任务</a></section>}));
beforeEach(()=>{clearTaskWorkspaceCache();sessionStorage.clear();location.hash='#/tasks';mocks.lab.mockReset();mocks.list.mockReset();mocks.lab.mockImplementation(async(path:string)=>path==='catalog'?{items:[{clientId:'c',hostname:'电脑 A',groups:[],cases:[]}]}:path==='tasks'?{items:[]}:path==='tasks/task-a'?{taskId:'task-a',clientId:'c'}:Promise.reject(Error('unexpected '+path)));mocks.list.mockImplementation(async()=>[{clientId:'c',hostname:'电脑 A',id:'task-a',name:'示例任务',status:'failed',updatedAt:'2026-11-10T08:00:00Z',summary:{successCount:1,failedCount:1}}]);});
afterEach(()=>{cleanup();sessionStorage.clear();});
it('returning from a detail preserves computer, dates, state, query and list scroll',async()=>{
 const view=render(<ExecutionTasks/>);await screen.findByRole('link',{name:'示例任务'});
 fireEvent.change(screen.getByRole('textbox',{name:'搜索任务'}),{target:{value:'示例'}});fireEvent.change(screen.getByRole('combobox',{name:'筛选电脑'}),{target:{value:'c'}});fireEvent.change(screen.getByRole('combobox',{name:'筛选任务状态'}),{target:{value:'failed'}});fireEvent.change(screen.getByLabelText('开始时间'),{target:{value:'2026-11-09T00:00'}});fireEvent.change(screen.getByLabelText('结束时间'),{target:{value:'2026-11-11T00:00'}});
 const table=view.container.querySelector('.task-table-wrap')!;table.scrollTop=420;fireEvent.scroll(table);view.unmount();
 location.hash='#/native-report?clientId=c&taskId=task-a';const detail=render(<ExecutionTasks/>);expect(screen.getByTestId('native-report')).toBeTruthy();detail.unmount();location.hash='#/tasks';const returned=render(<ExecutionTasks/>);expect(screen.queryByText('正在读取任务列表…')).toBeNull();await screen.findByRole('link',{name:'示例任务'});expect(screen.getByRole('textbox',{name:'搜索任务'})).toHaveProperty('value','示例');expect(screen.getByRole('combobox',{name:'筛选电脑'})).toHaveProperty('value','c');expect(screen.getByRole('combobox',{name:'筛选任务状态'})).toHaveProperty('value','failed');expect(screen.getByLabelText('开始时间')).toHaveProperty('value','2026-11-09T00:00');expect(screen.getByLabelText('结束时间')).toHaveProperty('value','2026-11-11T00:00');await waitFor(()=>expect(returned.container.querySelector('.task-table-wrap')!.scrollTop).toBe(420));
});
it('legacy execution URL reads only the selected task before reusing the native report',async()=>{
 location.hash='#/execution/task-a';render(<ExecutionTasks/>);await screen.findByTestId('native-report');expect(screen.getByTestId('native-report').textContent).toContain('c:task-a');expect(mocks.lab.mock.calls.map(x=>x[0])).toEqual(['tasks/task-a']);expect(mocks.list).not.toHaveBeenCalled();
});
it('direct case links do not mount the complete task list',()=>{
 location.hash='#/native-report?clientId=c&taskId=task-a&caseId=a';render(<ExecutionTasks/>);expect(screen.getByTestId('native-report')).toBeTruthy();expect(mocks.lab).not.toHaveBeenCalled();expect(mocks.list).not.toHaveBeenCalled();
});
it('URL back/forward switches the task view without losing saved filters',async()=>{
 saveTaskListView({taskQuery:'示例',taskFilter:'failed'});render(<ExecutionTasks/>);await screen.findByRole('link',{name:'示例任务'});await act(async()=>{location.hash='#/native-report?clientId=c&taskId=task-a';window.dispatchEvent(new HashChangeEvent('hashchange'));});expect(screen.getByTestId('native-report')).toBeTruthy();await act(async()=>{location.hash='#/tasks';window.dispatchEvent(new HashChangeEvent('hashchange'));});expect(screen.getByRole('textbox',{name:'搜索任务'})).toHaveProperty('value','示例');expect(readTaskListView().taskFilter).toBe('failed');
});
it('corrupt or unavailable browser storage cannot block navigation',()=>{
 sessionStorage.setItem('solopi.lab.task-list.view.v1','bad-json');expect(readTaskListView().taskQuery).toBe('');const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('disabled')});expect(()=>saveTaskListView({taskQuery:'sample'})).not.toThrow();spy.mockRestore();
});
