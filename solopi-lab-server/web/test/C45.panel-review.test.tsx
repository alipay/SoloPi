import React,{StrictMode}from'react';import{render,fireEvent,screen,act,cleanup}from'@testing-library/react';import{it,expect,vi,afterEach}from'vitest';
const m=vi.hoisted(()=>({waits:[] as Function[],stops:[] as string[],state:{probe:'ok'}}));
vi.mock('../src/api/media-viewer',()=>({getMediaLoginState:()=>m.state,subscribeMediaLogin:()=>()=>{},probeMediaLogin:async()=>({kind:'ok'}),mvAuthorize:()=>new Promise(r=>m.waits.push(r)),mvStop:async(s:string)=>{m.stops.push(s);}}));
import{MediaViewerPanel}from'../src/components/MediaViewerPanel';
const cid='01M6JVA2KF08T0VZ0ZZABRAQFJ',did='01M6DEVICE0000000000000001',tid=`media-viewer-${cid}-${did}`;
const response=(sid:string)=>({mediaSessionId:sid,viewerTicket:{token:'t'.repeat(48)},dataPlane:{pathTemplate:'/ws/media/{ticket}'}});
let raf:FrameRequestCallback[]=[];
afterEach(()=>{cleanup();vi.unstubAllGlobals();m.waits=[];m.stops=[];raf=[];});
function setup(strict=false){vi.stubGlobal('requestAnimationFrame',(f:FrameRequestCallback)=>{raf.push(f);return raf.length;});const p=<MediaViewerPanel clientId={cid} deviceId={did} deviceOnline={true} mediaCapable={true}/>;return render(strict?<StrictMode>{p}</StrictMode>:p);}
it('old canvas callback cannot stop newly authorized session',async()=>{setup();fireEvent.click(screen.getByTestId(tid+'-start'));await act(async()=>m.waits[0](response('old')));expect(raf.length).toBe(1);fireEvent.click(screen.getByTestId(tid+'-stop'));fireEvent.click(screen.getByTestId(tid+'-start'));await act(async()=>m.waits[1](response('new')));await act(async()=>raf[0](0));expect(m.stops).toEqual(['old']);});
it('close before authorization resolves withdraws exact late session with no pipeline creation',async()=>{setup();fireEvent.click(screen.getByTestId(tid+'-start'));fireEvent.click(screen.getByTestId(tid+'-stop'));await act(async()=>m.waits[0](response('late')));expect(m.stops).toEqual(['late']);expect(raf.length).toBe(0);expect(screen.getByTestId(tid+'-state').textContent).toContain('已结束');});
it('unmount before authorization resolves withdraws exact late session',async()=>{const r=setup();fireEvent.click(screen.getByTestId(tid+'-start'));r.unmount();await act(async()=>m.waits[0](response('late')));expect(m.stops).toEqual(['late']);expect(raf.length).toBe(0);});
it('StrictMode mounted panel may accept its own authorization',async()=>{setup(true);fireEvent.click(screen.getByTestId(tid+'-start'));await act(async()=>m.waits[0](response('current')));expect(raf.length).toBe(1);expect(m.stops).toEqual([]);});
it('auto viewing in StrictMode starts once without a click and withdraws a late session on exit',async()=>{
 vi.useFakeTimers();
 try{
  vi.stubGlobal('requestAnimationFrame',(f:FrameRequestCallback)=>{raf.push(f);return raf.length;});
  const view=render(<StrictMode><MediaViewerPanel clientId={cid} deviceId={did} deviceOnline={true} mediaCapable={true} autoStart compact/></StrictMode>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(1);});expect(m.waits).toHaveLength(1);
  expect(screen.queryByRole('button',{name:'查看屏幕'})).toBeNull();view.unmount();await act(async()=>m.waits[0](response('auto-late')));
  expect(m.stops).toEqual(['auto-late']);expect(raf).toHaveLength(0);
 }finally{vi.useRealTimers();}
});
it('auto viewing waits for media capability and does not authorize an offline device',async()=>{
 vi.useFakeTimers();
 try{
  const view=render(<MediaViewerPanel clientId={cid} deviceId={did} deviceOnline={true} mediaCapable={false} autoStart compact/>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(1);});expect(m.waits).toHaveLength(0);
  view.rerender(<MediaViewerPanel clientId={cid} deviceId={did} deviceOnline={false} mediaCapable={true} autoStart compact/>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(1);});expect(m.waits).toHaveLength(0);
  view.rerender(<MediaViewerPanel clientId={cid} deviceId={did} deviceOnline={true} mediaCapable={true} autoStart compact/>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(1);});expect(m.waits).toHaveLength(1);
 }finally{vi.useRealTimers();}
});
