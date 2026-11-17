import {beforeEach,it,expect,vi} from 'vitest';
import {readSubmissionFailure} from '../src/api/submission-failure';
const api=vi.hoisted(()=>({lab:vi.fn()}));vi.mock('../src/api/lab',()=>({lab:api.lab}));
beforeEach(()=>api.lab.mockReset());
const task=()=>({taskId:'task',clientId:'client',status:'failed',cases:[],report:{validation:{success:false,phase:'validation',validationErrors:[{code:'CASE_EDGE_CYCLE'}]}}});
it('requires the original submission identity and explicit validation failure',async()=>{api.lab.mockResolvedValue(task());expect(await readSubmissionFailure('client','task',new AbortController().signal)).toMatchObject({taskId:'task'});for(const patch of [{status:'running'},{report:{error:'missing native report'}},{report:{validation:{success:false,phase:'execution',validationErrors:[{}]}}}]){api.lab.mockResolvedValue({...task(),...patch});expect(await readSubmissionFailure('client','task',new AbortController().signal)).toBeNull();}});
it('foreign Client or task receipts never become a displayed rejection',async()=>{for(const patch of [{clientId:'foreign'},{taskId:'foreign'}]){api.lab.mockResolvedValue({...task(),...patch});await expect(readSubmissionFailure('client','task',new AbortController().signal)).rejects.toThrow('任务标识不匹配');}});
