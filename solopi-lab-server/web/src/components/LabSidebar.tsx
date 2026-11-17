import {NavigationSidebar,Monitor,ClipboardList,PanelsTopLeft,Bot,MessagesSquare,Brain,FileCheck2,Settings,BookOpen,type NavigationItem} from '@desktop-ui/navigation/NavigationSidebar';
import type {PageKey} from '../navigation';
const items:NavigationItem[]=[
 {id:'overview',label:'实验室总览',icon:Monitor,href:'#/overview'},
 {id:'tasks',label:'测试任务',icon:ClipboardList,href:'#/tasks'},
 {id:'devices',label:'设备管理',icon:PanelsTopLeft,href:'#/devices/groups'},
 {id:'agents',label:'Agent 工作台',icon:Bot,href:'#/agents',children:[
  {id:'superagent',label:'Superagent',icon:Bot,href:'#/agents'},
  {id:'agentchat',label:'Agent 会话',icon:MessagesSquare,href:'#/agents/chat'},
  {id:'memory',label:'上下文记忆',icon:Brain,href:'#/agents/memory'},
  {id:'case-quality',label:'用例质量',icon:FileCheck2,href:'#/agents/quality'}]}];
const footer:NavigationItem[]=[{id:'management',label:'管理与帮助',icon:Settings,href:'#/settings',children:[
 {id:'guide',label:'接入与安装包',icon:BookOpen,href:'#/settings/guide'},
 {id:'runtime',label:'运行时与模型',icon:Bot,href:'#/settings/runtime'}]}];
export function LabSidebar({page,collapsed,onToggle}:{page:PageKey;collapsed:boolean;onToggle:()=>void}){return <NavigationSidebar items={items} footerItems={footer} activeId={page} collapsed={collapsed} onToggleCollapsed={onToggle} description="设备实验室" footer={<><b>solopi-lab</b><span>电脑 · 设备组 · 设备</span></>}/>;}
