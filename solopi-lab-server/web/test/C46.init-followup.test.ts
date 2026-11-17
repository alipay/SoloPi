import {it,expect,vi,afterEach} from 'vitest';
import {MediaViewerPipeline,PipelineEvent}from'../src/media/MediaViewerPipeline';
class WS{static instance:WS;listeners:Record<string,Function[]>={};closed=false;constructor(){WS.instance=this;}addEventListener(n:string,f:Function){(this.listeners[n]??=[]).push(f);}close(){this.closed=true;}emit(n:string,e:unknown={}){for(const f of this.listeners[n]||[])f(e);}}
const key=new Uint8Array([0,0,1,0x67,0x42,0,0x1f,0,0,1,0x68,1,0,0,1,0x65,1]).buffer;
const delta=(n:number)=>new Uint8Array([0,0,1,0x41,n]).buffer;
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
function harness(deferred=false,throwConfigure=false){let resolve!:Function,error!:Function;const decoded:any[]=[];const instances:any[]=[];const events:PipelineEvent[]=[];class VD{state='configured';decodeQueueSize=0;static isConfigSupported=()=>deferred?new Promise(r=>resolve=r):Promise.resolve({supported:true});constructor(o:{error:Function}){error=o.error;instances.push(this);}configure(){if(throwConfigure)throw Error('fixture-configure');}decode(c:unknown){decoded.push(c);this.decodeQueueSize++;}close=vi.fn();}
 vi.stubGlobal('WebSocket',WS);vi.stubGlobal('VideoDecoder',VD);vi.stubGlobal('EncodedVideoChunk',class{data:ArrayBuffer;constructor(o:{data:ArrayBuffer}){this.data=o.data;}});
 const p=new MediaViewerPipeline({wssUrl:'wss://fixture',canvas:{getContext:()=>null} as unknown as HTMLCanvasElement,maxDecodeQueueSize:2,onEvent:e=>events.push(e)});p.start();WS.instance.emit('open');return{p,decoded,instances,events,resolve:()=>resolve({supported:true}),error:()=>error(Error('late')),send:(data:ArrayBuffer)=>WS.instance.emit('message',{data})};}
const settled=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};

it('init drops delta1: delta2 after support resolves must still wait for next IDR',async()=>{const h=harness(true);h.send(key);h.send(delta(1));h.resolve();await settled();h.send(delta(2));h.p.stop();expect(h.decoded.length).toBe(1);});
it('init pending key then dropped delta: later delta must wait for new IDR',async()=>{const h=harness(true);h.send(key);h.send(key);h.send(delta(1));h.resolve();await settled();h.send(delta(2));h.p.stop();expect(h.decoded.length).toBe(2);});
it('post-init queue overflow recovers on key and then permits dependent delta',async()=>{const h=harness();h.send(key);await settled();h.instances[0].decodeQueueSize=3;h.send(delta(1));h.instances[0].decodeQueueSize=0;h.send(delta(2));expect(h.decoded.length).toBe(1);h.send(key);h.send(delta(3));h.p.stop();expect(h.decoded.length).toBe(3);});
