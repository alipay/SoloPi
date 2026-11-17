import {cleanup,render,screen,within} from '@testing-library/react';import {afterEach,expect,it,vi} from 'vitest';import App from '../src/App';
vi.mock('../src/pages/ExecutionTasks',()=>({ExecutionTasks:()=> <div data-testid="execution-list">执行任务</div>}));
vi.mock('../src/pages/ImChat',()=>({ImChat:()=> <div data-testid="agent-chat">Agent会话</div>}));
vi.mock('../src/api/readonly-proxy',async()=>({...await vi.importActual('../src/api/readonly-proxy'),probeReadonlyProxy:async()=>true}));
vi.mock('../src/api/devices-ro',async()=>({...await vi.importActual('../src/api/devices-ro'),probeRoDevices:async()=>true}));
afterEach(()=>{cleanup();location.hash='';});
it.each(['#/tasks','#/grouptasks','#/group-task?requestId=real','#/execution/agent-00000000-0000-4000-8000-000000000001'])('one execution entry opens %s without loading Agent records',hash=>{location.hash=hash;render(<App/>);expect(screen.getByTestId('execution-list')).toBeTruthy();expect(screen.queryByRole('button',{name:'导出 Server 日志'})).toBeNull();expect(screen.queryByTestId('agent-receipts')).toBeNull();const nav=within(screen.getByRole('complementary',{name:'主导航'}));expect(nav.getAllByRole('link',{name:'测试任务'})).toHaveLength(1);expect(nav.queryByRole('link',{name:/组任务/})).toBeNull();});
it('legacy Agent receipt URL remains separate from execution tasks',()=>{location.hash='#/task/01M6Y0AA5P9FXW3DNW2NT7RXM7';render(<App/>);expect(screen.getByTestId('agent-chat')).toBeTruthy();expect(screen.queryByTestId('execution-list')).toBeNull();});
it('places Server log export only in settings',()=>{location.hash='#/settings';render(<App/>);expect(screen.getByRole('button',{name:'导出 Server 日志'}).closest('.topbar-page-actions')).toBeTruthy();expect(screen.queryByRole('button',{name:'诊断日志'})).toBeNull();});
