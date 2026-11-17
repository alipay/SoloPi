import {PageHeaderSlot} from './components/PageHeaderActions';
import {SupportExportButton} from './components/SupportExportButton';
import {MemoryWorkspace} from './pages/MemoryWorkspace';
import {ServerAgent} from './pages/ServerAgent';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { BOOTSTRAP_AREA } from './api/areas';
import { connectionGeneration, getConnectionView, getRuntimeConnection, setProxyRoMode, setRoDevicesAvailable, setRuntimeConnection, subscribeConnection } from './api/connection';
import { probeReadonlyProxy } from './api/readonly-proxy';
import { probeRoDevices } from './api/devices-ro';
import { ConnectionPanel } from './components/ConnectionPanel';
import { OnlineBanner } from './components/OnlineBanner';
import { StatusBanner } from './components/StatusBanner';
import { Overview } from './pages/Overview';
import { ExecutionTasks } from './pages/ExecutionTasks';
import {DeviceWorkspace} from './components/DeviceWorkspace';
import {LabSidebar} from './components/LabSidebar';
import {pageForHash,pageTitles,pageHref,agentPages,managementPages,type PageKey} from './navigation';
export {pageForHash} from './navigation';
import { ImChat } from './pages/ImChat';
import { RegistrationGuide } from './pages/RegistrationGuide';
import {RuntimeSettings} from './pages/RuntimeSettings';
import { CaseQuality } from './pages/CaseQuality';

/** W11：同源只读代理探测——8780等部署自动进入固定scope只读模式（失败保持原路径） */
function useReadonlyProxyProbe(): void {
  useEffect(() => {
    let cancelled = false;
    // Independent capability reads run together; their validated first pages
    // are reused by the list readers instead of repeating the same requests.
    void probeReadonlyProxy().then(enabled=>{if(!cancelled)setProxyRoMode(enabled);}).catch(()=>undefined);
    void probeRoDevices().then(available=>{if(!cancelled)setRoDevicesAvailable(available);}).catch(()=>undefined);
    return () => {
      cancelled = true;
    };
  }, []);
}

function useDevConnectionBootstrap(): void {
  useEffect(() => {
    let cancelled = false;
    const generationAtStart = connectionGeneration();
    fetch('/dev-connection.json', { headers: { Accept: 'application/json' } })
      .then((resp) => (resp.ok ? (resp.json() as Promise<Record<string, unknown>>) : null))
      .then((cfg) => {
        if (cancelled || cfg == null) return;
        if (connectionGeneration() !== generationAtStart) return;
        if (getRuntimeConnection() != null) return;
        if (
          typeof cfg.apiBaseUrl !== 'string' ||
          typeof cfg.adminToken !== 'string' ||
          typeof cfg.scope !== 'object' ||
          cfg.scope == null
        ) {
          return;
        }
        const scope = cfg.scope as { orgId?: unknown; projectId?: unknown };
        if (typeof scope.orgId !== 'string' || typeof scope.projectId !== 'string') return;
        setRuntimeConnection({
          apiBaseUrl: cfg.apiBaseUrl,
          adminToken: cfg.adminToken,
          scope: { orgId: scope.orgId, projectId: scope.projectId },
          ...(typeof cfg.orgKey === 'string' ? { orgKey: cfg.orgKey } : {}),
          ...(typeof cfg.projectKey === 'string' ? { projectKey: cfg.projectKey } : {}),
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
}

export default function App(): React.JSX.Element {
  const [page, setPage] = useState<PageKey>(() => pageForHash(location.hash));
  const [headerHost,setHeaderHost]=useState<HTMLDivElement|null>(null);
  const [collapsed,setCollapsed]=useState(()=>{try{return localStorage.getItem('solopi.lab.nav.collapsed')==='true';}catch{return false;}});
  useEffect(()=>{if(typeof matchMedia!=='function')return;const query=matchMedia('(max-width: 800px)');const compact=()=>{if(query.matches)setCollapsed(true);};compact();query.addEventListener('change',compact);return()=>query.removeEventListener('change',compact);},[]);
  const [routeHash,setRouteHash]=useState(location.hash);
  const [showConnection, setShowConnection] = useState(false);
  const serverPage=['superagent','agentchat','tasks','memory','case-quality','runtime','guide'].includes(page);
  const view = useSyncExternalStore(subscribeConnection, getConnectionView);

  useEffect(() => {
    const navigate = () => {setPage(pageForHash(location.hash));setRouteHash(location.hash);};
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  useReadonlyProxyProbe();
  useDevConnectionBootstrap();

  return (
    <PageHeaderSlot.Provider value={headerHost}><div className={`app-shell page-${page}${collapsed?' sidebar-collapsed':''}`}>
      <LabSidebar page={page} collapsed={collapsed} onToggle={()=>setCollapsed(value=>{const next=!value;try{localStorage.setItem('solopi.lab.nav.collapsed',String(next));}catch{}return next;})}/>
      <div className="main-area">
        <header className="topbar">
          <nav className="crumb" aria-label="当前位置">{agentPages.has(page)?<><a href="#/agents">Agent 工作台</a><span>/</span></>:managementPages.has(page)?<><a href="#/settings">管理与帮助</a><span>/</span></>:null}<b role="heading" aria-level={1} aria-current="page">{pageTitles[page]}</b></nav><div className="topbar-page-actions" ref={setHeaderHost}>{managementPages.has(page)&&<SupportExportButton label="导出 Server 日志"/>}</div>
          <div className="topbar-links" hidden={view.proxyRo||serverPage}>
            <button
              type="button"
              onClick={() => setShowConnection((v) => !v)}
              disabled={view.proxyRo}
              title={view.proxyRo ? '本入口为固定scope只读代理模式：无需配置，浏览器配置不能改变只读代理的 scope' : undefined}
            >
              连接设置
            </button>
          </div>
        </header>
        <div className="app-notices">
          <OnlineBanner />
          {!serverPage && <StatusBanner />}
          {/* W23续修：固定scope只读协议说明不再占页面上方，收纳到页底（app-foot）——用户决定 */}
        </div>
        <div className="content">
          {showConnection && !view.proxyRo && !serverPage && <ConnectionPanel onClose={() => setShowConnection(false)} />}
          {page === 'overview' && <Overview onGoto={key=>location.hash=pageHref(key==='clients'||key==='workspace'?'devices':key as PageKey)} />}
          {page==='devices'&&<DeviceWorkspace screens={routeHash.split('?')[0]==='#/devices/screens'}/>}
          {page === 'tasks' && <ExecutionTasks />}
          {page === 'superagent' && <ServerAgent />}
          {page === 'agentchat' && <ImChat />}
          {page === 'memory' && <MemoryWorkspace/>}
          {page === 'case-quality' && <CaseQuality/>}
          {page === 'runtime' && <RuntimeSettings/>}
          {page === 'guide' && <RegistrationGuide bootstrapArea={BOOTSTRAP_AREA} />}
        </div>
      </div>
    </div></PageHeaderSlot.Provider>
  );
}
