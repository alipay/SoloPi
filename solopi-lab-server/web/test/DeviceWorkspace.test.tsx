import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {DeviceWorkspace} from '../src/components/DeviceWorkspace';
vi.mock('../src/components/DeviceGroupsPanel',()=>({DeviceGroupsPanel:()=> <section data-testid="group-settings"/>}));
vi.mock('../src/pages/Overview',()=>({Overview:(p:any)=><section data-testid="screens">{p.deviceHub?'设备屏幕':''}</section>}));
afterEach(cleanup);
it('configuration and viewing have separate page duties while retaining both entry points',()=>{const view=render(<DeviceWorkspace/>);expect(screen.getByTestId('group-settings')).toBeTruthy();expect(screen.queryByTestId('screens')).toBeNull();expect(screen.getByRole('link',{name:'设备屏幕'}).getAttribute('href')).toBe('#/devices/screens');expect(screen.getByRole('link',{name:'设备组配置'}).getAttribute('aria-current')).toBe('page');view.rerender(<DeviceWorkspace screens/>);expect(screen.queryByTestId('group-settings')).toBeNull();expect(screen.getByTestId('screens').textContent).toBe('设备屏幕');expect(screen.getByRole('link',{name:'设备屏幕'}).getAttribute('aria-current')).toBe('page');});
