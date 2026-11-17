import {cleanup,render,screen,act,fireEvent,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {WorkingOverview} from '../src/pages/WorkingOverview';
import {readWorkingGroups} from '../src/api/working-groups';
import {lab} from '../src/api/lab';
const data=vi.hoisted(()=>({clients:[{clientId:'c1',displayName:'Mac A',online:'online',registration:{status:'approved'},capabilities:{media:true}},{clientId:'c2',displayName:'Linux B',online:'online',registration:{status:'approved'},capabilities:{media:true}}],released:[] as string[]}));
vi.mock('../src/hooks/useDeliveryArea',()=>({useDeliveryArea:(x:any)=>x}));
vi.mock('../src/hooks/usePollingArea',()=>({usePollingArea:()=>({rows:data.clients,status:'ready'})}));
vi.mock('../src/hooks/useDevicesReadView',()=>({useDevicesReadView:()=>({state:{kind:'confirmed'},rows:[{clientId:'c1',deviceId:'p',deviceName:'手机 A',status:'online'},{clientId:'c1',deviceId:'g',deviceName:'眼镜 A',status:'online'}]})}));
vi.mock('../src/api/lab',()=>({lab:vi.fn()}));
vi.mock('../src/api/working-groups',()=>({readWorkingGroups:vi.fn()}));
vi.mock('../src/components/MediaViewerPanel',async()=>{const {useEffect}=await import('react');return {MediaViewerPanel:(p:any)=>{useEffect(()=>()=>{data.released.push(p.deviceId);},[]);return <div data-testid={`live-${p.deviceId}`} data-zoom-hidden={p.showZoomControl===false}>{p.autoStart?'自动观看':''}{p.compact?'紧凑画面':''}</div>;}};});
const catalogs=[{clientId:'c1',hostname:'A',groups:[],devices:[]},{clientId:'c2',hostname:'B',groups:[],devices:[]}];
const active={groups:[{group:{groupId:'group1',name:'一号组',members:[{deviceId:'p',role:'phone'},{deviceId:'g',role:'glasses'}]},tasks:[{id:'cli1',name:'CLI任务',status:'running',total:10,completed:3}]}],unmatched:[],observedAt:1};
beforeEach(()=>{vi.mocked(lab).mockResolvedValue({items:catalogs});vi.mocked(readWorkingGroups).mockImplementation(async c=>c.clientId==='c1'?active as any:{groups:[],unmatched:[],observedAt:1});data.released=[];data.clients[0].online='online';});
afterEach(()=>{cleanup();vi.useRealTimers();vi.clearAllMocks();});
it('shows only working groups beneath each computer and automatically mounts both screens',async()=>{
 render(<WorkingOverview/>);await screen.findByRole('region',{name:'一号组'});
 expect(screen.getByTestId('live-p').textContent).toContain('自动观看');expect(screen.getByTestId('live-g').textContent).toContain('紧凑画面');
 expect(screen.getByText('Linux B')).toBeTruthy();expect(screen.getByText('空闲')).toBeTruthy();expect(screen.queryByRole('button',{name:'查看屏幕'})).toBeNull();
 expect(screen.getByRole('link',{name:/CLI任务/}).getAttribute('href')).toContain('taskId=cli1');
});
it('releases screens when the task finishes on a later poll',async()=>{
 vi.useFakeTimers();render(<WorkingOverview/>);await act(async()=>{await Promise.resolve();});expect(screen.getByTestId('live-p')).toBeTruthy();
 vi.mocked(readWorkingGroups).mockResolvedValue({groups:[],unmatched:[],observedAt:2});await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
 expect(screen.queryByTestId('live-p')).toBeNull();expect(data.released.sort()).toEqual(['g','p']);
});
it('does not treat read errors as idle or leave stale screens running',async()=>{
 vi.useFakeTimers();render(<WorkingOverview/>);await act(async()=>{await Promise.resolve();});vi.mocked(readWorkingGroups).mockRejectedValue(Error('读取失败'));
 await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});expect(screen.queryByTestId('live-p')).toBeNull();expect(screen.getAllByRole('alert')).toHaveLength(2);expect(screen.queryByText('空闲')).toBeNull();
});
it('unmounts viewing sessions immediately when the computer goes offline',async()=>{
 const view=render(<WorkingOverview/>);await screen.findByTestId('live-p');data.clients[0].online='offline';view.rerender(<WorkingOverview/>);
 expect(screen.queryByTestId('live-p')).toBeNull();expect(data.released).toContain('p');expect(screen.getByText('工作状态未知')).toBeTruthy();
});
it('leaving the overview releases all mounted device viewers',async()=>{
 const view=render(<WorkingOverview/>);await screen.findByTestId('live-p');view.unmount();expect(data.released.sort()).toEqual(['g','p']);
});

it('focuses one device within its group and restores both without reconnecting viewers',async()=>{
 render(<WorkingOverview/>);const group=await screen.findByRole('region',{name:'一号组'});
 expect(within(group).getByTestId('live-g').dataset.zoomHidden).toBe('true');
 fireEvent.click(within(group).getByRole('button',{name:'只显示眼镜'}));
 expect(group.querySelector<HTMLElement>('.working-device.phone')!.hidden).toBe(true);
 expect(group.querySelector<HTMLElement>('.working-device.glasses')!.hidden).toBe(false);
 expect(group.querySelector('.working-screen-grid')!.classList.contains('is-focused')).toBe(true);
 expect(within(group).getByRole('button',{name:'恢复双画面'}).getAttribute('aria-pressed')).toBe('true');
 fireEvent.click(within(group).getByRole('button',{name:'恢复双画面'}));
 expect(group.querySelector<HTMLElement>('.working-device.phone')!.hidden).toBe(false);
 expect(group.querySelector('.working-screen-grid')!.classList.contains('is-focused')).toBe(false);
 expect(data.released).toEqual([]);
});
it('keeps focus independent across computers even with identical group IDs',async()=>{
 vi.mocked(readWorkingGroups).mockImplementation(async c=>c.clientId==='c1'?active as any:{groups:[{group:{groupId:'group1',name:'二号组',members:[{deviceId:'p2',role:'phone'},{deviceId:'g2',role:'glasses'}]},tasks:[{id:'cli2',name:'Other task',status:'running'}]}],unmatched:[],observedAt:1} as any);
 render(<WorkingOverview/>);const a=await screen.findByRole('region',{name:'一号组'}),b=await screen.findByRole('region',{name:'二号组'});
 fireEvent.click(within(a).getByRole('button',{name:'只显示眼镜'}));
 expect(b.querySelector<HTMLElement>('.working-device.phone')!.hidden).toBe(false);expect(b.querySelector<HTMLElement>('.working-device.glasses')!.hidden).toBe(false);
 fireEvent.click(within(b).getByRole('button',{name:'只显示手机'}));
 expect(a.querySelector<HTMLElement>('.working-device.phone')!.hidden).toBe(true);expect(a.querySelector<HTMLElement>('.working-device.glasses')!.hidden).toBe(false);
 expect(b.querySelector<HTMLElement>('.working-device.glasses')!.hidden).toBe(true);expect(b.querySelector<HTMLElement>('.working-device.phone')!.hidden).toBe(false);
 fireEvent.click(within(a).getByRole('button',{name:'恢复双画面'}));expect(b.querySelector<HTMLElement>('.working-device.glasses')!.hidden).toBe(true);expect(data.released).toEqual([]);
});

it('keeps sibling groups on the same computer unchanged through a status poll',async()=>{
 vi.useFakeTimers();const second={...active.groups[0],group:{groupId:'group2',name:'同机二号组',members:[{deviceId:'p2',role:'phone'},{deviceId:'g2',role:'glasses'}]}};
 vi.mocked(readWorkingGroups).mockImplementation(async c=>c.clientId==='c1'?{...active,groups:[...active.groups,second]} as any:{groups:[],unmatched:[],observedAt:1});
 render(<WorkingOverview/>);await act(async()=>{await Promise.resolve();});
 const a=screen.getByRole('region',{name:'一号组'}),b=screen.getByRole('region',{name:'同机二号组'});
 fireEvent.click(within(a).getByRole('button',{name:'只显示手机'}));await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
 expect(a.querySelector<HTMLElement>('.working-device.glasses')!.hidden).toBe(true);
 expect(b.querySelector<HTMLElement>('.working-device.phone')!.hidden).toBe(false);expect(b.querySelector<HTMLElement>('.working-device.glasses')!.hidden).toBe(false);expect(data.released).toEqual([]);
});
