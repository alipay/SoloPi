import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Globe2, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { COMMON_SITES_CHANGED_EVENT, readCommonSites } from '../lib/commonSites';
import { EmbeddedWebviewElement, SharedEmbeddedWebview } from './SharedEmbeddedWebview';

const LAST_SITE_KEY = 'glassbox.commonSites.lastSelected';

function getElectronApi() {
  try { return window.glassbox; } catch (_error) { return null; }
}

export function CommonSitesPage() {
  const webviewRef = useRef<EmbeddedWebviewElement | null>(null);
  const [sites, setSites] = useState(readCommonSites);
  const enabledSites = useMemo(() => sites.filter((site) => site.enabled), [sites]);
  const [selectedId, setSelectedId] = useState(() => window.localStorage.getItem(LAST_SITE_KEY) || 'sample-factory');
  const selected = enabledSites.find((site) => site.id === selectedId) || enabledSites[0];
  const [loading, setLoading] = useState(Boolean(selected));
  const [error, setError] = useState('');

  useEffect(() => {
    const refreshSites = () => setSites(readCommonSites());
    window.addEventListener(COMMON_SITES_CHANGED_EVENT, refreshSites);
    window.addEventListener('storage', refreshSites);
    return () => {
      window.removeEventListener(COMMON_SITES_CHANGED_EVENT, refreshSites);
      window.removeEventListener('storage', refreshSites);
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    window.localStorage.setItem(LAST_SITE_KEY, selected.id);
    setError('');
    setLoading(true);
  }, [selected?.id]);

  const refresh = () => {
    setError(''); setLoading(true); webviewRef.current?.reload?.();
  };

  const openExternal = async () => {
    if (!selected) return;
    const url = webviewRef.current?.getURL?.() || selected.url;
    const electronApi = getElectronApi();
    if (electronApi?.ipcRenderer) await electronApi.ipcRenderer.invoke('shell:open-external', url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  if (!selected) return <div className="flex flex-1 items-center justify-center bg-slate-50 p-6"><div className="rounded-3xl border border-dashed border-slate-300 bg-white px-8 py-10 text-center"><Globe2 className="mx-auto h-7 w-7 text-slate-300" /><h2 className="mt-3 text-sm font-black text-slate-900">还没有可用站点</h2><p className="mt-1 text-xs font-bold text-slate-400">请在设置中心的常用站点中添加或启用站点。</p></div></div>;

  return <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-slate-50 p-3">
    <div className="mb-2 flex h-11 shrink-0 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-2 shadow-sm">
      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><Globe2 className="h-4 w-4" /></span>
      <label htmlFor="common-site-selector" className="sr-only">选择常用站点</label>
      <select id="common-site-selector" value={selected.id} onChange={(event) => setSelectedId(event.target.value)} className="h-8 min-w-[180px] max-w-sm rounded-xl border-0 bg-slate-50 px-3 text-xs font-black text-slate-700 outline-none focus:ring-2 focus:ring-blue-100">
        {enabledSites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
      </select>
      <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-slate-400">{selected.url}</span>
      <button type="button" onClick={openExternal} className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-800" title="在外部浏览器打开"><ExternalLink className="h-4 w-4" /></button>
      <button type="button" onClick={refresh} className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-800" title="刷新"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
    </div>
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <SharedEmbeddedWebview ref={webviewRef} src={selected.url} onNavigationStart={() => setError('')} onLoadingChange={setLoading} onLoadError={(failure) => setError(`${failure.errorDescription}${failure.errorCode ? ` (${failure.errorCode})` : ''}`)} className="absolute inset-0 flex min-h-0 min-w-0 overflow-hidden border-0" style={{ height: '100%', width: '100%' }} allowPopups={true} />
      {loading && !error && <div className="pointer-events-none absolute left-4 top-4 z-10 flex items-center gap-2 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs font-bold text-slate-500 shadow-sm backdrop-blur"><Loader2 className="h-4 w-4 animate-spin text-blue-600" />{selected.name}加载中</div>}
      {error && <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 p-6 backdrop-blur-sm"><div className="max-w-lg rounded-2xl border border-rose-100 bg-white p-5 text-center shadow-xl"><XCircle className="mx-auto h-6 w-6 text-rose-500" /><div className="mt-3 text-sm font-black text-slate-900">站点加载失败</div><div className="mt-2 break-words text-xs font-bold leading-5 text-slate-500">{error}</div><button type="button" onClick={refresh} className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white hover:bg-blue-700">重新加载</button></div></div>}
    </div>
  </div>;
}
