import {useEffect,useRef,useState,type ReactNode} from 'react';
import {ChevronRight,PanelLeftClose,PanelLeftOpen,type LucideIcon} from 'lucide-react';
import logo from '../../assets/solopi-desktop-logo.png';
import './navigation-sidebar.css';
export {Monitor,ClipboardList,PanelsTopLeft,Bot,MessagesSquare,Brain,FileCheck2,Settings,History,BookOpen,Users} from 'lucide-react';

export interface NavigationItem {
 id:string;label:string;icon:LucideIcon;href?:string;children?:NavigationItem[];
}
export interface NavigationSidebarProps {
 items:NavigationItem[];footerItems?:NavigationItem[];activeId:string;
 onSelect?:(id:string)=>void;collapsed?:boolean;onToggleCollapsed?:()=>void;
 description?:string;footer?:ReactNode;
}
// Both hosts own only route/callback configuration. Rendering, brand, icons,
// hierarchy, focus and collapsed-menu behavior are maintained here.
export function NavigationSidebar({items,footerItems=[],activeId,onSelect,collapsed=false,onToggleCollapsed,description='Smart Device Test Harness',footer}:NavigationSidebarProps){
 const root=useRef<HTMLElement>(null),triggers=useRef(new Map<string,HTMLElement>());
 const [open,setOpen]=useState<string|null>(null);
 useEffect(()=>{if(!collapsed)setOpen(null);},[collapsed]);
 useEffect(()=>{
  if(!open)return;
  root.current?.querySelector<HTMLElement>('[role=menu] [role=menuitem]')?.focus();
  const close=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(null);};
  const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(null);triggers.current.get(open)?.focus();}};
  document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape);};
 },[open]);
 const select=(id:string)=>{onSelect?.(id);setOpen(null);};
 function link(item:NavigationItem,child=false,popup=false){
  const active=activeId===item.id;
  const props={className:`sp-nav-link${active?' is-active':''}${child?' is-child':''}`,title:collapsed?item.label:undefined,'aria-current':active?'page' as const:undefined,'data-onboarding-target':`nav-${item.id}`,onClick:()=>select(item.id)};
  const body=<><item.icon aria-hidden="true" className="sp-nav-icon"/>{(!collapsed||child)&&<span>{item.label}</span>}{active&&!child&&!collapsed&&<ChevronRight aria-hidden="true" className="sp-nav-chevron"/>}</>;
  return item.href?<a key={item.id} {...props} href={item.href} role={popup?'menuitem':undefined}>{body}</a>:<button key={item.id} type="button" {...props} role={popup?'menuitem':undefined}>{body}</button>;
 }
 function group(item:NavigationItem){
  if(!item.children?.length)return link(item);
  const active=activeId===item.id||item.children.some(child=>child.id===activeId);
  return <div className="sp-nav-group" key={item.id}>
   {collapsed?<button ref={e=>{if(e)triggers.current.set(item.id,e);}} type="button" className={`sp-nav-link${active?' is-active':''}`} title={item.label} aria-label={item.label} aria-haspopup="menu" aria-expanded={open===item.id} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setOpen(item.id);}}} onClick={()=>setOpen(current=>current===item.id?null:item.id)}><item.icon className="sp-nav-icon" aria-hidden="true"/><ChevronRight className="sp-nav-group-cue" aria-hidden="true"/></button>:link({...item,id:item.id,children:undefined,href:item.href||item.children[0].href})}
   {!collapsed&&<div className="sp-nav-children" aria-label={`${item.label}二级导航`}>{item.children.map(child=>link(child,true))}</div>}
   {collapsed&&open===item.id&&<div className="sp-nav-flyout" onKeyDown={e=>{const nodes=Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role=menuitem]')),index=nodes.indexOf(document.activeElement as HTMLElement);if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?nodes.length-1:(index+(e.key==='ArrowDown'?1:-1)+nodes.length)%nodes.length;nodes[next]?.focus();}if(e.key===' '){e.preventDefault();(document.activeElement as HTMLElement)?.click();}}} role="menu" aria-label={`${item.label}二级菜单`}><div className="sp-nav-flyout-title">{item.label}</div>{item.children.map(child=>link(child,true,true))}</div>}
  </div>;
 }
 return <aside ref={root} className={`sp-sidebar${collapsed?' is-collapsed':''}`} aria-label="主导航">
  {onToggleCollapsed&&<button className="sp-nav-toggle" onClick={onToggleCollapsed} type="button" aria-label={collapsed?'展开左侧导航':'收起左侧导航'} title={collapsed?'展开左侧导航':'收起左侧导航'}>{collapsed?<PanelLeftOpen aria-hidden="true"/>:<PanelLeftClose aria-hidden="true"/>}</button>}
  <div className="sp-brand"><img src={logo} alt="SoloPi" draggable={false}/>{!collapsed&&<div><strong>SoloPi</strong><span>{description}</span></div>}</div>
  <nav className="sp-nav-main" aria-label="工作区导航">{items.map(group)}</nav>
  <div className="sp-nav-footer"><nav aria-label="管理导航">{footerItems.map(group)}</nav>{!collapsed&&footer&&<div className="sp-nav-identity">{footer}</div>}</div>
 </aside>;
}
