import {expect,it,vi,afterEach} from 'vitest';
import {mediaObservation} from '../src/api/media-observation';
import {recordMediaDiagnostic} from '../src/api/media-diagnostics';
afterEach(()=>vi.unstubAllGlobals());
it('correlates intent, authorization, socket and actual presentation; deduplicates repeated frames',()=>{
 let now=0;const emit=vi.fn(),o=mediaObservation('c','initial',{now:()=>now,emit,attemptId:'a'});
 now=100;o.authorized();now=300;o.connected();now=2000;o.rendered();o.rendered();now=5000;o.end('user-stop');o.end('page-exit');
 expect(emit.mock.calls).toEqual([['attempt','initial',0,false],['authorized','ok',100,false],['connected','ok',300,false],['first-frame','rendered',2000,false],['ended','after-frame:user-stop',5000,false]]);
});
it('does not turn a cancelled attempt into failure or hide a late frame after the warning',()=>{
 let now=0;const emit=vi.fn(),o=mediaObservation('c','initial',{now:()=>now,emit});now=8000;o.timeout();now=10000;o.rendered();o.end('page-exit');
 expect(emit.mock.calls.filter(x=>x[0]==='first-frame')).toHaveLength(1);expect(emit.mock.calls.some(x=>x[0]==='failed')).toBe(false);
 const cancel=vi.fn(),other=mediaObservation('c','initial',{emit:cancel});other.end('user-stop');other.rendered();expect(cancel.mock.calls.map(x=>x[0])).toEqual(['attempt','cancelled','ended']);
});
it('records a failed connection separately from a post-frame outage and keeps original reason',()=>{
 const emit=vi.fn(),o=mediaObservation('c','recovery',{emit});o.fail('ws_1006');o.fail('ws_1006');o.reason('ws_1006_unknown');
 expect(emit.mock.calls.filter(x=>x[0]==='failed')).toHaveLength(1);
 const live=vi.fn(),v=mediaObservation('c','initial',{emit:live});v.rendered();v.fail('ws_4409');expect(live.mock.calls.some(x=>x[0]==='failed')).toBe(false);expect(live.mock.calls.some(x=>x[0]==='abnormal')).toBe(true);
});
it('keeps diagnostic navigation delivery small, bounded and free of stream credentials',()=>{
 const fetcher=vi.fn().mockResolvedValue({ok:true});vi.stubGlobal('fetch',fetcher);recordMediaDiagnostic('a','c','attempt','initial',0,true,'media.observation');
 const [url,opts]=fetcher.mock.calls[0];expect(url).toBe('/lab/diagnostics/events');expect(opts.keepalive).toBe(true);expect(opts.signal).toBeInstanceOf(AbortSignal);expect(JSON.parse(opts.body)).toMatchObject({requestId:'a',toolName:'media.observation',stage:'attempt'});expect(opts.body).not.toMatch(/ticket|wss:|password/);
});
