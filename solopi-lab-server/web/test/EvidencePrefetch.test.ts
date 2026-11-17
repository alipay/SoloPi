import {it,expect,vi} from 'vitest';
import {createEvidenceReader} from '@desktop-report/evidence-reader';
it('warms screenshots, previews and log first pages before tab changes, reusing bytes but never preloading full videos',async()=>{
 const urls=new Map<string,Blob>();vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn((b:Blob)=>{const id='blob:'+Math.random();urls.set(id,b);return id}),revokeObjectURL:vi.fn()}));
 const read=vi.fn(async(tool:string,args:any)=>tool==='search_task_log'?{taskId:'t',scope:{caseId:args.caseId},matches:[{line:1,text:'saved log'}]}:{identity:{taskId:'t',caseId:args.caseId},offset:0,nextOffset:null,version:'v',mime:args.preview?'image/jpeg':'image/png',data:btoa('image')});const reader=createEvidenceReader('t',read),c=new AbortController();
 await reader.prefetch!('c',{screenshots:[{path:'/shot'}],recordings:[{path:'/video'}],logs:[{path:'/log',deviceType:'glasses'}]},c.signal);expect(read).toHaveBeenCalledTimes(3);expect(read.mock.calls.find(c=>c[0]==='read_case_artifact'&&c[1].artifactKind==='recordings')![1].preview).toBe(true);
 const first=await reader.artifact({caseId:'c',kind:'screenshots',index:0},c.signal),second=await reader.artifact({caseId:'c',kind:'screenshots',index:0},c.signal);expect(first.url).not.toBe(second.url);await reader.log({caseId:'c',deviceType:'glasses',query:'',fromLine:1},c.signal);expect(read).toHaveBeenCalledTimes(3);
 await reader.artifact({caseId:'other',kind:'screenshots',index:0},c.signal);expect(read).toHaveBeenCalledTimes(4);
 vi.unstubAllGlobals();
});
it('shares an in-flight fetch while keeping each consumer cancellation independent',async()=>{
 let finish!:(v:any)=>void;const read=vi.fn(()=>new Promise(r=>finish=r));const reader=createEvidenceReader('t',read),a=new AbortController(),b=new AbortController();const args={caseId:'c',deviceType:'glasses',query:'',fromLine:1};const one=reader.log(args,a.signal),two=reader.log(args,b.signal);const rejected=expect(one).rejects.toThrow();a.abort();finish({taskId:'t',scope:{caseId:'c'},matches:[]});await rejected;await expect(two).resolves.toMatchObject({text:''});expect(read).toHaveBeenCalledTimes(1);
});
it('reads video ranges concurrently after fixing the file version and assembles in offset order',async()=>{
 vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn((b:Blob)=>{expect(b.size).toBe(524288*3+2);return 'blob:video'}),revokeObjectURL:vi.fn()}));
 let active=0,max=0;const offsets:number[]=[];const read=vi.fn(async(_tool:string,a:any)=>{active++;max=Math.max(max,active);offsets.push(a.offset);expect(a.playback).toBe(true);if(a.offset)expect(a.version).toBe('fixed');await new Promise(r=>setTimeout(r,a.offset===524288?20:1));active--;const size=524288*3+2,n=Math.min(524288,size-a.offset);return {identity:{taskId:'t',caseId:'c'},offset:a.offset,nextOffset:a.offset+n<size?a.offset+n:null,version:'fixed',size,mime:'video/mp4',data:btoa('x'.repeat(n))};});
 await createEvidenceReader('t',read).artifact({caseId:'c',kind:'recordings',index:0},new AbortController().signal);expect(max).toBe(3);expect(offsets).toEqual([0,524288,1048576,1572864]);vi.unstubAllGlobals();
});
it('rejects changed versions and invalid chunk boundaries during concurrent video reads',async()=>{
 const read=vi.fn(async(_tool:string,a:any)=>({identity:{taskId:'t',caseId:'c'},offset:a.offset,nextOffset:a.offset===0?524288:null,version:a.offset?'changed':'fixed',size:524289,mime:'video/mp4',data:btoa('x'.repeat(a.offset?1:524288))}));await expect(createEvidenceReader('t',read).artifact({caseId:'c',kind:'recordings',index:0},new AbortController().signal)).rejects.toThrow('附件归属');
});
it('warms only current-case small recordings within the shared eight MiB budget',async()=>{
 vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn(()=> 'blob:warm'),revokeObjectURL:vi.fn()}));const read=vi.fn(async(_t:string,a:any)=>({identity:{taskId:'t',caseId:'c'},offset:0,nextOffset:null,version:'v',mime:a.preview?'image/jpeg':'video/mp4',data:btoa('video')}));const reader=createEvidenceReader('t',read),signal=new AbortController().signal;
 await reader.prefetch!('c',{recordings:[{path:'/small',sizeBytes:2000000},{path:'/big',sizeBytes:20000000}]} as any,signal);expect(read.mock.calls.filter(c=>!c[1].preview).length).toBe(1);await reader.artifact({caseId:'c',kind:'recordings',index:0},signal);expect(read).toHaveBeenCalledTimes(3);vi.unstubAllGlobals();
});
it('uses bounded inline metadata previews without another remote screenshot command',async()=>{
 vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn(()=> 'blob:inline'),revokeObjectURL:vi.fn()}));const read=vi.fn(),reader=createEvidenceReader('t',read);reader.prime!([{caseId:'c',kind:'screenshots',index:0,data:btoa('saved screenshot'),mime:'image/png'}]);await reader.artifact({caseId:'c',kind:'screenshots',index:0},new AbortController().signal);expect(read).not.toHaveBeenCalled();vi.unstubAllGlobals();
});
