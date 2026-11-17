import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ServerAgent} from '../src/pages/ServerAgent';
import AgentMarkdown from '@desktop-ui/AgentMarkdown';
import {AgentComposer} from '@desktop-ui/AgentChat';
const a={id:'chat-a',title:'会话 A',messages:[] as any[]},b={id:'chat-b',title:'会话 B',messages:[] as any[]};
const model={configured:true,model:'fixture'};
it('does not interpolate missing retry codes into the page',async()=>{
 const row={id:'legacy-retry',text:'查询原任务',status:'running',gmt_create:'2026-11-10 01:00:00',result:{progress:{event:'llm/retry',attempt:1,maxRetries:1}}};
 const fetch=setup({conversations:{'chat-a':{...a,messages:[row]},'chat-b':b}});
 await screen.findByText(/正在等待第 1\/1 次重试/);
 expect(document.body.textContent).not.toContain('undefined');expect(document.body.textContent).not.toContain('UNKNOWN');
 expect(fetch.mock.calls.every(([,init])=>init?.method!=='POST')).toBe(true);
});
it('renders actual stream text and opens the latest reasoning using the shared Desktop renderer',async()=>{
 const row={id:'live',text:'分析需求',status:'running',gmt_create:'2026-11-10 01:00:00',result:{process:[{role:'assistant',content:'先读需求',reasoning_content:'previous reasoning'}],streaming:{content:'正在核验方案',reasoning:'current reasoning',createdAt:'2026-11-10T01:00:02Z'}}};
 setup({conversations:{'chat-a':{...a,messages:[row]},'chat-b':b}});
 await screen.findByText('正在核验方案');expect(screen.getByText('先读需求')).toBeTruthy();
 expect(screen.getByText('current reasoning').closest('details')!.open).toBe(true);
 expect(screen.getByText('previous reasoning').closest('details')!.open).toBe(false);
});
function setup({items=[a,b],conversations={['chat-a']:a,['chat-b']:b},configured=true,post}:any={}){
 const fetch=vi.fn(async(url:string,init?:RequestInit)=>{
  const path=url.replace('/superagent/','');
  if(init?.method==='POST'&&path.endsWith('/messages'))return post?post(path,init):{ok:true,json:async()=>conversations[path.split('/')[1]]};
  const value=path==='model'?{...model,configured}:path==='conversations'?{items}:path.startsWith('conversations/')?conversations[path.split('/')[1]]:null;
  if(init?.method==='POST'&&path==='conversations')return{ok:true,json:async()=>({id:'new-chat',title:'新会话',messages:[]})};
  return{ok:true,json:async()=>value};
 });vi.stubGlobal('fetch',fetch);render(<ServerAgent/>);return fetch;
}
async function ready(){await waitFor(()=>expect(screen.getByLabelText('给 Superagent 的消息').hasAttribute('disabled')).toBe(false));}
afterEach(()=>{cleanup();localStorage.clear();vi.restoreAllMocks();vi.unstubAllGlobals();location.hash='';});
it('renders shared Desktop Markdown, tool disclosure and native browser links without IPC',async()=>{
 const row={id:'row',text:'分析结果',status:'succeeded',gmt_create:'2026-11-10 01:00:00',result:{text:'## 结论\n\n**通过**\n\n|项目|结果|\n|---|---|\n|A|OK|\n\n```sh\necho ok\n```\n\n[报告](https://example.test/report)',tools:[{name:'read_report',status:'done'}]}};
 setup({conversations:{'chat-a':{...a,messages:[row]},'chat-b':b}});await ready();
 expect(await screen.findByRole('heading',{name:'结论'})).toBeTruthy();expect(screen.getByRole('table')).toBeTruthy();expect(screen.getByText('echo ok').tagName).toBe('CODE');
 fireEvent.click(screen.getByRole('button',{name:/1 次工具调用/}));const summary=await screen.findByText('read_report');fireEvent.click(summary);const details=summary.closest('details')!;details.open=true;fireEvent(details,new Event('toggle'));
 await waitFor(()=>expect(within(details).getByText(/"status": "done"/)).toBeTruthy());
 const event=new MouseEvent('click',{bubbles:true,cancelable:true});screen.getByRole('link',{name:'报告'}).dispatchEvent(event);expect(event.defaultPrevented).toBe(false);
 expect(screen.queryByLabelText('添加图片或文件')).toBeNull();expect(screen.queryByLabelText('停止对话')).toBeNull();expect(screen.getByLabelText('选择对话模型')).toBeTruthy();
});
it('shared Markdown preserves Desktop external-link IPC',()=>{
 const invoke=vi.fn(async()=>({}));Object.defineProperty(window,'glassbox',{configurable:true,value:{ipcRenderer:{invoke}}});render(<AgentMarkdown>{'[报告](https://example.test/report)'}</AgentMarkdown>);
 const event=new MouseEvent('click',{bubbles:true,cancelable:true});screen.getByRole('link').dispatchEvent(event);expect(event.defaultPrevented).toBe(true);expect(invoke).toHaveBeenCalledWith('shell:open-external','https://example.test/report');delete (window as any).glassbox;
});
it('uses the shared composer: IME and Shift+Enter do not send, Enter sends once',async()=>{
 const fetch=setup();await ready();const input=screen.getByLabelText('给 Superagent 的消息');fireEvent.change(input,{target:{value:'开始查询'}});
 fireEvent.keyDown(input,{key:'Enter',isComposing:true,keyCode:229});fireEvent.keyDown(input,{key:'Enter',shiftKey:true});expect(fetch.mock.calls.filter(c=>c[1]?.method==='POST')).toHaveLength(0);
 fireEvent.keyDown(input,{key:'Enter'});await waitFor(()=>expect(fetch.mock.calls.filter(c=>c[1]?.method==='POST')).toHaveLength(1));
});
it.each(['unconfigured','running'])('Enter cannot bypass the send restriction: %s',async mode=>{
 const fetch=setup({configured:mode!=='unconfigured',conversations:{'chat-a':mode==='running'?{...a,messages:[{id:'r',text:'先前操作',status:'running',gmt_create:'2026-11-10 01:00:00'}]}:a,'chat-b':b}});await ready();const input=screen.getByLabelText('给 Superagent 的消息');fireEvent.change(input,{target:{value:'新的操作'}});fireEvent.keyDown(input,{key:'Enter'});expect(fetch.mock.calls.filter(c=>c[1]?.method==='POST')).toHaveLength(0);expect((screen.getByRole('button',{name:'发送'}) as HTMLButtonElement).disabled).toBe(true);
});
it('uncertain response retains the original request key and reconciles only on user action',async()=>{
 let attempt=0;const fetch=setup({post:async()=>{if(!attempt++)throw Error('connection closed');return{ok:true,json:async()=>a};}});await ready();fireEvent.change(screen.getByLabelText('给 Superagent 的消息'),{target:{value:'查询任务'}});fireEvent.click(screen.getByRole('button',{name:'发送'}));
 await screen.findByText(/结果未知/);expect(fetch.mock.calls.filter(c=>c[1]?.method==='POST')).toHaveLength(1);const saved=localStorage.getItem('server-superagent-pending:chat-a');expect(saved).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'核对原消息'}));await waitFor(()=>expect(localStorage.getItem('server-superagent-pending:chat-a')).toBeNull());
 const writes=fetch.mock.calls.filter(c=>c[1]?.method==='POST');expect(writes).toHaveLength(2);expect(writes[0][1]?.body).toBe(writes[1][1]?.body);
});
it('a late send receipt cannot replace another selected conversation',async()=>{
 let resolve!:(v:any)=>void;setup({post:()=>new Promise(r=>resolve=r)});await ready();fireEvent.change(screen.getByLabelText('给 Superagent 的消息'),{target:{value:'A 消息'}});fireEvent.click(screen.getByRole('button',{name:'发送'}));await waitFor(()=>expect(resolve).toBeTruthy());fireEvent.click(screen.getByRole('button',{name:'会话 B'}));await ready();fireEvent.change(screen.getByLabelText('给 Superagent 的消息'),{target:{value:'B 草稿'}});
 await act(async()=>resolve({ok:true,json:async()=>({...a,messages:[{id:'old',text:'A 消息',status:'succeeded',gmt_create:'2026-11-10 01:00:00',result:{text:'旧会话回执'}}]})}));
 expect((screen.getByLabelText('给 Superagent 的消息') as HTMLTextAreaElement).value).toBe('B 草稿');expect(screen.queryByText('旧会话回执')).toBeNull();
});
it('creates a new conversation and keeps the central configuration links',async()=>{
 setup();await ready();fireEvent.click(screen.getByRole('button',{name:'新对话'}));await waitFor(()=>expect(screen.getByRole('button',{name:'新会话'}).getAttribute('aria-current')).toBe('page'));expect(screen.getByRole('link',{name:'运行时与模型配置'}).getAttribute('href')).toBe('#/settings/runtime');
});
it('failed pending storage refuses to post instead of losing the idempotency key',async()=>{
 const fetch=setup();await ready();vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('quota');});fireEvent.change(screen.getByLabelText('给 Superagent 的消息'),{target:{value:'查询'}});fireEvent.click(screen.getByRole('button',{name:'发送'}));await screen.findByText(/无法保存原消息标识/);expect(fetch.mock.calls.filter(c=>c[1]?.method==='POST')).toHaveLength(0);
});
it('shared composer retains Desktop file drop/paste callbacks and narrow layout can collapse the list',async()=>{
 const drop=vi.fn(),paste=vi.fn();const f=render(<AgentComposer value="" onChange={()=>{}} onSend={()=>{}} placeholder="fixture" formEvents={{onDrop:drop,onPaste:paste}}/>);const form=f.container.querySelector('form')!;fireEvent.drop(form);fireEvent.paste(form);expect(drop).toHaveBeenCalledOnce();expect(paste).toHaveBeenCalledOnce();f.unmount();
 setup();await ready();fireEvent.click(screen.getByRole('button',{name:'收起会话列表'}));expect(screen.queryByRole('button',{name:'会话 A'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'展开会话列表'}));expect(screen.getByRole('button',{name:'会话 A'})).toBeTruthy();
});

it('pending reconciliation remains available when the model is not configured',async()=>{
 localStorage.setItem('server-superagent-pending:chat-a',JSON.stringify({requestId:'original',text:'原请求'}));const fetch=setup({configured:false});await waitFor(()=>expect((screen.getByRole('button',{name:'核对原消息'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'核对原消息'}));await waitFor(()=>expect(fetch.mock.calls.filter(c=>c[1]?.method==='POST')).toHaveLength(1));expect(JSON.parse(String(fetch.mock.calls.find(c=>c[1]?.method==='POST')![1]?.body)).requestId).toBe('original');
});
it('malformed pending state is shown without posting a replacement request',async()=>{
 localStorage.setItem('server-superagent-pending:chat-a','{broken');const fetch=setup();await screen.findByText(/无法读取原消息标识/);expect(fetch.mock.calls.filter(c=>c[1]?.method==='POST')).toHaveLength(0);expect(localStorage.getItem('server-superagent-pending:chat-a')).toBe('{broken');
});
it('polling is stopped when the shared chat page unmounts',async()=>{
 const fetch=setup();await ready();cleanup();const count=fetch.mock.calls.length;await new Promise(r=>setTimeout(r,1550));expect(fetch.mock.calls.length).toBe(count);
});
it('keeps user message bytes intact for memory provenance instead of trimming the sent text',async()=>{const fetch=setup();await ready();const original='  用户原话\n  第二行\n';fireEvent.change(screen.getByLabelText('给 Superagent 的消息'),{target:{value:original}});fireEvent.click(screen.getByRole('button',{name:'发送'}));await waitFor(()=>expect(fetch.mock.calls.filter(c=>c[1]?.method==='POST')).toHaveLength(1));expect(JSON.parse(String(fetch.mock.calls.find(c=>c[1]?.method==='POST')![1]?.body)).text).toBe(original);});
it('shows native retry state and stops only the current assistant',async()=>{
 const row={id:'retry-row',text:'查询原任务',status:'running',gmt_create:'2026-11-10 01:00:00',result:{progress:{event:'llm/retry',attempt:1,maxRetries:5,code:'TIMEOUT'}}};
 const fetch=setup({conversations:{'chat-a':{...a,messages:[row]},'chat-b':b}});await screen.findByText(/正在等待第 1\/5 次重试/);fireEvent.click(screen.getByRole('button',{name:'停止助手'}));await waitFor(()=>expect(fetch.mock.calls.some(([url,init])=>url==='/superagent/conversations/chat-a/cancel'&&init?.method==='POST')).toBe(true));expect(fetch.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
});
it('a memory source link selects and highlights the original message without resubmitting',async()=>{
 location.hash='#/superagent?conversation=chat-b&message=original-message';const scroll=vi.fn();Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{value:scroll,configurable:true});
 const row={id:'original-message',text:'原始纠正消息',status:'succeeded',gmt_create:'2026-11-11 01:02:03'};const fetch=setup({conversations:{'chat-a':a,'chat-b':{...b,messages:[row]}}});await screen.findByText('原始纠正消息');expect(document.getElementById('server-message-original-message')?.style.outline).toContain('2px');expect(scroll).toHaveBeenCalled();expect(fetch.mock.calls.every(c=>c[1]?.method!=='POST')).toBe(true);
});


it('refreshes running icons for nonselected and externally created conversations, clears them at terminal without losing selection or draft',async()=>{
 const items:any[]=[{...a},{...b,executionStatus:'queued'}];const fetch=setup({items});await ready();
 expect(within(screen.getByRole('button',{name:/会话 B/})).getByRole('img',{name:'等待处理'})).toBeTruthy();
 fireEvent.change(screen.getByLabelText('给 Superagent 的消息'),{target:{value:'保留的草稿'}});
 items[1]={...b,executionStatus:'running'};items.push({id:'external',title:'入口转发对话',executionStatus:'waiting'});
 await waitFor(()=>expect(within(screen.getByRole('button',{name:/会话 B/})).getByRole('img',{name:'正在执行'})).toBeTruthy(),{timeout:2500});
 expect(within(screen.getByRole('button',{name:/入口转发对话/})).getByRole('img',{name:'等待任务结果'})).toBeTruthy();
 expect(screen.getByRole('button',{name:'会话 A'}).getAttribute('aria-current')).toBe('page');
 expect((screen.getByLabelText('给 Superagent 的消息') as HTMLTextAreaElement).value).toBe('保留的草稿');
 items[1]={...b,executionStatus:null};items[2].executionStatus=null;
 await waitFor(()=>expect(screen.queryByRole('img',{name:'正在执行'})).toBeNull(),{timeout:2500});
 expect(screen.queryByRole('img',{name:'等待任务结果'})).toBeNull();
 expect(fetch.mock.calls.every(([,init])=>init?.method!=='POST')).toBe(true);
});
it('shared session list leaves terminal and legacy Desktop items without a false running indicator',async()=>{
 setup({items:[a,{...b,executionStatus:'failed'}]});await ready();expect(within(screen.getByLabelText('会话列表')).queryByRole('img')).toBeNull();
});
