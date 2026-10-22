import {
  MessageSquare,
  Settings,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Gauge,
  FileText,
  Zap,
  Globe2,
  ListChecks,
  ClipboardList,
  Blocks,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import glassBoxLogo from '../assets/solopi-desktop-logo.png';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const topNavItems = [
  { id: 'agent', label: 'Agent 对话', icon: MessageSquare },
];

const navItems = [
  { id: 'sites', label: '常用站点', icon: Globe2 },
];

const performanceItems = [
  { id: 'performance-task', label: '性能任务', icon: Gauge },
  { id: 'performance-reports', label: '性能报告', icon: FileText },
  { id: 'performance-bugreport', label: '耗电分析', icon: Gauge },
];

const automationItems = [
  { id: 'automation-cases', label: '用例库', icon: ListChecks },
  { id: 'automation-tasks', label: '测试任务', icon: ClipboardList },
  { id: 'automation-components', label: '测试组件管理', icon: Blocks },
];

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onAssistantOpen?: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export const Sidebar = ({ activeTab, setActiveTab, onAssistantOpen: _onAssistantOpen, collapsed = false, onToggleCollapsed }: SidebarProps) => {
  const isAutomationActive = activeTab.startsWith('automation');
  const isPerformanceActive = activeTab.startsWith('performance') || activeTab === 'logs';
  const sidebarRef = useRef<HTMLElement>(null);
  const [openCollapsedMenu, setOpenCollapsedMenu] = useState<'automation' | 'performance' | null>(null);

  useEffect(() => {
    if (!collapsed) {
      setOpenCollapsedMenu(null);
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!sidebarRef.current?.contains(event.target as Node)) {
        setOpenCollapsedMenu(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenCollapsedMenu(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [collapsed]);

  const selectCollapsedItem = (tab: string) => {
    setActiveTab(tab);
    setOpenCollapsedMenu(null);
  };

  return (
    <aside ref={sidebarRef} className={cn(
      "relative bg-slate-50 border-r border-slate-200 flex flex-col h-screen shrink-0 z-[70] transition-[width] duration-200",
      collapsed ? "w-[72px]" : "w-52"
    )}>
      {onToggleCollapsed && (
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="absolute -right-3 top-1/2 z-30 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-md transition-colors hover:border-blue-200 hover:text-blue-600"
          title={collapsed ? '展开左侧导航' : '收起左侧导航'}
          aria-label={collapsed ? '展开左侧导航' : '收起左侧导航'}
        >
          {collapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
        </button>
      )}
      <div className={cn("pt-10 pb-3", collapsed ? "px-2" : "px-3")}>
        <div className={cn("flex items-center", collapsed ? "justify-center" : "justify-between gap-2")}>
          <div className={cn("flex min-w-0 items-center", collapsed ? "justify-center" : "gap-2.5")}>
            <span className={cn(
              "flex shrink-0 items-center justify-center",
              "h-8 w-8",
            )}>
              <img
                src={glassBoxLogo}
                alt="SoloPi"
                draggable={false}
                className="h-full w-full select-none object-contain"
              />
            </span>
            {!collapsed && (
              <div className="flex min-w-0 flex-col">
                <h1 className="text-base leading-5 font-black tracking-tight text-slate-900">SoloPi</h1>
                <span className="text-[10px] leading-3.5 text-slate-500 font-semibold">Smart Device Test Harness</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <nav className={cn("flex-1 space-y-1.5", collapsed ? "px-2" : "px-3")}>
        {topNavItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            title={item.label}
            className={cn(
              "w-full flex items-center rounded-xl transition-all duration-200 group",
              collapsed ? "justify-center px-0 py-3" : "gap-3 px-4 py-3",
              activeTab === item.id 
                ? "bg-white text-blue-600 shadow-md ring-1 ring-slate-200 border-none" 
                : "text-slate-500 hover:bg-slate-200/50 hover:text-slate-900"
            )}
          >
            <item.icon className={cn(
              "w-4 h-4 transition-colors",
              activeTab === item.id ? "text-blue-600" : "text-slate-400 group-hover:text-slate-600"
            )} />
            {!collapsed && <span className="text-sm font-bold">{item.label}</span>}
            {!collapsed && activeTab === item.id && <ChevronRight className="w-3 h-3 ml-auto opacity-50" />}
          </button>
        ))}

        <div className="relative pt-1">
          <button
            onClick={() => {
              if (collapsed) {
                setOpenCollapsedMenu((current) => current === 'automation' ? null : 'automation');
                return;
              }
              setActiveTab('automation-cases');
            }}
            title="自动化"
            aria-haspopup={collapsed ? 'menu' : undefined}
            aria-expanded={collapsed ? openCollapsedMenu === 'automation' : undefined}
            className={cn(
              "relative w-full flex items-center rounded-xl transition-all duration-200 group",
              collapsed ? "justify-center px-0 py-3" : "gap-3 px-4 py-3",
              isAutomationActive
                ? "bg-white text-blue-600 shadow-md ring-1 ring-slate-200 border-none"
                : "text-slate-500 hover:bg-slate-200/50 hover:text-slate-900"
            )}
          >
            <Zap className={cn(
              "w-4 h-4 transition-colors",
              isAutomationActive ? "text-blue-600" : "text-slate-400 group-hover:text-slate-600"
            )} />
            {!collapsed && <span className="text-sm font-bold">自动化</span>}
            {!collapsed && isAutomationActive && <ChevronRight className="w-3 h-3 ml-auto opacity-50" />}
            {collapsed && <ChevronRight className="absolute bottom-1.5 right-1 h-2.5 w-2.5 text-slate-400" aria-hidden="true" />}
          </button>
          {!collapsed && <div className="mt-1 ml-5 space-y-1 border-l border-slate-200 pl-2">
            {automationItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={cn(
                  "w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
                  activeTab === item.id || (item.id === 'automation-cases' && activeTab === 'automation-flow')
                    ? "bg-blue-50 text-blue-600"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                )}
              >
                <item.icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate text-[12px] font-bold">{item.label}</span>
              </button>
            ))}
          </div>}
          {collapsed && openCollapsedMenu === 'automation' && (
            <div className="absolute left-full top-0 z-50 w-52 pl-2" role="menu" aria-label="自动化二级菜单">
              <div className="rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                <div className="px-2 pb-1.5 pt-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">自动化</div>
                {automationItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    onClick={() => selectCollapsedItem(item.id)}
                    className={cn(
                      "flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
                      activeTab === item.id || (item.id === 'automation-cases' && activeTab === 'automation-flow')
                        ? "bg-blue-50 text-blue-600"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    )}
                  >
                    <item.icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate text-xs font-bold">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            title={item.label}
            className={cn(
              "w-full flex items-center rounded-xl transition-all duration-200 group",
              collapsed ? "justify-center px-0 py-3" : "gap-3 px-4 py-3",
              activeTab === item.id
                ? "bg-white text-blue-600 shadow-md ring-1 ring-slate-200 border-none"
                : "text-slate-500 hover:bg-slate-200/50 hover:text-slate-900"
            )}
          >
            <item.icon className={cn(
              "w-4 h-4 transition-colors",
              activeTab === item.id ? "text-blue-600" : "text-slate-400 group-hover:text-slate-600"
            )} />
            {!collapsed && <span className="text-sm font-bold">{item.label}</span>}
            {!collapsed && activeTab === item.id && <ChevronRight className="w-3 h-3 ml-auto opacity-50" />}
          </button>
        ))}

        <div className="relative pt-1">
          <button
            onClick={() => {
              if (collapsed) {
                setOpenCollapsedMenu((current) => current === 'performance' ? null : 'performance');
                return;
              }
              setActiveTab('performance-task');
            }}
            title="性能测试"
            aria-haspopup={collapsed ? 'menu' : undefined}
            aria-expanded={collapsed ? openCollapsedMenu === 'performance' : undefined}
            className={cn(
              "relative w-full flex items-center rounded-xl transition-all duration-200 group",
              collapsed ? "justify-center px-0 py-3" : "gap-3 px-4 py-3",
              isPerformanceActive
                ? "bg-white text-blue-600 shadow-md ring-1 ring-slate-200 border-none"
                : "text-slate-500 hover:bg-slate-200/50 hover:text-slate-900"
            )}
          >
            <Gauge className={cn(
              "w-4 h-4 transition-colors",
              isPerformanceActive ? "text-blue-600" : "text-slate-400 group-hover:text-slate-600"
            )} />
            {!collapsed && <span className="text-sm font-bold">性能测试</span>}
            {!collapsed && isPerformanceActive && <ChevronRight className="w-3 h-3 ml-auto opacity-50" />}
            {collapsed && <ChevronRight className="absolute bottom-1.5 right-1 h-2.5 w-2.5 text-slate-400" aria-hidden="true" />}
          </button>
          {!collapsed && <div className="mt-1 ml-5 space-y-1 border-l border-slate-200 pl-2">
            {performanceItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={cn(
                  "w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
                  activeTab === item.id || (item.id === 'performance-task' && (activeTab === 'performance' || activeTab === 'logs'))
                    ? "bg-blue-50 text-blue-600"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                )}
              >
                <item.icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate text-[12px] font-bold">{item.label}</span>
              </button>
            ))}
          </div>}
          {collapsed && openCollapsedMenu === 'performance' && (
            <div className="absolute left-full top-0 z-50 w-52 pl-2" role="menu" aria-label="性能测试二级菜单">
              <div className="rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                <div className="px-2 pb-1.5 pt-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">性能测试</div>
                {performanceItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    onClick={() => selectCollapsedItem(item.id)}
                    className={cn(
                      "flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
                      activeTab === item.id || (item.id === 'performance-task' && (activeTab === 'performance' || activeTab === 'logs'))
                        ? "bg-blue-50 text-blue-600"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    )}
                  >
                    <item.icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate text-xs font-bold">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </nav>

      <div className={cn("mt-auto border-t border-slate-200 space-y-1", collapsed ? "p-2" : "p-3")}>
        <button
          type="button"
          onClick={() => setActiveTab('settings')}
          title="设置中心"
          className={cn(
            "w-full flex items-center rounded-lg transition-all font-medium",
            collapsed ? "justify-center px-0 py-3" : "gap-3 px-3 py-2",
            activeTab === 'settings'
              ? "bg-blue-50 text-blue-600"
              : "text-slate-500 hover:bg-slate-200/50 hover:text-slate-900"
          )}
        >
          <Settings className="w-4 h-4" />
          {!collapsed && <span className="text-sm">设置中心</span>}
        </button>
      </div>

    </aside>
  );
};
