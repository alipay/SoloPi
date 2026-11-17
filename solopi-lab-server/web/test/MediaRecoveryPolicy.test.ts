import {it,expect} from 'vitest';
import {recoverableMediaClose} from '../src/api/media-recovery';
it('recovers only transport loss or a confirmed expired/client-lost subscription',()=>{
 for(const code of [1006,1012,1013])expect(recoverableMediaClose(code,null)).toBe(true);
 expect(recoverableMediaClose(4409,'expired')).toBe(true);
 expect(recoverableMediaClose(4404,'client-closed')).toBe(true);
 for(const reason of ['admin-stop','viewer-closed','status-unavailable',null])expect(recoverableMediaClose(4409,reason)).toBe(false);
 for(const code of [1000,4401,4402,4408,4500])expect(recoverableMediaClose(code,'expired')).toBe(false);
});
