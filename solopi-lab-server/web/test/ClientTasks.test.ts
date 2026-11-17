import {it,expect,vi,afterEach} from 'vitest';
import {listClientTasks,nativeTaskLink} from '../src/api/client-tasks';
import {readDesktop} from '../src/api/client-task-read';
vi.mock('../src/api/client-task-read',()=>({readDesktop:vi.fn()}));
afterEach(()=>vi.resetAllMocks());
it('lists every origin across native pages, preserving Client identity and deduplicating the ledger',async()=>{
 vi.mocked(readDesktop).mockResolvedValueOnce({tasks:[{id:'cli-1',source:'cli'},{id:'desktop-1',source:'ui'}],nextOffset:2}).mockResolvedValueOnce({tasks:[{id:'agent-1',source:'agent'},{id:'web-1',source:'manual'},{id:'cli-1'}],nextOffset:null});
 const rows=await listClientTasks({clientId:'client-a',hostname:'Lab A'},new AbortController().signal);
 expect(rows.map(r=>r.id)).toEqual(['cli-1','desktop-1','agent-1','web-1']);expect(rows.every(r=>r.clientId==='client-a')).toBe(true);expect(vi.mocked(readDesktop).mock.calls.map(c=>c[2])).toEqual([{offset:0,limit:50},{offset:2,limit:50}]);
 expect(nativeTaskLink('client-a','cli-1')).toContain('taskId=cli-1');
});
it('rejects stalled pagination instead of silently presenting a partial ledger',async()=>{
 vi.mocked(readDesktop).mockResolvedValue({tasks:[],nextOffset:0});await expect(listClientTasks({clientId:'a',hostname:'A'},new AbortController().signal)).rejects.toThrow('分页未推进');
});
