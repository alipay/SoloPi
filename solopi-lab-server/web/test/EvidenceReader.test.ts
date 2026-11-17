import {expect,it,vi} from 'vitest';
import {createEvidenceReader} from '@desktop-report/evidence-reader';
it('rejects a log belonging to another case',async()=>{const reader=createEvidenceReader('task',vi.fn(async()=>({taskId:'task',scope:{caseId:'other'},matches:[]})));await expect(reader.log({caseId:'case',deviceType:'glasses',query:'',fromLine:1},new AbortController().signal)).rejects.toThrow('日志与当前用例不匹配');});
it('rejects artifact chunks with a different task identity before making a URL',async()=>{const reader=createEvidenceReader('task',vi.fn(async()=>({identity:{taskId:'foreign',caseId:'case'},offset:0})));await expect(reader.artifact({caseId:'case',kind:'recordings',index:0},new AbortController().signal)).rejects.toThrow('附件归属或读取边界不一致');});
it('does not read evidence after the selected case is unmounted',async()=>{const read=vi.fn(),reader=createEvidenceReader('task',read),controller=new AbortController();controller.abort();await expect(reader.artifact({caseId:'case',kind:'recordings',index:0},controller.signal)).rejects.toThrow();expect(read).not.toHaveBeenCalled();});
it('reuses persisted completed screenshot bytes across reader remounts without a Client command',async()=>{
 const stored=new Map<string,Blob>(),persistence={get:async(k:string)=>stored.get(k),set:async(k:string,v:Blob)=>{stored.set(k,v)}};
 const read=vi.fn(async()=>({identity:{taskId:'task',caseId:'case'},offset:0,size:3,mime:'image/png',version:'v1',data:btoa('abc'),nextOffset:null}));
 vi.stubGlobal('URL',{...URL,createObjectURL:vi.fn(()=> 'blob:cached'),revokeObjectURL:vi.fn()});
 const args={caseId:'case',kind:'screenshots' as const,index:0};
 await createEvidenceReader('task',read,persistence).artifact(args,new AbortController().signal);
 await createEvidenceReader('task',read,persistence).artifact(args,new AbortController().signal);
 expect(read).toHaveBeenCalledTimes(1);vi.unstubAllGlobals();
});
it('keeps original recording downloads distinct from playable derivatives',async()=>{
 const read=vi.fn(async(_tool:string,_args:Record<string,unknown>)=>({identity:{taskId:'task',caseId:'case'},offset:0,size:3,mime:'video/mp4',version:'v1',data:btoa('abc'),nextOffset:null}));
 vi.stubGlobal('URL',class extends URL{static createObjectURL=vi.fn(()=> 'blob:video')});
 try{const reader=createEvidenceReader('task',read),signal=new AbortController().signal;
 await reader.artifact({caseId:'case',kind:'recordings',index:0},signal);await reader.artifact({caseId:'case',kind:'recordings',index:0,original:true},signal);
 expect(read.mock.calls[0][1]).toMatchObject({playback:true});expect(read.mock.calls[1][1]).not.toHaveProperty('playback');
 }finally{vi.unstubAllGlobals();}
});
