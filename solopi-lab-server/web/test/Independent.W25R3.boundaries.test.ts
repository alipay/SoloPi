import {it,expect,vi,afterEach} from 'vitest';
import {fetchAgentTasksPage} from '../src/api/agent-tasks-ro';
const row={agentTaskId:'01M6RJ5BAJ60DEKV5KBJAGQP1S',clientId:'01M6JVA2KF08T0VZ0ZZABRAQFJ',kind:'tool-call',toolName:'list_devices',status:'succeeded',hasProgress:false,timeoutSec:120,createdAt:'2026-11-06T14:00:00Z',expiresAt:'2026-11-06T14:10:00Z',deliveredAt:null,startedAt:null,cancelRequestedAt:null,endedAt:null};
afterEach(()=>vi.unstubAllGlobals());
function invoke(p:unknown){vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(p),{status:200,headers:{'content-type':'application/json'}})));return fetchAgentTasksPage({},new AbortController().signal)}
it('P1 missing required nextPage is rejected',async()=>{await expect(invoke({items:[],page:1,pageSize:50})).rejects.toThrow()});
it('P2 invalid pagination page/size rejected',async()=>{await expect(invoke({items:[],page:0,pageSize:-1,nextPage:null})).rejects.toThrow()});
it('P3 invalid ULID high first char rejected',async()=>{await expect(invoke({items:[{...row,agentTaskId:'Z1M6RJ5BAJ60DEKV5KBJAGQP1S'}],page:1,pageSize:50,nextPage:null})).rejects.toThrow()});
it('P4 invalid timestamps and negative timeout rejected',async()=>{await expect(invoke({items:[{...row,createdAt:'not-a-date-at-all',timeoutSec:-5}],page:1,pageSize:50,nextPage:null})).rejects.toThrow()});
