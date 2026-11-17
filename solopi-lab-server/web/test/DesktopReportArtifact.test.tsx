import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {DesktopReportArtifact} from '../src/components/DesktopReportArtifact';
const artifacts={logs:[{path:'/phone.log',deviceType:'phone'},{path:'/glasses.log',deviceType:'glasses'}],recordings:[{path:'/recording.mp4',success:true}],screenshots:[{path:'/screen.png',success:true}]};
let click:any;
beforeEach(()=>{vi.stubGlobal('URL',class extends URL{static createObjectURL=vi.fn(()=> 'blob:download');static revokeObjectURL=vi.fn()});click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('previews logs in a body-level modal, pages in both directions, downloads the whole selected log',async()=>{
 const log=vi.fn(async(a:any)=>({text:a.fromLine===1?'first page':'second page',nextLine:a.fromLine===1?81:null})),downloadLog=vi.fn(async()=>({url:'blob:log',mime:'application/gzip'})),close=vi.fn();
 render(<DesktopReportArtifact path="/glasses.log" caseId="case" artifacts={artifacts} reader={{log,artifact:vi.fn()} as any} downloadLog={downloadLog} onClose={close}/>);
 const dialog=screen.getByRole('dialog',{name:'执行产物查看'});expect(dialog.parentElement?.parentElement).toBe(document.body);expect(document.body.style.overflow).toBe('hidden');await screen.findByText('first page');
 fireEvent.click(screen.getByRole('button',{name:'下一页日志'}));await screen.findByText('second page');fireEvent.click(screen.getByRole('button',{name:'上一页日志'}));await screen.findByText('first page');
 fireEvent.click(screen.getByRole('button',{name:'下载产物'}));await waitFor(()=>expect(click).toHaveBeenCalledTimes(1));expect(downloadLog.mock.calls[0].slice(0,2)).toEqual(['glasses',0]);expect(click.mock.instances[0].download).toBe('glasses.log.gz');
 fireEvent.keyDown(dialog,{key:'Escape'});expect(close).toHaveBeenCalledTimes(1);
});
it('plays video inline and downloads the original even if playback fails',async()=>{
 const artifact=vi.fn(async(a:any)=>({url:a.original?'blob:original':'blob:playable',mime:'video/mp4'}));render(<DesktopReportArtifact path="/recording.mp4" caseId="case" artifacts={artifacts} reader={{artifact,log:vi.fn()} as any} onClose={vi.fn()}/>);
 await waitFor(()=>expect(document.querySelector('video')?.getAttribute('src')).toBe('blob:playable'));expect(document.querySelector('video')?.controls).toBe(true);expect(screen.getByText('正在加载视频…')).toBeTruthy();
 fireEvent.loadedData(document.querySelector('video')!);expect(screen.queryByText('正在加载视频…')).toBeNull();fireEvent.error(document.querySelector('video')!);await screen.findByText(/视频无法播放/);
 fireEvent.click(screen.getByRole('button',{name:'下载产物'}));await waitFor(()=>expect(click).toHaveBeenCalledTimes(1));expect(artifact.mock.calls.at(-1)![0]).toMatchObject({caseId:'case',kind:'recordings',index:0,original:true});
});
it('rejects paths not owned by the case and cancels a pending preview on close',async()=>{
 const artifact=vi.fn();const view=render(<DesktopReportArtifact path="/foreign" caseId="case" artifacts={artifacts} reader={{artifact,log:vi.fn()} as any} onClose={vi.fn()}/>);await screen.findByText('该文件不属于当前用例');expect(artifact).not.toHaveBeenCalled();view.unmount();expect(document.body.style.overflow).toBe('');
 let signal:AbortSignal|undefined;const read=vi.fn((_a:any,s:AbortSignal)=>{signal=s;return new Promise(()=>{})});const pending=render(<DesktopReportArtifact path="/screen.png" caseId="case" artifacts={artifacts} reader={{artifact:read,log:vi.fn()} as any} onClose={vi.fn()}/>);expect(screen.getByText('正在读取产物…')).toBeTruthy();pending.unmount();expect(signal?.aborted).toBe(true);
});
