import {afterEach,it,expect,vi} from 'vitest';
import {cleanup,render,waitFor} from '@testing-library/react';
import App from '../src/App';
import {getConnectionView,setProxyRoMode,setRoDevicesAvailable} from '../src/api/connection';
afterEach(()=>{cleanup();vi.unstubAllGlobals();setProxyRoMode(false);setRoDevicesAvailable(false);});
it('a slow device endpoint cannot delay computer status initialization',async()=>{
 setProxyRoMode(false);setRoDevicesAvailable(false);location.hash='#/overview';
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{const url=String(input);if(url.startsWith('/ro/devices'))return new Promise<Response>(()=>{});if(url.startsWith('/ro/clients'))return {ok:true,json:async()=>({items:[],page:1,pageSize:200,nextPage:null})} as Response;return {ok:false,status:404,json:async()=>({error:{message:'not found'}})} as Response;}));
 render(<App/>);await waitFor(()=>expect(getConnectionView().proxyRo).toBe(true));expect(getConnectionView().roDevices).toBe(false);
});
