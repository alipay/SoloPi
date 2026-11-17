import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {serverTurn,type ServerRow} from '../src/pages/server-turn';
import AgentTurn from '@desktop-ui/AgentTurn';
const base:ServerRow={id:'original',text:'安装这两个包',status:'running',gmt_create:'2026-11-13 07:30:23'};
it('retains returned text after many later reasoning and tool records',()=>{
 const turn=serverTurn({...base,tools:Array.from({length:65},(_,i)=>({id:'many-'+i,name:'read-'+i,status:'done',gmt_create:'2026-11-13 07:30:25'})),result:{process:[{role:'assistant',content:'先核对需求和方案',createdAt:'2026-11-13T07:30:24Z'},...Array.from({length:35},(_,i)=>({role:'assistant',reasoning_content:'returned reasoning '+i,createdAt:'2026-11-13T07:31:00Z'}))]}});
 render(<AgentTurn sessionId="chat" turn={turn} labels={{}} reasoningRevision={0}/>);
 expect(screen.getByText('先核对需求和方案')).toBeTruthy();expect(screen.queryByText('read-0')).toBeNull();
});
it('opens the latest reasoning in its own turn even when a caller supplies a copied message',()=>{
 const row={...base,result:{process:[{role:'assistant',reasoning_content:'latest returned reasoning'}]}};
 render(<AgentTurn sessionId="chat" turn={serverTurn(row)} labels={{}} reasoningRevision={0} latestReasoning={serverTurn(row).messages.at(-1)}/>);
 expect(screen.getByText('latest returned reasoning').closest('details')!.open).toBe(true);
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('shows in-flight native calls before a final result exists and retains real identifiers',()=>{
 const turn=serverTurn({...base,tools:[{id:'persisted-call',model_call_id:'native-call',name:'install_client_apk',status:'running',gmt_create:'2026-11-13 07:30:25'}]});
 expect(turn.active).toBe(true);expect(turn.calls[0]).toMatchObject({id:'persisted-call',modelCallId:'native-call',detailsAvailable:true,status:'running'});
 render(<AgentTurn sessionId="chat" turn={turn} labels={{}} reasoningRevision={0}/>);expect(screen.getByText('install_client_apk')).toBeTruthy();expect(screen.getByText('执行中')).toBeTruthy();
});
it('renders process text and actual model reasoning together with live stream deltas',()=>{
 const turn=serverTurn({...base,result:{process:[{role:'assistant',content:'先核对目标设备',reasoning_content:'模型已返回的摘要',createdAt:'2026-11-13T07:30:24Z'}],streaming:{content:'安装进行中',reasoning:'新的模型摘要',createdAt:'2026-11-13T07:30:26Z'}}});
 render(<AgentTurn sessionId="chat" turn={turn} labels={{}} reasoningRevision={0}/>);
 expect(screen.getByText('先核对目标设备')).toBeTruthy();expect(screen.getByText('安装进行中')).toBeTruthy();expect(screen.getByText('模型已返回的摘要')).toBeTruthy();expect(screen.getByText('新的模型摘要')).toBeTruthy();
});
it('does not invent reasoning or duplicate a final answer after completion/reload',()=>{
 const turn=serverTurn({...base,status:'succeeded',result:{process:[{role:'assistant',content:'安装完成'}],text:'安装完成'}});
 expect(turn.messages).toHaveLength(1);expect(turn.final?.content).toBe('安装完成');
 render(<AgentTurn sessionId="chat" turn={turn} labels={{}} reasoningRevision={0}/>);expect(screen.getAllByText('安装完成')).toHaveLength(1);expect(screen.queryByText('模型返回的推理内容')).toBeNull();
});
it.each(['failed','interrupted'])('preserves completed steps and tool failures after %s',status=>{
 const turn=serverTurn({...base,status,tools:[{id:'call',name:'install_client_apk',status:'failed'}],result:{process:[{role:'assistant',content:'正在安装',createdAt:'2026-11-13T07:30:24Z'}],streaming:{content:'stale'}}});
 expect(turn.calls[0].status).toBe('failed');expect(turn.messages.some(m=>m.content==='正在安装')).toBe(true);expect(turn.messages.some(m=>m.content==='stale')).toBe(false);
});
it('loads real Server call details with the shared Desktop disclosure without IPC',async()=>{
 const load=vi.fn(async id=>({id,name:'install_client_apk',status:'done',args:{serial:'phone'},result:{success:true,versionName:'2'}}));
 const turn=serverTurn({...base,tools:[{id:'original-call-id',name:'install_client_apk',status:'done'}]});
 render(<AgentTurn sessionId="chat" turn={turn} labels={{}} reasoningRevision={0} loadCallDetails={load}/>);
 const details=screen.getByText('install_client_apk').closest('details')!;details.open=true;fireEvent(details,new Event('toggle'));
 await waitFor(()=>expect(screen.getByText(/"versionName": "2"/)).toBeTruthy());expect(load).toHaveBeenCalledWith('original-call-id');
});
it('keeps long histories navigable and reuses original calls rather than terminal summaries',()=>{
 const tools=Array.from({length:65},(_,i)=>({id:'call-'+i,name:'tool-'+i,status:'done',gmt_create:'2026-11-13 07:30:25'}));
 const turn=serverTurn({...base,tools,result:{tools:[{name:'fake-summary',status:'done'}]}});expect(turn.calls).toHaveLength(65);
 render(<AgentTurn sessionId="chat" turn={turn} labels={{}} reasoningRevision={0}/>);expect(screen.getByText('tool-64')).toBeTruthy();expect(screen.queryByText('tool-0')).toBeNull();fireEvent.click(screen.getByText('加载更早的执行步骤'));fireEvent.click(screen.getByText('加载更早的执行步骤'));expect(screen.getByText('tool-0')).toBeTruthy();
});
it('supports older saved terminal tool summaries',()=>{
 const turn=serverTurn({...base,status:'succeeded',result:{tools:[{name:'old-tool',status:'done'}],text:'完成'}});
 expect(turn.calls[0]).toMatchObject({name:'old-tool',status:'done',detailsAvailable:false});expect(turn.final?.content).toBe('完成');
});
