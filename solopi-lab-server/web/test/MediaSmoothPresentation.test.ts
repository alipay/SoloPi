import {afterEach,it,expect,vi} from 'vitest';
import {MediaViewerPipeline} from '../src/media/MediaViewerPipeline';
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers()});
function setup(){
 vi.useFakeTimers();const callbacks=new Map<number,FrameRequestCallback>();let id=0;
 vi.stubGlobal('requestAnimationFrame',vi.fn((cb:FrameRequestCallback)=>{callbacks.set(++id,cb);return id}));vi.stubGlobal('cancelAnimationFrame',vi.fn((n:number)=>callbacks.delete(n)));
 const draw=vi.fn(),events:any[]=[];const canvas={width:100,height:100,getContext:()=>({drawImage:draw})} as any;
 const pipe=new MediaViewerPipeline({canvas,wssUrl:'wss://fixture.invalid',presentOnAnimationFrame:true,onEvent:e=>events.push(e)});
 const frame=(label:string)=>({label,codedWidth:100,codedHeight:100,close:vi.fn()});
 return{pipe,draw,events,frame,tick(){const pending=[...callbacks.values()];callbacks.clear();for(const cb of pending)cb(16)},callbacks};
}
it('shows the first frame immediately and paints only the newest decoded frame per screen refresh',()=>{
 const t=setup(),frames=['first','old','newest'].map(t.frame);for(const f of frames)(t.pipe as any).drawFrame(f);
 expect(t.draw).toHaveBeenCalledTimes(1);expect(frames[1].close).toHaveBeenCalledTimes(1);expect(frames[2].close).not.toHaveBeenCalled();
 t.tick();expect(t.draw).toHaveBeenCalledTimes(2);expect(t.draw.mock.calls[1][0]).toBe(frames[2]);for(const f of frames)expect(f.close).toHaveBeenCalledTimes(1);t.pipe.stop();
});
it('closing the viewer cancels pending drawing and releases every held frame',()=>{
 const t=setup(),a=t.frame('first'),b=t.frame('pending');(t.pipe as any).drawFrame(a);(t.pipe as any).drawFrame(b);t.pipe.stop();t.tick();expect(t.draw).toHaveBeenCalledTimes(1);expect(b.close).toHaveBeenCalledTimes(1);expect(t.callbacks.size).toBe(0);
});
it('retains ordered encoded frames through a temporary decoder backlog and cancels the pump on stop',()=>{
 vi.useFakeTimers();const decoded:any[]=[];const decoder={decodeQueueSize:9,decode:(chunk:any)=>decoded.push(chunk),close:vi.fn()};
 vi.stubGlobal('EncodedVideoChunk',class{constructor(v:any){Object.assign(this,v)}});
 const p=new MediaViewerPipeline({canvas:{} as any,wssUrl:'wss://fixture.invalid',bufferEncodedBursts:true,onEvent:()=>{}}) as any;p.decoder=decoder;p.awaitingKey=false;p.configured=true;
 const a=new Uint8Array([0,0,1,0x41,1]),b=new Uint8Array([0,0,1,0x41,2]);p.acceptAu(a);p.acceptAu(b);expect(decoded).toHaveLength(0);
 decoder.decodeQueueSize=0;vi.advanceTimersByTime(8);expect(decoded.map(c=>c.data)).toEqual([a,b]);p.stop();expect(vi.getTimerCount()).toBe(0);
});
it('bounds an overloaded decoder backlog and resumes only at a new keyframe',()=>{
 vi.useFakeTimers();vi.stubGlobal('EncodedVideoChunk',class{constructor(v:any){Object.assign(this,v)}});const decoded:any[]=[];
 const decoder={decodeQueueSize:20,decode:(v:any)=>decoded.push(v),close:vi.fn()},p=new MediaViewerPipeline({canvas:{} as any,wssUrl:'wss://fixture.invalid',bufferEncodedBursts:true,onEvent:()=>{}}) as any;p.decoder=decoder;p.awaitingKey=false;p.configured=true;
 for(let i=0;i<61;i++)p.acceptAu(new Uint8Array([0,0,1,0x41,i]));expect(p.encodedPending.length).toBe(0);decoder.decodeQueueSize=0;p.acceptAu(new Uint8Array([0,0,1,0x41,1]));expect(decoded).toHaveLength(0);p.acceptAu(new Uint8Array([0,0,1,0x65,1]));expect(decoded).toHaveLength(1);p.stop();
});
