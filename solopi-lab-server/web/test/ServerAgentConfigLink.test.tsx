import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ServerAgent} from '../src/pages/ServerAgent';
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
it('Superagent opens the central runtime configuration page and does not maintain a second settings form',async()=>{vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>url.endsWith('/conversations')?{items:[]}:{configured:true,model:'fixture'}})));render(<ServerAgent/>);expect(screen.getByRole('link',{name:'运行时与模型配置'}).getAttribute('href')).toBe('#/settings/runtime');expect(screen.queryByRole('tablist',{name:'模型配置方式'})).toBeNull();expect(screen.queryByLabelText('API Key')).toBeNull();await screen.findByText(/fixture/)});
