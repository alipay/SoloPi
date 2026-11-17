import {afterEach,it,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent} from '@testing-library/react';
const mocks=vi.hoisted(()=>({lab:vi.fn(),list:vi.fn()}));
vi.mock('../src/api/lab',()=>({lab:mocks.lab}));
vi.mock('../src/api/client-tasks',()=>({listClientTasks:mocks.list,nativeTaskLink:(c:string,t:string)=>`#/native-report?clientId=${c}&taskId=${t}`}));
vi.mock('../src/api/readonly-proxy',()=>({createRoClientsRead:()=>async()=>[{clientId:'a',capabilities:{media:true},online:'online'}]}));
vi.mock('../src/components/MediaViewerPanel',()=>({MediaViewerPanel:(p:any)=><div data-testid="live-screen">{p.deviceId}</div>}));
import {ExecutionTasks} from '../src/pages/ExecutionTasks';
import {TaskLiveScreens} from '../src/components/TaskLiveScreens';
import {taskScreenGroup} from '../src/api/task-screen-group';
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('combines computer, update time and status filters and clears them',async()=>{
 location.hash='#/tasks';mocks.lab.mockImplementation(async(path:string)=>({items:path==='catalog'?[{clientId:'a',hostname:'Mac',groups:[],cases:[]},{clientId:'b',hostname:'Linux',groups:[],cases:[]}]:[]}));
 mocks.list.mockImplementation(async(c:any,_s:any,_o:any,emit:any)=>{const rows=[{id:c.clientId,name:c.hostname+' regression',clientId:c.clientId,hostname:c.hostname,status:c.clientId==='a'?'failed':'success',updatedAt:'2026-11-09T10:00:00+08:00'}];emit?.(rows);return rows;});
 render(<ExecutionTasks/>);await screen.findByRole('link',{name:'Mac regression'});await screen.findByRole('link',{name:'Linux regression'});
 fireEvent.change(screen.getByLabelText('筛选电脑'),{target:{value:'a'}});expect(screen.queryByRole('link',{name:'Linux regression'})).toBeNull();
 fireEvent.change(screen.getByLabelText('筛选任务状态'),{target:{value:'success'}});expect(screen.queryByRole('link',{name:'Mac regression'})).toBeNull();
 fireEvent.change(screen.getByLabelText('筛选任务状态'),{target:{value:'failed'}});fireEvent.change(screen.getByLabelText('开始时间'),{target:{value:'2026-11-10T00:00'}});expect(screen.queryByRole('link',{name:'Mac regression'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'清除筛选'}));expect(screen.getByRole('link',{name:'Mac regression'})).toBeTruthy();expect(screen.getByRole('link',{name:'Linux regression'})).toBeTruthy();
});
it('automatically displays only the exact task device group',async()=>{
 mocks.lab.mockResolvedValue({items:[{clientId:'a',devices:[{deviceId:'g1',serial:'s1'},{deviceId:'g2',serial:'s2'}],groups:[{groupId:'one',name:'Group one',members:[{deviceId:'g1',role:'glasses'}]},{groupId:'two',name:'Group two',members:[{deviceId:'g2',role:'glasses'}]}]}]});
 render(<TaskLiveScreens clientId="a" task={{id:'task',devices:{glasses:{serial:'s2'}}}}/>);await screen.findByText('Group two');expect(screen.getByTestId('live-screen').textContent).toBe('g2');expect(screen.queryByRole('button',{name:'查看当前设备组投屏'})).toBeNull();
});
it('uses the saved task group binding when multiple groups contain the same device',async()=>{
 mocks.lab.mockResolvedValue({items:[{clientId:'a',devices:[{deviceId:'g',serial:'same'}],groups:[{groupId:'old',name:'Old group',members:[{deviceId:'g',role:'glasses'}]},{groupId:'bound',name:'Bound group',members:[{deviceId:'g',role:'glasses'}]}]}]});
 render(<TaskLiveScreens clientId="a" task={{groupExecution:{groupId:'bound'},devices:{glasses:{serial:'same'}}}}/>);await screen.findByText('Bound group');expect(screen.getAllByTestId('live-screen')).toHaveLength(1);expect(screen.queryByText('Old group')).toBeNull();
});
it('automatically displays screens immediately below working task rows only',async()=>{
 localStorage.clear();location.hash='#/tasks';mocks.lab.mockImplementation(async(path:string)=>({items:path==='catalog'?[{clientId:'a',hostname:'Mac',groups:[{groupId:'bound',name:'Working group',members:[{deviceId:'g',role:'glasses'}]}],devices:[{deviceId:'g',serial:'same'}],cases:[]}]:[]}));
 mocks.list.mockResolvedValue([{id:'running-task',name:'Running task',status:'running',clientId:'a',hostname:'Mac',groupExecution:{groupId:'bound'},updatedAt:'2026-11-10T10:00:00Z'},{id:'finished-task',name:'Finished task',status:'success',clientId:'a',hostname:'Mac',updatedAt:'2026-11-09T10:00:00Z'}]);
 render(<ExecutionTasks/>);await screen.findByRole('link',{name:'Running task'});expect(screen.queryByRole('button',{name:'查看当前设备组投屏'})).toBeNull();await screen.findByText('Working group');expect(screen.getByTestId('live-screen').textContent).toBe('g');expect(screen.getByRole('region',{name:'当前设备组实时投屏'}).closest('tr')?.previousElementSibling?.textContent.includes('Running task')).toBeTruthy();expect(screen.queryByRole('dialog')).toBeNull();
});
it('return links use the shared icon control rather than browser-default visited styling',async()=>{
 const {BackLink}=await import('../src/components/BackLink');render(<BackLink href="#/tasks">全部任务</BackLink>);const link=screen.getByRole('link',{name:'全部任务'});expect(link.classList.contains('workspace-back')).toBe(true);expect(link.querySelector('svg')).toBeTruthy();expect(link.getAttribute('href')).toBe('#/tasks');
});
it('duplicate registrations of the same physical pair do not block the task screens',async()=>{
 const members=[{deviceId:'g',role:'glasses'},{deviceId:'p',role:'phone'}];
 mocks.lab.mockResolvedValue({items:[{clientId:'a',devices:[{deviceId:'g',serial:'sg'},{deviceId:'p',serial:'sp'}],groups:[{groupId:'old',name:'Same physical pair',members},{groupId:'renamed',name:'Another registration',members:[...members].reverse()}]}]});
 render(<TaskLiveScreens clientId="a" task={{id:'duplicate-pair',devices:{phone:{serial:'sp'},glasses:{serial:'sg'}}}}/>);
 await screen.findByText('Same physical pair');expect(screen.getAllByTestId('live-screen').map(e=>e.textContent).sort()).toEqual(['g','p']);expect(screen.queryByText(/未能唯一匹配/)).toBeNull();
});
it('different possible pairs remain ambiguous and exact saved binding selects only its group',()=>{
 const catalog:any={devices:[{deviceId:'p',serial:'sp'},{deviceId:'g1',serial:'s1'},{deviceId:'g2',serial:'s2'}],groups:[{groupId:'one',members:[{deviceId:'p',role:'phone'},{deviceId:'g1',role:'glasses'}]},{groupId:'two',members:[{deviceId:'p',role:'phone'},{deviceId:'g2',role:'glasses'}]}]};
 expect(taskScreenGroup(catalog,{devices:{phone:{serial:'sp'}}})).toBeUndefined();
 expect(taskScreenGroup(catalog,{group:{groupId:'two'}})?.groupId).toBe('two');
 expect(taskScreenGroup(catalog,{groupExecution:{groupId:'gone'},devices:{phone:{serial:'sp'}}})).toBeUndefined();
});
it('same-task device updates replace the original screen target',async()=>{
 mocks.lab.mockResolvedValue({items:[{clientId:'a',devices:[{deviceId:'g1',serial:'s1'},{deviceId:'g2',serial:'s2'}],groups:[{groupId:'one',name:'Before',members:[{deviceId:'g1',role:'glasses'}]},{groupId:'two',name:'After',members:[{deviceId:'g2',role:'glasses'}]}]}]});
 const v=render(<TaskLiveScreens clientId="a" task={{id:'same-task',devices:{glasses:{serial:'s1'}}}}/>);await screen.findByText('Before');
 v.rerender(<TaskLiveScreens clientId="a" task={{id:'same-task',devices:{glasses:{serial:'s2'}}}}/>);await screen.findByText('After');expect(screen.getByTestId('live-screen').textContent).toBe('g2');
});
