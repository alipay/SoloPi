import {expect,it,vi} from 'vitest';
import {taskListLoadTiming} from '../src/api/task-list-timing';

it('includes catalog, all Client pages and the independent Server list in total data readiness',()=>{
 let now=0;const emit=vi.fn(),timing=taskListLoadTiming({startedAt:0,hasCache:false,now:()=>now,emit});
 // A single request finishing at 1.84 seconds is not list completion.
 now=1840;expect(emit).not.toHaveBeenCalled();
 now=12000;timing.settle('native',250,'succeeded');
 expect(emit).toHaveBeenCalledExactlyOnceWith('task_list.cold.first_data','succeeded',12000);
 now=18000;timing.settle('server',2,'succeeded');
 expect(emit).toHaveBeenLastCalledWith('task_list.cold.complete','succeeded',18000);
 timing.cancel();expect(emit).toHaveBeenCalledTimes(2);
});
it('keeps cached opening separate from a cold load and does not emit zero-length success',()=>{
 let now=2;const emit=vi.fn(),timing=taskListLoadTiming({startedAt:2,hasCache:true,now:()=>now,emit});
 expect(emit).not.toHaveBeenCalled();now=5002;timing.settle('server',2,'succeeded');expect(emit).not.toHaveBeenCalled();
 now=20002;timing.settle('native',20,'succeeded');
 expect(emit).toHaveBeenLastCalledWith('task_list.warm.complete','succeeded',20000);
 expect(emit.mock.calls.every(c=>!c[0].includes('cold'))).toBe(true);
});
it('preserves long abandoned waits and partial failures instead of marking success',()=>{
 let now=0;const emit=vi.fn(),timing=taskListLoadTiming({startedAt:0,hasCache:false,now:()=>now,emit});
 timing.settle('server',0,'succeeded');now=45000;timing.cancel();
 expect(emit).toHaveBeenCalledExactlyOnceWith('task_list.cold.complete','cancelled',45000);
 timing.settle('native',0,'succeeded');expect(emit).toHaveBeenCalledTimes(1);
 const failed=taskListLoadTiming({startedAt:0,hasCache:false,now:()=>now,emit});failed.settle('server',0,'succeeded');failed.settle('native',2,'failed');
 expect(emit).toHaveBeenLastCalledWith('task_list.cold.complete','failed',45000);
});
