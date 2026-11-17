import {render,cleanup,waitFor,screen} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
import {ClientStatus} from '../src/pages/ClientStatus';
import {CLIENTS_AREA} from '../src/api/areas';
import {setProxyRoMode,setRoDevicesAvailable} from '../src/api/connection';
afterEach(()=>{cleanup();setRoDevicesAvailable(false);setProxyRoMode(false);vi.unstubAllGlobals()});
it.each(['pending','failed'])('%s device read must not become confirmed zero from probe alone',async(mode)=>{
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

 setProxyRoMode(true);setRoDevicesAvailable(true);
 vi.stubGlobal('fetch',vi.fn(async(input)=>{if(String(input).startsWith('/ro/clients'))return {ok:true,json:async()=>({items:[rawClient],page:1,pageSize:200,nextPage:null})} as Response;return mode==='failed'?Promise.reject(Error('network failed')):new Promise(()=>{});}));
 render(<ClientStatus clientsArea={CLIENTS_AREA}/>);await waitFor(()=>expect(screen.getByText('U-YCC7XMNV-2307.local')).toBeTruthy());
 expect(document.body.textContent).not.toContain('设备与投屏（0 台）');
});
