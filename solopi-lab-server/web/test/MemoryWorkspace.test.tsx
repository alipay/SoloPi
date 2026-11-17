import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MemoryWorkspace} from '../src/pages/MemoryWorkspace';
let calls:any[],entry:any;
beforeEach(()=>{calls=[];entry={id:'one',logicalId:'logical',revision:1,title:'配置收尾',type:'memories',category:'business-rule',folder:'',namespace:'project',state:'pending',kind:'requirement',abstract:'配置必须清理',uri:'context://project/memories/business-rule/one.md',admission:{originalAvailable:true},sourceContext:{channel:'chat-bridge'}};vi.stubGlobal('fetch',vi.fn(async(url:string,init:any)=>{const input=init?.body?JSON.parse(init.body):{};calls.push([url,input]);let value:any={};if(url.endsWith('namespaces'))value={items:[{namespace:'project',count:1}]};if(url.endsWith('catalog'))value={items:[entry],directories:[{type:entry.type,category:entry.category,folder:entry.folder,count:1}],total:1,nextOffset:null};if(url.endsWith('layers'))value={...entry,overview:'来源概览',...(input.level==='L2'?{content:'原始正文',nextOffset:null}:{})};if(url.endsWith('original'))value={available:true,kind:'conversation',name:'conversation.txt',sha256:'original-hash',bytes:40,text:'  用户逐字原文\n第二行保持不变\n',nextOffset:null};if(url.endsWith('manage')){entry={...entry,id:'two',revision:2,content:input.content,state:input.operation==='publish'?'active':entry.state};value=entry}if(url.endsWith('history'))value={items:[entry],changes:[]};if(url.endsWith('usage'))value={items:[],meaning:'读取不代表采纳'};return {ok:true,json:async()=>value}}))});afterEach(()=>{cleanup();vi.unstubAllGlobals()});
it('listing and overview never load body until requested',async()=>{render(<MemoryWorkspace/>);fireEvent.click(await screen.findByRole('button',{name:/配置收尾/}));await screen.findByText('来源概览');expect(calls.filter(c=>c[0].endsWith('layers')).every(c=>c[1].level==='L1')).toBe(true);expect(screen.getByLabelText('上下文目录')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'正文'}));await screen.findByText('原始正文');expect(calls.some(c=>c[1].level==='L2')).toBe(true)});
it('correction loads full text then sends optimistic version and preserves provenance',async()=>{render(<MemoryWorkspace/>);fireEvent.click(await screen.findByRole('button',{name:/配置收尾/}));fireEvent.click(screen.getByRole('button',{name:'纠正'}));const body=await screen.findByLabelText('正文');expect((body as HTMLTextAreaElement).value).toBe('原始正文');fireEvent.change(body,{target:{value:'纠正正文'}});fireEvent.change(screen.getByLabelText(/备注/),{target:{value:'用户确认'}});fireEvent.click(screen.getByRole('button',{name:'确认保存'}));await waitFor(()=>expect(calls.find(c=>c[0].endsWith('manage'))?.[1]).toMatchObject({id:'one',expectedRevision:1,operation:'revise',content:'纠正正文',reason:'用户确认'}));await screen.findByRole('status');});
it('publication is explicit and errors retain editing text',async()=>{render(<MemoryWorkspace/>);fireEvent.click(await screen.findByRole('button',{name:/配置收尾/}));fireEvent.click(screen.getByRole('button',{name:'认可并生效'}));expect(calls.some(c=>c[0].endsWith('manage'))).toBe(false);fireEvent.click(screen.getByRole('button',{name:'取消'}));fireEvent.click(screen.getByRole('button',{name:'纠正'}));fireEvent.change(await screen.findByLabelText('正文'),{target:{value:'不能丢失的修改'}});const fetch=globalThis.fetch as any;fetch.mockImplementationOnce(async()=>({ok:false,json:async()=>({error:{message:'内容已被更新'}})}));fireEvent.click(screen.getByRole('button',{name:'确认保存'}));await screen.findByRole('alert');expect((screen.getByLabelText('正文') as HTMLTextAreaElement).value).toBe('不能丢失的修改')});

it('source tab loads the verbatim original separately from summaries',async()=>{render(<MemoryWorkspace/>);fireEvent.click(await screen.findByRole('button',{name:/配置收尾/}));fireEvent.click(screen.getByRole('button',{name:'来源'}));await screen.findByRole('button',{name:'预览原文'});expect(screen.queryByText(/用户逐字原文/)).toBeNull();expect(screen.getByRole('button',{name:'下载原文件'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'预览原文'}));const original=await screen.findByText(/用户逐字原文/);expect(original.tagName).toBe('PRE');expect(original.textContent).toBe('  用户逐字原文\n第二行保持不变\n');expect(calls.some(c=>c[0].endsWith('original'))).toBe(true)});
it('requires the user acknowledgement checkbox before publishing a version',async()=>{render(<MemoryWorkspace/>);fireEvent.click(await screen.findByRole('button',{name:/配置收尾/}));fireEvent.click(screen.getByRole('button',{name:'认可并生效'}));expect((screen.getByRole('button',{name:'确认保存'}) as HTMLButtonElement).disabled).toBe(true);fireEvent.click(screen.getByLabelText('我已核对原文并认可此版本内容'));fireEvent.click(screen.getByRole('button',{name:'确认保存'}));await waitFor(()=>expect(calls.find(c=>c[0].endsWith('manage'))?.[1]).toMatchObject({userConfirmed:true,operation:'publish'}));});

it('source and usage data never render as version records while switching tabs',async()=>{
 render(<MemoryWorkspace/>);fireEvent.click(await screen.findByRole('button',{name:/配置收尾/}));
 fireEvent.click(screen.getByRole('button',{name:'来源'}));await screen.findByRole('button',{name:'预览原文'});
 fireEvent.click(screen.getByRole('button',{name:'版本'}));await screen.findByText('v1 · 待确认');
 fireEvent.click(screen.getByRole('button',{name:'使用记录'}));await screen.findByText('读取不代表采纳');
 fireEvent.click(screen.getByRole('button',{name:'版本'}));await screen.findByText('v1 · 待确认');
 expect(screen.getByRole('region',{name:'上下文记忆'})).toBeTruthy();expect(screen.queryByRole('alert')).toBeNull();
});
it('a late source response cannot overwrite the currently selected version tab even if abort is ignored',async()=>{
 const fallback=globalThis.fetch;let release!:(x:unknown)=>void;
 vi.stubGlobal('fetch',vi.fn((url:string,init:any)=>url.endsWith('original')?new Promise(resolve=>{release=resolve}):fallback(url,init)));
 render(<MemoryWorkspace/>);fireEvent.click(await screen.findByRole('button',{name:/配置收尾/}));fireEvent.click(screen.getByRole('button',{name:'来源'}));
 await waitFor(()=>expect(release).toBeDefined());fireEvent.click(screen.getByRole('button',{name:'版本'}));await screen.findByText('v1 · 待确认');
 release({ok:true,json:async()=>({available:true,text:'旧来源迟到',kind:'conversation'})});
 await waitFor(()=>expect(screen.getByText('v1 · 待确认')).toBeTruthy());expect(screen.queryByText('旧来源迟到')).toBeNull();expect(screen.queryByRole('alert')).toBeNull();
});
it('malformed history shows a recoverable error instead of crashing the page',async()=>{
 const fallback=globalThis.fetch;vi.stubGlobal('fetch',vi.fn((url:string,init:any)=>url.endsWith('history')?Promise.resolve({ok:true,json:async()=>({items:[]})}):fallback(url,init)));
 render(<MemoryWorkspace/>);fireEvent.click(await screen.findByRole('button',{name:/配置收尾/}));fireEvent.click(screen.getByRole('button',{name:'版本'}));
 expect((await screen.findByRole('alert')).textContent).toContain('版本记录格式异常');fireEvent.click(screen.getByRole('button',{name:'来源'}));await screen.findByRole('button',{name:'预览原文'});expect(screen.queryByRole('alert')).toBeNull();
});
it('missing original has an actionable acknowledgement entry but cannot be published with only a checkbox',async()=>{
 entry.admission.originalAvailable=false;const fallback=globalThis.fetch;
 vi.stubGlobal('fetch',vi.fn((url:string,init:any)=>url.endsWith('original')?Promise.resolve({ok:true,json:async()=>({available:false,reason:'缺少完整来源'})}):fallback(url,init)));
 render(<MemoryWorkspace/>);fireEvent.click(await screen.findByRole('button',{name:/配置收尾/}));
 expect((screen.getByRole('button',{name:'认可并生效'}) as HTMLButtonElement).disabled).toBe(false);fireEvent.click(screen.getByRole('button',{name:'认可并生效'}));
 await screen.findByText('缺少来源原件');fireEvent.click(screen.getByLabelText('我已核对原文并认可此版本内容'));
 expect((screen.getByRole('button',{name:'确认保存'}) as HTMLButtonElement).disabled).toBe(true);expect(calls.some(c=>c[0].endsWith('manage'))).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'补充原始来源'}));await screen.findByLabelText('补充原始文件');expect(screen.getByRole('heading',{name:'补齐来源'})).toBeTruthy();
});
it('shows the exact file location and quote beside the original file',async()=>{
 const fallback=globalThis.fetch;vi.stubGlobal('fetch',vi.fn((url:string,init:any)=>url.endsWith('original')?Promise.resolve({ok:true,json:async()=>({available:true,kind:'file',name:'AGENTS.md',bytes:100,sha256:'file-version',text:'# Rules\n原始规则\n',location:{startLine:2,endLine:2,quote:'原始规则'}})}):fallback(url,init)));
 render(<MemoryWorkspace/>);fireEvent.click(await screen.findByRole('button',{name:/配置收尾/}));fireEvent.click(screen.getByRole('button',{name:'来源'}));
 const location=await screen.findByLabelText('上下文在原文件中的位置');expect(location.textContent).toContain('AGENTS.md · 第 2 行');expect(location.textContent).toContain('原始规则');expect(screen.getByRole('button',{name:'下载原文件'})).toBeTruthy();
});

it('existing source has preview and download icons without replacement controls or delivery notes',async()=>{
 const fallback=globalThis.fetch;vi.stubGlobal('fetch',vi.fn((url:string,init:any)=>url.endsWith('original')?Promise.resolve({ok:true,json:async()=>({available:true,kind:'file',name:'rules.md',bytes:20,text:'完整原文',metadata:{recoveryNote:'仅向作者解释的恢复说明'}})}):fallback(url,init)));
 render(<MemoryWorkspace/>);fireEvent.click(await screen.findByRole('button',{name:/配置收尾/}));fireEvent.click(screen.getByRole('button',{name:'来源'}));
 await screen.findByRole('button',{name:'预览原文'});expect(screen.queryByText('完整原文')).toBeNull();expect(screen.queryByText('仅向作者解释的恢复说明')).toBeNull();expect(screen.queryByLabelText('补充原始文件')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'预览原文'}));await screen.findByRole('dialog');await screen.findByText('完整原文');fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape',code:'Escape'});await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(screen.queryByText('完整原文')).toBeNull();
});
it('original preview reads following pages only when requested',async()=>{
 const fallback=globalThis.fetch;vi.stubGlobal('fetch',vi.fn((url:string,init:any)=>{const input=init?.body?JSON.parse(init.body):{};return url.endsWith('original')?Promise.resolve({ok:true,json:async()=>({available:true,kind:'file',name:'rules.md',bytes:30,text:input.offset===6?'第二段':'第一段',nextOffset:input.offset===6?null:6})}):fallback(url,init)}));
 render(<MemoryWorkspace/>);fireEvent.click(await screen.findByRole('button',{name:/配置收尾/}));fireEvent.click(screen.getByRole('button',{name:'来源'}));fireEvent.click(await screen.findByRole('button',{name:'预览原文'}));await screen.findByText('第一段');expect(screen.queryByText('第二段')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'继续读取'}));await screen.findByText('第一段第二段');
});

it('publication accepts an empty optional note and keeps acknowledgement in one labelled row',async()=>{
 render(<MemoryWorkspace/>);fireEvent.click(await screen.findByRole('button',{name:/配置收尾/}));fireEvent.click(screen.getByRole('button',{name:'认可并生效'}));
 const note=screen.getByRole('textbox',{name:/备注/}) as HTMLTextAreaElement;expect(note.required).toBe(false);expect(note.value).toBe('');const checkbox=screen.getByLabelText('我已核对原文并认可此版本内容');expect(checkbox.closest('label')?.className).toBe('memory-ack');fireEvent.click(checkbox);fireEvent.click(screen.getByRole('button',{name:'确认保存'}));await waitFor(()=>expect(calls.find(c=>c[0].endsWith('manage'))?.[1]).toMatchObject({operation:'publish',reason:'',userConfirmed:true}));
});
