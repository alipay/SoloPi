import {it,expect,vi,afterEach} from 'vitest';
import {MediaViewerPipeline} from '../src/media/MediaViewerPipeline';
class WS {static instance:WS;listeners:Record<string,Function[]>={};binaryType='';constructor(){WS.instance=this;} addEventListener(n:string,f:Function){(this.listeners[n]??=[]).push(f);} close(){} emit(n:string,e:unknown={}){for(const f of this.listeners[n]||[])f(e);}}
const au=new Uint8Array([0,0,0,1,0x67,0x42,0,0x1f,0,0,0,1,0x68,1,0,0,0,1,0x65,1]).buffer;
afterEach(()=>vi.unstubAllGlobals());
it('review: pending config must produce only one decoder and no post-stop frame presentation',async()=>{
 const releases:Function[]=[];let count=0;let output!:Function;
 class VD{static isConfigSupported=()=>new Promise(r=>{releases.push(r);});state='configured';constructor(o:{output:Function}){count++;output=o.output;}configure(){} decode(){}close(){}}
 vi.stubGlobal('WebSocket',WS);vi.stubGlobal('VideoDecoder',VD);vi.stubGlobal('EncodedVideoChunk',class{constructor(_o:unknown){}});
 const draw=vi.fn();const pipeline=new MediaViewerPipeline({wssUrl:'wss://example.test',canvas:{getContext:()=>({drawImage:draw})} as unknown as HTMLCanvasElement,onEvent:()=>{}});
 pipeline.start();WS.instance.emit('open');WS.instance.emit('message',{data:au});WS.instance.emit('message',{data:au});
 releases.forEach(r=>r({supported:true}));await Promise.resolve();await Promise.resolve();
 pipeline.stop();const closed=vi.fn();output?.({codedWidth:10,codedHeight:10,close:closed});
 expect(count).toBe(1);expect(draw).not.toHaveBeenCalled();
});
it('review: remote disconnect must clear first-frame timer and remain terminal',()=>{
 vi.useFakeTimers();vi.stubGlobal('WebSocket',WS);const states:string[]=[];
 const p=new MediaViewerPipeline({wssUrl:'wss://example.test',canvas:{} as HTMLCanvasElement,onEvent:e=>{if(e.type==='state')states.push(e.state.kind);}});
 p.start();WS.instance.emit('open');WS.instance.emit('close',{code:4404,reason:'stopped'});vi.advanceTimersByTime(9000);
 p.stop();vi.useRealTimers();expect(states.at(-1)).toBe('disconnected');
});

it('review: queued output after stop closes frame without drawing',async()=>{
 let output!:Function;class VD{static isConfigSupported=async()=>({supported:true});state='configured';constructor(o:{output:Function}){output=o.output;}configure(){}decode(){}close(){}}
 vi.stubGlobal('WebSocket',WS);vi.stubGlobal('VideoDecoder',VD);vi.stubGlobal('EncodedVideoChunk',class{constructor(_o:unknown){}});
 const draw=vi.fn();const p=new MediaViewerPipeline({wssUrl:'wss://example.test',canvas:{getContext:()=>({drawImage:draw})} as unknown as HTMLCanvasElement,onEvent:()=>{}});p.start();WS.instance.emit('open');WS.instance.emit('message',{data:au});await Promise.resolve();await Promise.resolve();p.stop();const close=vi.fn();output({codedWidth:10,codedHeight:10,close});expect(close).toHaveBeenCalledOnce();expect(draw).not.toHaveBeenCalled();
});
