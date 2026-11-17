import {afterEach,it,expect,vi} from 'vitest';
import {act,cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';
const mocks=vi.hoisted(()=>({login:{probe:'ok'},start:vi.fn(),stop:vi.fn(),canvas:vi.fn(),options:vi.fn(),status:vi.fn(async()=>({status:'expired',endedReason:'expired'})),diagnostic:vi.fn(),authorize:vi.fn(async()=>({mediaSessionId:'s',dataPlane:{pathTemplate:'/ws/media/{ticket}'},viewerTicket:{token:'a'.repeat(48)}}))}));
vi.mock('../src/api/media-viewer',()=>({getMediaLoginState:()=>mocks.login,subscribeMediaLogin:()=>()=>{},mvAuthorize:mocks.authorize,mvStop:mocks.stop,mvStatus:mocks.status}));
vi.mock('../src/media/MediaViewerPipeline',()=>({MediaViewerPipeline:class{constructor(p:any){mocks.canvas(p.canvas);mocks.options(p)}start(){mocks.start()}stop(){mocks.stop()}}}));
vi.mock('../src/api/media-diagnostics',()=>({recordMediaDiagnostic:mocks.diagnostic}));
import {MediaViewerPanel} from '../src/components/MediaViewerPanel';
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();vi.clearAllMocks()});
it('commits the canvas before an early next frame starts the stream',async()=>{
 vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{cb(0);return 1});
 render(<MediaViewerPanel clientId="c" deviceId="d" deviceOnline={null} mediaCapable/>);
 fireEvent.click(screen.getByRole('button',{name:'查看屏幕'}));await waitFor(()=>expect(mocks.start).toHaveBeenCalledTimes(1));expect(mocks.canvas.mock.calls[0][0]).toBeInstanceOf(HTMLCanvasElement);expect(screen.queryByText(/画面挂载点缺失/)).toBeNull();
});

it('shows the no-first-frame reason and permits reconnect instead of a blank canvas',async()=>{
 vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{cb(0);return 1});render(<MediaViewerPanel clientId="c" deviceId="d" deviceOnline={null} mediaCapable autoStart compact/>);await waitFor(()=>expect(mocks.start).toHaveBeenCalledTimes(1));
 act(()=>mocks.options.mock.calls[0][0].onEvent({type:'state',state:{kind:'no-first-frame',waitedMs:8000}}));expect(screen.getByRole('status').textContent).toContain('仍无首帧');fireEvent.click(screen.getByRole('button',{name:'重新连接'}));await waitFor(()=>expect(mocks.start).toHaveBeenCalledTimes(2));
 act(()=>mocks.options.mock.calls.at(-1)![0].onEvent({type:'state',state:{kind:'presenting'}}));expect(screen.queryByRole('status')).toBeNull();
});
it('auto screens reconnect a lost socket at most three times using fresh authorizations',async()=>{
 vi.useFakeTimers();vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{cb(0);return 1});
 render(<MediaViewerPanel clientId="c" deviceId="d" deviceOnline={true} mediaCapable autoStart compact/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(0)});expect(mocks.start).toHaveBeenCalledTimes(1);
 for(let attempt=1;attempt<=3;attempt++){
  act(()=>mocks.options.mock.calls.at(-1)![0].onEvent({type:'state',state:{kind:'disconnected',code:1006,reason:null}}));
  expect(screen.getByRole('status').textContent).toContain(`正在重连（${attempt}/3）`);
  await act(async()=>{await vi.advanceTimersByTimeAsync(2000*2**(attempt-1))});expect(mocks.authorize).toHaveBeenCalledTimes(attempt+1);
 }
 act(()=>mocks.options.mock.calls.at(-1)![0].onEvent({type:'state',state:{kind:'disconnected',code:1006,reason:null}}));
 await act(async()=>{await vi.advanceTimersByTimeAsync(60000)});expect(mocks.authorize).toHaveBeenCalledTimes(4);
});
it('manual stop cancels pending recovery and protocol denial does not auto retry',async()=>{
 vi.useFakeTimers();vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{cb(0);return 1});
 render(<MediaViewerPanel clientId="c" deviceId="d" deviceOnline={true} mediaCapable autoStart compact/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(0)});
 act(()=>mocks.options.mock.calls.at(-1)![0].onEvent({type:'state',state:{kind:'disconnected',code:4401,reason:'denied'}}));
 await act(async()=>{await vi.advanceTimersByTimeAsync(20000)});expect(mocks.authorize).toHaveBeenCalledTimes(1);
 act(()=>mocks.options.mock.calls.at(-1)![0].onEvent({type:'state',state:{kind:'disconnected',code:1006,reason:null}}));
 fireEvent.click(screen.getByRole('button',{name:'关闭查看'}));await act(async()=>{await vi.advanceTimersByTimeAsync(20000)});expect(mocks.authorize).toHaveBeenCalledTimes(1);
});

it('recovers ten-minute viewer expiry after checking its reason; displayed frames reset consecutive retry budget',async()=>{
 vi.useFakeTimers();vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{cb(0);return 1});
 render(<MediaViewerPanel clientId="c" deviceId="d" deviceOnline={true} mediaCapable autoStart compact/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(0)});
 for(let cycle=0;cycle<5;cycle++){
  act(()=>mocks.options.mock.calls.at(-1)![0].onEvent({type:'state',state:{kind:'presenting'}}));
  await act(async()=>{mocks.options.mock.calls.at(-1)![0].onEvent({type:'state',state:{kind:'disconnected',code:4409,reason:'viewer ended'}});await Promise.resolve()});
  expect(mocks.status).toHaveBeenCalledWith('s');
  await act(async()=>{await vi.advanceTimersByTimeAsync(2000)});
  expect(mocks.authorize).toHaveBeenCalledTimes(cycle+2);
 }
 expect(mocks.diagnostic.mock.calls.filter(x=>x[2]==='first-frame')).toHaveLength(5);
});
it('does not reconnect an explicit server stop, unknown status or denied status',async()=>{
 vi.useFakeTimers();vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{cb(0);return 1});
 render(<MediaViewerPanel clientId="c" deviceId="d" deviceOnline={true} mediaCapable autoStart compact/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(0)});
 for(const status of ['stopped','unavailable']){
  if(status==='stopped')mocks.status.mockResolvedValueOnce({status:'stopped',endedReason:'admin-stop'});
  else mocks.status.mockRejectedValueOnce(Error('status unavailable'));
  await act(async()=>{mocks.options.mock.calls.at(-1)![0].onEvent({type:'state',state:{kind:'disconnected',code:4409,reason:'viewer ended'}});await vi.advanceTimersByTimeAsync(20000)});
 }
 expect(mocks.authorize).toHaveBeenCalledTimes(1);
});
it('manual close while the expiry status request is pending prevents late recovery',async()=>{
 vi.useFakeTimers();vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{cb(0);return 1});
 let finish!:(v:{status:string;endedReason:string})=>void;
 mocks.status.mockImplementationOnce(()=>new Promise(r=>{finish=r}));
 render(<MediaViewerPanel clientId="c" deviceId="d" deviceOnline={true} mediaCapable autoStart compact/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(0)});
 act(()=>mocks.options.mock.calls.at(-1)![0].onEvent({type:'state',state:{kind:'disconnected',code:4409,reason:'viewer ended'}}));
 fireEvent.click(screen.getByRole('button',{name:'关闭查看'}));
 await act(async()=>{finish({status:'expired',endedReason:'expired'});await vi.advanceTimersByTimeAsync(20000)});
 expect(mocks.authorize).toHaveBeenCalledTimes(1);
});
