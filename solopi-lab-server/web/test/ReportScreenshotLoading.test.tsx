import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import ReportScreenshot from '../../../solopi-desktop/src/components/ReportScreenshot';
afterEach(cleanup);
it('keeps the screenshot loading indicator until the browser decodes the image',()=>{
 let complete!:(v:string)=>void;
 const store={subscribe:vi.fn((_p:any,_r:any,listener:any)=>{complete=listener;return()=>{}}),imageFailed:vi.fn()} as any;
 render(<ReportScreenshot path="/owned.png" index={0} store={store} invoke={vi.fn()}/>);
 expect(screen.getByRole('status').textContent).toContain('正在加载截图');
 act(()=>complete('data:image/png;base64,AA=='));expect(screen.getByRole('status')).toBeTruthy();
 fireEvent.load(screen.getByAltText('截图 1'));expect(screen.queryByRole('status')).toBeNull();
 fireEvent.error(screen.getByAltText('截图 1'));expect(screen.getByText(/预览暂不可用/)).toBeTruthy();
});
