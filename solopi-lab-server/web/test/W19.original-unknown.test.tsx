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



it.each([['client','pending'],['client','failed'],['overview','pending'],['overview','failed']])('%s first %s is unknown, not undeployed or stale zero',async(page,mode)=>{
setProxyRoMode(true);setRoDevicesAvailable(true);vi.stubGlobal('fetch',vi.fn(async(input)=>{const u=String(input);if(u.startsWith('/ro/devices'))return mode==='failed'?Promise.reject(Error('network failed')):new Promise(()=>{});return {ok:true,json:async()=>({items:u.startsWith('/ro/clients')?[rawClient]:[],page:1,pageSize:200,nextPage:null})} as Response;}));
render(page==='client'?<ClientStatus clientsArea={CLIENTS_AREA}/>:<Overview/>);await act(async()=>{for(let i=0;i<20;i++)await Promise.resolve()});console.log(page,mode,'FIRST_DOM',document.body.textContent);
expect.soft(document.body.textContent).not.toMatch(/端点未部署|待端点部署/);
expect.soft(document.body.textContent).not.toMatch(/真实空集|服务端确认空集|设备与投屏[（(]0\s*台/);
if(page==='overview')expect.soft(document.querySelector('.working-summary')?.textContent).not.toMatch(/0台/);
});
