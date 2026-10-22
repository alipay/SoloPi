import { useState } from 'react';
import { Globe2, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { CommonSite, createCommonSite, DEFAULT_COMMON_SITES, readCommonSites, writeCommonSites } from '../lib/commonSites';

export function CommonSitesSettings() {
  const [sites, setSites] = useState<CommonSite[]>(readCommonSites);
  const [message, setMessage] = useState('');
  const update = (id: string, patch: Partial<CommonSite>) => setSites((current) => current.map((site) => site.id === id ? { ...site, ...patch } : site));
  const save = () => {
    const invalid = sites.find((site) => { try { const url = new URL(site.url); return !['http:', 'https:'].includes(url.protocol); } catch (_error) { return true; } });
    if (invalid) { setMessage(`请检查“${invalid.name}”的链接`); return; }
    writeCommonSites(sites); setMessage('常用站点已保存');
  };
  return <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2"><Globe2 className="h-4 w-4 text-blue-600" /><h3 className="text-sm font-black text-slate-900">常用站点</h3></div><p className="mt-1 text-xs font-bold text-slate-400">配置侧边栏中可快速切换的网页。所有站点继续共用 solopi-desktop 的登录会话。</p></div><button type="button" onClick={() => setSites((current) => [...current, createCommonSite()])} className="flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 hover:bg-blue-100"><Plus className="h-4 w-4" />添加站点</button></div>
    <div className="mt-5 space-y-3">{sites.map((site) => <div key={site.id} className="grid grid-cols-[minmax(150px,0.8fr)_minmax(280px,2fr)_auto_auto] items-end gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <div><label htmlFor={`site-name-${site.id}`} className="text-[10px] font-black uppercase tracking-widest text-slate-400">展示名称</label><input id={`site-name-${site.id}`} value={site.name} onChange={(event) => update(site.id, { name: event.target.value })} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none focus:border-blue-300" /></div>
      <div><label htmlFor={`site-url-${site.id}`} className="text-[10px] font-black uppercase tracking-widest text-slate-400">站点链接</label><input id={`site-url-${site.id}`} value={site.url} onChange={(event) => update(site.id, { url: event.target.value })} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-xs outline-none focus:border-blue-300" /></div>
      <label className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-600"><input type="checkbox" checked={site.enabled} onChange={(event) => update(site.id, { enabled: event.target.checked })} className="h-4 w-4 accent-blue-600" />启用</label>
      <button type="button" onClick={() => setSites((current) => current.filter((item) => item.id !== site.id))} className="flex h-10 w-10 items-center justify-center rounded-xl border border-rose-100 bg-white text-rose-500 hover:bg-rose-50" title="删除站点"><Trash2 className="h-4 w-4" /></button>
    </div>)}</div>
    {message && <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">{message}</div>}
    <div className="mt-5 flex justify-between"><button type="button" onClick={() => { setSites(DEFAULT_COMMON_SITES); setMessage('已恢复默认值，保存后生效'); }} className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black text-slate-500 hover:bg-slate-100"><RotateCcw className="h-4 w-4" />恢复默认</button><button type="button" onClick={save} className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white hover:bg-blue-700"><Save className="h-4 w-4" />保存站点</button></div>
  </section>;
}
