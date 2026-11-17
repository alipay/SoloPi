import {render,cleanup,act} from '@testing-library/react';import {it,expect,vi,afterEach} from 'vitest';
import {Overview} from '../src/pages/Overview';import {ClientStatus} from '../src/pages/ClientStatus';import {CLIENTS_AREA} from '../src/api/areas';import {setProxyRoMode,setRoDevicesAvailable} from '../src/api/connection';
afterEach(()=>{cleanup();setRoDevicesAvailable(false);setProxyRoMode(false);vi.useRealTimers();vi.unstubAllGlobals()});
 const U='01ARZ3NDEKTSV4RRFFQ69G5FAV';
    const rawClient = {
      orgId: '01M6GGBGHYYJTD648SY66Q1MM2',
      projectId: '01M6GGBGHYZG3CMXJAJKNT56DE',
      clientId: '01M6JVA2KF08T0VZ0ZZABRAQFJ',
      installationId: U,
      keyFingerprint: 'sha256:fvJjEgaEFn6sfovvWOQVDgqQWwv3muWKluzaFH3VCOg',
      status: 'approved',
      online: 'online',
      lastHeartbeatAt: '2026-11-04T09:13:15Z',
      leaseExpiresAt: '2026-11-04T10:13:15Z',
      clientVersion: '44.7.0',
      capabilities: { commands: false, media: false },
      occupancy: { localUiTasks: 0, cliTasks: 0 },
      deviceScope: { deviceId: U, os: 'darwin', hostname: 'U-YCC7XMNV-2307.local' },
    };


const dev={orgId:rawClient.orgId,projectId:rawClient.projectId,clientId:rawClient.clientId,deviceId:'01ARZ3NDEKTSV4RRFFQ69G5FAW',deviceName:'independent-screen-device',kind:'other',status:'online',lastSeenAt:'2026-11-04T08:00:00Z',lastSnapshotAt:'2026-11-04T08:00:00Z',lastSnapshotId:'01ARZ3NDEKTSV4RRFFQ69G5FAV',discoveredAt:'2026-11-04T08:00:00Z'};
it.each(['client','overview'])('%s final DOM success-failure-recovery retains stale device',async(page)=>{
vi.useFakeTimers();setProxyRoMode(true);setRoDevicesAvailable(true);let mode='device';
vi.stubGlobal('fetch',vi.fn(async(input)=>{const u=String(input);if(u.startsWith('/ro/devices')&&mode==='fail')throw Error('network failed');let items=u.startsWith('/ro/clients')?[rawClient]:u.startsWith('/ro/devices')&&mode==='device'?[dev]:[];return {ok:true,json:async()=>({items,page:1,pageSize:200,nextPage:null})} as Response;}));
render(page==='client'?<ClientStatus clientsArea={CLIENTS_AREA}/>:<Overview deviceHub/>);await act(async()=>{for(let i=0;i<20;i++)await Promise.resolve()});expect(document.body.textContent).toContain(dev.deviceName);
mode='fail';await act(async()=>{await vi.advanceTimersByTimeAsync(10001)});
console.log(page,'FAILED_DOM',document.body.textContent);
expect.soft(document.body.textContent).toContain(dev.deviceName);expect.soft(document.body.textContent).toMatch(/陈旧|读取失败/);expect.soft(document.body.textContent).not.toContain('待端点部署');
mode='device';await act(async()=>{await vi.advanceTimersByTimeAsync(10001)});expect(document.body.textContent).toContain(dev.deviceName);
mode='empty';await act(async()=>{await vi.advanceTimersByTimeAsync(10001)});expect(document.body.textContent).not.toContain(dev.deviceName);expect(document.body.textContent).toMatch(/0 台/);
});
it.each(['pending','failed'])('overview first %s is not confirmed empty',async(mode)=>{
setProxyRoMode(true);setRoDevicesAvailable(true);vi.stubGlobal('fetch',vi.fn(async(input)=>{const u=String(input);if(u.startsWith('/ro/devices'))return mode==='failed'?Promise.reject(Error('network failed')):new Promise(()=>{});return {ok:true,json:async()=>({items:u.startsWith('/ro/clients')?[rawClient]:[],page:1,pageSize:200,nextPage:null})} as Response;}));
render(<Overview/>);await act(async()=>{for(let i=0;i<20;i++)await Promise.resolve()});expect(document.body.textContent).toContain('U-YCC7XMNV-2307.local');expect(document.body.textContent).not.toContain('真实空集：0 台');
});
