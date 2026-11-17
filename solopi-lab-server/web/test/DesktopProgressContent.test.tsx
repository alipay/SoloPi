import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
// Import the real Desktop source, independently of Server's row projection.
import AgentTurn from '../../../solopi-desktop/src/components/AgentTurn';
import {agentTurns,type AgentMessage} from '../../../solopi-desktop/src/components/agent-turns';
afterEach(cleanup);
const progress='正在核对已有日志，随后整理失败项';
const messages:AgentMessage[]=[{role:'user',content:'核对已有报告'},
 {role:'assistant',content:progress,reasoning_content:'fixture reasoning',tool_calls:[{id:'read'}]},
 {role:'tool',content:'fixture receipt'}];
const calls=[{id:'ledger-read',modelCallId:'read',name:'read_fixture',status:'done',args:{},result:{success:true}}];
it('Desktop shows normal progress beside reasoning and its tool call while running',()=>{
 render(<AgentTurn sessionId="desktop" turn={agentTurns(messages,calls,'running')[0]} labels={{}} reasoningRevision={0}/>);
 expect(screen.getByText(progress)).toBeTruthy();expect(screen.getByText('read_fixture')).toBeTruthy();
 expect(screen.getByText('fixture reasoning')).toBeTruthy();
});
it('Desktop retains latest progress after more than thirty tool-only records',()=>{
 const tail=Array.from({length:40},(_,i)=>({role:'assistant',tool_calls:[{id:'tail-'+i}]}));
 const ledger=tail.map((_,i)=>({id:'tail-'+i,modelCallId:'tail-'+i,name:'fixture-'+i,status:'done',args:{}}));
 render(<AgentTurn sessionId="desktop" turn={agentTurns([...messages,...tail],[...calls,...ledger],'running')[0]} labels={{}} reasoningRevision={0}/>);
 expect(screen.getByText(progress)).toBeTruthy();expect(screen.getByText('fixture-39')).toBeTruthy();
});
it('Desktop completion and reloading keep prior progress, tool details and one final answer',()=>{
 const saved=JSON.parse(JSON.stringify([...messages,{role:'assistant',content:'已完成日志核对'}]));
 for(let reload=0;reload<2;reload++){
  render(<AgentTurn sessionId="desktop" turn={agentTurns(saved,calls,'idle')[0]} labels={{}} reasoningRevision={0}/>);
  expect(screen.getAllByText('已完成日志核对')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{expanded:false}));
  expect(screen.getByText(progress)).toBeTruthy();expect(screen.getByText('read_fixture')).toBeTruthy();
  cleanup();
 }
});
