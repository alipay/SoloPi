import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import AgentPage from '../../../solopi-desktop/src/components/AgentPage';
afterEach(()=>{cleanup();delete (window as any).glassbox;vi.restoreAllMocks();vi.unstubAllGlobals();});
it('Desktop keeps the upstream request settings entry and saves its policy through IPC',async()=>{
 vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});
 const session={id:'fixture-session',title:'Fixture session',status:'idle',messages:[],calls:[]};
 const policy={stream:true,conversationReasoning:'inherit',summaryReasoning:'inherit',summaryMaxTokens:1024,inputBudgetTokens:20000,firstResponseSeconds:30,idleSeconds:60,totalSeconds:180,minIntervalMs:0};
 const invoke=vi.fn(async(name:string,args:any)=>{
  if(name==='agent:list')return {sessions:[session]};if(name==='agent:get'||name==='agent:create')return {session};if(name==='agent:models')return {models:[],selectedModelId:''};
  if(name==='agent:request-policy')return {policy};if(name==='agent:save-request-policy')return {success:true,policy:args.policy};
  if(name==='agent:comparison')return {report:null};return {success:true,items:[],targets:[]};
 });
 (window as any).glassbox={ipcRenderer:{invoke,on:vi.fn(),removeListener:vi.fn()}};
 render(<AgentPage onNavigate={()=>{}} onOpenSettings={()=>{}} deviceControls={null} initialSessionId="fixture-session" onSessionChange={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'模型请求与流式对照'}));
 const stream=await screen.findByRole('checkbox',{name:/流式输出/});fireEvent.click(stream);
 fireEvent.click(screen.getByRole('button',{name:/保存设置/}));
 await waitFor(()=>expect(invoke).toHaveBeenCalledWith('agent:save-request-policy',expect.objectContaining({policy:expect.objectContaining({stream:false})})));
});
