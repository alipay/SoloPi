import {act,cleanup,render,renderHook,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {CLIENTS_AREA,type DataArea} from '../src/api/areas';
import {setProxyRoMode,markConnectionHealth,getConnectionView} from '../src/api/connection';
import {usePollingArea} from '../src/hooks/usePollingArea';
import {OnlineBanner} from '../src/components/OnlineBanner';
import {StatusBanner} from '../src/components/StatusBanner';
const area=(read:()=>Promise<unknown[]>):DataArea<unknown>=>({...CLIENTS_AREA,key:'connection-fixture',wired:true,fetchers:{read},pollIntervalMs:0});
afterEach(()=>{cleanup();setProxyRoMode(false);Object.defineProperty(navigator,'onLine',{value:true,configurable:true});vi.useRealTimers()});
it('reads Server successfully even when the browser reports offline',async()=>{
 Object.defineProperty(navigator,'onLine',{value:false,configurable:true});setProxyRoMode(true);const read=vi.fn(async()=>['real-row']);const value=area(read);const h=renderHook(()=>usePollingArea(value));render(<><OnlineBanner/><StatusBanner/></>);
 await waitFor(()=>expect(h.result.current.status).toBe('ready'));expect(h.result.current.rows).toEqual(['real-row']);expect(h.result.current.offline).toBe(false);expect(screen.queryByText(/无法读取|已断开/)).toBeNull();expect(screen.getByText(/实验室已连接/)).toBeTruthy();expect(read).toHaveBeenCalledTimes(1);
});
it('shows real failure, retains stale rows and recovers without a browser online event',async()=>{
 setProxyRoMode(true);const read=vi.fn().mockResolvedValueOnce(['saved-row']).mockRejectedValueOnce(Error('connection refused')).mockResolvedValueOnce(['new-row']);const value=area(read);const h=renderHook(()=>usePollingArea(value));render(<><OnlineBanner/><StatusBanner/></>);
 await waitFor(()=>expect(h.result.current.status).toBe('ready'));act(()=>h.result.current.refresh());await screen.findByText(/暂时无法读取/);expect(h.result.current.rows).toEqual(['saved-row']);expect(screen.queryByText(/实验室已连接/)).toBeNull();act(()=>h.result.current.refresh());await waitFor(()=>expect(h.result.current.rows).toEqual(['new-row']));expect(screen.queryByText(/暂时无法读取/)).toBeNull();
});
it('a request deadline displays failure instead of an endless connecting state',async()=>{
 vi.useFakeTimers();setProxyRoMode(true);markConnectionHealth('ok');const value={...area(()=>new Promise<unknown[]>(()=>{})),requestTimeoutMs:20};renderHook(()=>usePollingArea(value));render(<><OnlineBanner/><StatusBanner/></>);await act(async()=>{await vi.advanceTimersByTimeAsync(21)});expect(getConnectionView().health).toBe('unreachable');expect(screen.getByText(/暂时无法读取/)).toBeTruthy();expect(screen.queryByText(/实验室已连接/)).toBeNull();
});
