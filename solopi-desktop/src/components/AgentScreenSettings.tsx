import { useEffect, useState } from 'react';
type Check = { selectorKey: 'resourceId' | 'text' | 'description'; selectorValue: string; operator: 'equals' | 'contains'; expected: string };
type Settings = { screenMode: 'main' | 'virtual'; virtualChecks: Check[] };
export default function AgentScreenSettings({ busy }: { busy: boolean }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    void window.glassbox?.ipcRenderer?.invoke('agent:screen-settings').then((result: {success?:boolean;error?:string;settings:Settings}) => {
      if (!active) return;
      if (result?.success === false) setError(result.error || '读取失败'); else setSettings(result.settings);
    }).catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  const patch = (value: Partial<Settings>) => { setSettings(current => current && ({ ...current, ...value })); setSaved(false); };
  const update = (index: number, value: Partial<Check>) => patch({ virtualChecks: settings!.virtualChecks.map((c, i) => i === index ? { ...c, ...value } : c) });
  async function save() {
    setSaving(true); setError('');
    try {
      const result = await window.glassbox?.ipcRenderer?.invoke('agent:save-screen-settings', settings);
      if (!result || result.success === false) throw Error(result?.error || '保存失败');
      setSettings(result.settings); setSaved(true);
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败'); }
    finally { setSaving(false); }
  }
  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
    <h2 className="text-base font-semibold">Agent 后台屏幕</h2>
    <p className="text-sm text-slate-500">仅影响之后启动的对话任务，执行中固定设备和验收条件。模型请求继续由现有 DeepSeek Harness 管理。</p>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {settings && <>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.screenMode === 'virtual'} disabled={saving} onChange={e => patch({ screenMode: e.target.checked ? 'virtual' : 'main' })} />使用 Android 后台屏幕（实验功能）</label>
      <p className="text-xs text-slate-500">需要支持副屏的设备控制服务。页面节点与本地 OCR 文字会发送给当前模型，截图仅用于本地预览。后台屏幕模式只开放手机操作工具。</p>
      {busy && <p role="status" className="text-xs text-amber-700">当前任务保持原设置，新设置在之后启动的任务生效。</p>}
      {settings.screenMode === 'virtual' && <div className="space-y-3">
        <h3 className="text-sm font-medium">固定验收条件</h3>
        <p className="text-xs text-slate-500">结束时依据最终页面核验。不填写时不宣称测试通过。</p>
        {settings.virtualChecks.map((check, index) => <div key={index} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <select aria-label={`第${index + 1}项定位属性`} value={check.selectorKey} disabled={saving} onChange={e => update(index, { selectorKey: e.target.value as Check['selectorKey'] })} className="rounded border p-2 text-xs"><option value="resourceId">resourceId</option><option value="text">文字</option><option value="description">描述</option></select>
          <input aria-label={`第${index + 1}项定位值`} value={check.selectorValue} disabled={saving} onChange={e => update(index, { selectorValue: e.target.value })} placeholder="定位值" className="min-w-0 rounded border p-2 text-xs" />
          <select aria-label={`第${index + 1}项匹配方式`} value={check.operator} disabled={saving} onChange={e => update(index, { operator: e.target.value as Check['operator'] })} className="rounded border p-2 text-xs"><option value="equals">等于</option><option value="contains">包含</option></select>
          <input aria-label={`第${index + 1}项预期文字`} value={check.expected} disabled={saving} onChange={e => update(index, { expected: e.target.value })} placeholder="预期文字" className="min-w-0 rounded border p-2 text-xs" />
          <button type="button" disabled={saving} onClick={() => patch({ virtualChecks: settings.virtualChecks.filter((_, i) => i !== index) })} className="text-xs text-slate-600">删除</button>
        </div>)}
        <button type="button" disabled={saving || settings.virtualChecks.length >= 10} onClick={() => patch({ virtualChecks: [...settings.virtualChecks, { selectorKey: 'resourceId', selectorValue: '', operator: 'equals', expected: '' }] })} className="text-sm text-blue-700">添加验收条件</button>
      </div>}
      <button type="button" disabled={saving} onClick={() => void save()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">{saving ? '正在保存…' : '保存设置'}</button>
      {saved && <span role="status" className="ml-3 text-sm text-emerald-700">已保存</span>}
    </>}
  </section>;
}
