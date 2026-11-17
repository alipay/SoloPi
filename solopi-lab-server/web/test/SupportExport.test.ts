import {afterEach,expect,it,vi} from 'vitest';
import {downloadClientSupport,downloadServerSupport,clearLogDownloadCache} from '../src/api/support-export';
afterEach(()=>{vi.restoreAllMocks();clearLogDownloadCache('client','task');});
it('server download uses scoped route and produces a gzip file',async()=>{
 const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{}),create=vi.fn(()=> 'blob:test');URL.createObjectURL=create;URL.revokeObjectURL=vi.fn();
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({encoding:'base64',data:btoa('gzip-bytes')})));
 await downloadServerSupport(new AbortController().signal);expect(fetch).toHaveBeenCalledWith('/lab/diagnostics',expect.objectContaining({method:'GET'}));expect(create.mock.calls.length).toBe(1);expect(click).toHaveBeenCalledTimes(1);
});
it('wrong export chunk version stops download before saving a file',async()=>{
 URL.createObjectURL=vi.fn();const id='11111111-1111-4111-8111-111111111111';let tool='';
 vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{if(init?.method==='POST'){tool=JSON.parse(String(init.body)).tool;return new Response('{}');}return new Response(JSON.stringify({status:'succeeded',result:tool==='export_support_bundle'?{exportId:id,size:3,version:'original'}:{exportId:id,size:3,version:'changed',offset:0,data:btoa('abc')}}));});
 await expect(downloadClientSupport('client',{},new AbortController().signal,()=>{})).rejects.toThrow('校验失败');expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it('downloads exactly the selected case/device log in full, preserving long lines and blank lines',async()=>{
 const {readCaseLogDownload}=await import('../src/api/support-export'),{gzipSync,gunzipSync}=await import('node:zlib');
 const {Blob:NativeBlob}=await import('node:buffer'),{webcrypto}=await import('node:crypto');vi.stubGlobal('Blob',NativeBlob);vi.stubGlobal('crypto',webcrypto);
 try{
  const content='g'.repeat(6000)+'\n\nlast line\n';const payload={taskId:'task',files:[{caseId:'other',deviceType:'glasses',encoding:'base64',data:gzipSync('FOREIGN').toString('base64')},{caseId:'case',deviceType:'phone',encoding:'base64',data:gzipSync('PHONE').toString('base64')},{caseId:'case',deviceType:'glasses',encoding:'base64',data:gzipSync(content).toString('base64')}]};
  const bytes=gzipSync(JSON.stringify(payload)),version=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join(''),commands=new Map<string,any>();
  vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{if(init?.method==='POST'){const b=JSON.parse(String(init.body));commands.set(b.requestId,b);return new Response('{}');}const c=commands.get(String(url).split('/').pop()!);return new Response(JSON.stringify({status:'succeeded',result:c.tool==='export_support_bundle'?{exportId:'11111111-1111-4111-8111-111111111111',size:bytes.length,version}:{exportId:c.args.exportId,version,size:bytes.length,offset:c.args.offset,data:bytes.toString('base64')}}));});
  const create=vi.fn((_value:Blob)=> 'blob:exact-log');URL.createObjectURL=create;
  await readCaseLogDownload('client','task','case','glasses',0,new AbortController().signal);
  const blob=create.mock.calls[0][0] as Blob;expect(gunzipSync(Buffer.from(await blob.arrayBuffer())).toString()).toBe(content);
  expect([...commands.values()][0].args).toEqual({taskId:'task',caseIds:['case']});const before=commands.size;await readCaseLogDownload('client','task','case','phone',0,new AbortController().signal);expect(commands.size).toBe(before);
 }finally{vi.unstubAllGlobals();}
});
it('downloads bounded parallel ranges in order and reports progress without changing file integrity',async()=>{
 const {readClientSupport}=await import('../src/api/support-export'),{webcrypto,randomBytes}=await import('node:crypto');vi.stubGlobal('crypto',webcrypto);
 try{
  const bytes=randomBytes(900000),version=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  const commands=new Map<string,any>();let active=0,maxActive=0;const progress:string[]=[];
  vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{if(init?.method==='POST'){const b=JSON.parse(String(init.body));commands.set(b.requestId,b);if(b.tool==='read_support_export')maxActive=Math.max(maxActive,++active);return new Response('{}');}
   const c=commands.get(String(url).split('/').pop()!);let result;if(c.tool==='export_support_bundle')result={exportId:'11111111-1111-4111-8111-111111111111',size:bytes.length,version};else{await new Promise(r=>setTimeout(r,c.args.offset===0?30:5));active--;result={exportId:c.args.exportId,version,size:bytes.length,offset:c.args.offset,data:bytes.subarray(c.args.offset,c.args.offset+c.args.length).toString('base64')};}return new Response(JSON.stringify({status:'succeeded',result}));});
  const result=await readClientSupport('client',{},new AbortController().signal,s=>progress.push(s));expect(maxActive).toBe(4);expect(Buffer.concat(result.blocks.map(b=>Buffer.from(b)))).toEqual(bytes);expect(progress.at(-1)).toContain('100%');
 }finally{vi.unstubAllGlobals();}
});
