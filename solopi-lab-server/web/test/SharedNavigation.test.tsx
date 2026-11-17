import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {LabSidebar} from '../src/components/LabSidebar';
import {pageForHash,pageHref} from '../src/navigation';
afterEach(cleanup);
it('Web retains its navigation and original Client brand without replacing the Desktop Sidebar',()=>{
 const b=render(<LabSidebar page="tasks" collapsed={false} onToggle={()=>{}}/>);expect(b.container.querySelector('.sp-sidebar')).toBeTruthy();expect(screen.getByAltText('SoloPi').getAttribute('src')).toContain('solopi-desktop-logo');expect(screen.getByRole('link',{name:'测试任务'}).getAttribute('aria-current')).toBe('page');
});
it('Agent and management tools have visible secondary navigation and stable deep links',()=>{
 render(<LabSidebar page="memory" collapsed={false} onToggle={()=>{}}/>);
 const children=screen.getByLabelText('Agent 工作台二级导航');expect(within(children).getByRole('link',{name:'上下文记忆'}).getAttribute('aria-current')).toBe('page');expect(within(children).getByRole('link',{name:'Agent 会话'}).getAttribute('href')).toBe('#/agents/chat');expect(screen.queryByRole('link',{name:'注册记录'})).toBeNull();expect(screen.getByRole('link',{name:'接入与安装包'}).getAttribute('href')).toBe('#/settings/guide');expect(screen.getByRole('link',{name:'运行时与模型'}).getAttribute('href')).toBe('#/settings/runtime');
});
it('collapsed menus support arrows, Escape and focus restoration in the shared renderer',()=>{
 render(<LabSidebar page="agentchat" collapsed onToggle={()=>{}}/>);const trigger=screen.getByRole('button',{name:'Agent 工作台'});fireEvent.keyDown(trigger,{key:'ArrowDown'});const menu=screen.getByRole('menu',{name:'Agent 工作台二级菜单'});const entries=within(menu).getAllByRole('menuitem');expect(document.activeElement).toBe(entries[0]);fireEvent.keyDown(entries[0],{key:'ArrowDown'});expect(document.activeElement).toBe(entries[1]);fireEvent.keyDown(entries[1],{key:'Escape'});expect(screen.queryByRole('menu')).toBeNull();expect(document.activeElement).toBe(trigger);
});
it('Web collapse control preserves its host callback',()=>{
 const toggle=vi.fn();render(<LabSidebar page="tasks" collapsed onToggle={toggle}/>);fireEvent.click(screen.getByRole('button',{name:'展开左侧导航'}));expect(toggle).toHaveBeenCalledOnce();
});
it('a pointer outside closes the menu without navigating or trapping focus',()=>{
 render(<LabSidebar page="memory" collapsed onToggle={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'管理与帮助'}));expect(screen.getByRole('menu')).toBeTruthy();fireEvent.pointerDown(document.body);expect(screen.queryByRole('menu')).toBeNull();
});
it('canonical and old URLs keep all destinations including report/request identities',()=>{
 for(const [hash,page]of Object.entries({'#/agents':'superagent','#/agents/chat':'agentchat','#/agents/memory':'memory','#/agents/quality':'case-quality','#/memory':'memory','#/superagent':'superagent','#/agentchat':'agentchat','#/case-quality':'case-quality','#/settings/guide':'guide','#/settings/records':'guide','#/records':'guide','#/settings/runtime':'runtime','#/guide':'guide','#/clients':'devices','#/workspace':'devices','#/levels':'devices','#/devices/screens':'devices','#/native-report?clientId=c&taskId=t&caseId=a':'tasks','#/execution/t':'tasks','#/request/r':'tasks','#/agent-request/r':'agentchat'}))expect(pageForHash(hash)).toBe(page);
 expect(pageHref('devices')).toBe('#/devices/groups');expect(pageForHash('#/unknown')).toBe('overview');
});
