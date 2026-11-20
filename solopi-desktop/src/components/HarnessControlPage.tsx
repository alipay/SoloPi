import { useLanguage } from '../language';
import { useEffect, useRef, useState } from 'react';
import { FolderOpen, MonitorSmartphone, RefreshCw, Square, Play, Check, Download } from 'lucide-react';

type Platform = 'android' | 'ios' | 'harmony_next';
type Device = { platform: Platform; deviceId: string; deviceKind: 'physical' | 'simulator'; name: string; state: string };
type Config = { platform: Platform; deviceId: string; deviceKind: 'physical' | 'simulator'; appId: string; controlPackage: string; controlPort: number; wdaPort: number; actionValidationStrategy: 'full-page' | 'target-context-v1' };
type Element = { handle: string; selector: Record<string, string>; text: string; description: string; role: string; hittable: boolean };
type Frame = { observationId: string; screenshotDataUrl: string; elements: Element[]; actions: string[]; stepCount: number; checkpointCount: number };
type Response = { success: boolean; error?: string; disconnected?: boolean; data?: Record<string, unknown> };
const labels = { android: 'Android', ios: 'iOS', harmony_next: 'HarmonyOS NEXT' };
const button = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed';
const input = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50';
const errors: Record<string, string> = {
  driver_not_ready: '驱动未就绪。iOS 请先启动匹配设备的 WDA；NEXT 请检查 HDC 与 uitest。',
  android_setup_required: 'SoloPi 预检未通过。请检查辅助功能、内部 ADB 连接，以及所选控制包和端口。',
  python_runtime_unavailable: '未找到 Python 3，请安装 Python 3.9 或更新版本后重启桌面应用。',
  harness_source_missing: '未找到配套 Harness，请使用包含 solopi-skill 的完整源码或配套安装包。',
  physical_harmony_not_validated: '当前 NEXT 仅开放模拟器，真机控制尚未验收。',
  stale_observation: '页面观察已过期，请刷新页面并重新选择节点。',
  observation_identity_mismatch: '尚未采到所选应用的可验证页面。请确认应用已打开、完成必要登录，再重新连接；本次没有继续操作。',
  target_changed: '目标或窗口发生变化，本次动作已拒绝。请刷新后重选。',
  target_occluded: '设备检测到目标与其他可操作节点重叠，已拒绝点击。请查看原图和回执，不能凭截图绕过校验。',
  target_geometry_unknown: '设备无法确认目标位置，已拒绝动作。请刷新并重新选择可验证的节点。',
  android_action_rejected: '设备明确拒绝了本次动作，原因已保存在回执中；没有自动重发。',
  android_action_failed: '设备返回动作失败，本次录制已停止。请检查手机与原始回执。',
  recording_requires_fixed_assertion: '请先执行至少一步，并手动添加一个固定验收条件。',
  checkpoint_requires_action: '请先执行一个操作，再添加验收条件。',
  device_binding_mismatch: '用例平台或应用标识与当前设备配置不一致。',
  control_identity_mismatch: '控制端口属于另一个 SoloPi 包，请检查包名与端口。',
  harness_timeout_outcome_unknown: '操作超时，结果不确定，已停止会话。请查看手机与证据，不要直接重复点击。',
  harness_exited_outcome_unknown: '控制进程已结束。请查看本次证据及设备清理结果，未确认的动作不会自动重发。',
  action_outcome_unknown: '未获得动作的确定回执。会话已中断，请检查设备实际状态。',
  TEST_TASK_BUSY: '设备正被桌面任务占用，请先结束该任务。',
};
async function invoke(operation: string, payload: unknown = {}): Promise<Response> {
  if (!window.glassbox?.ipcRenderer) throw new Error('请在 SoloPi 桌面应用中使用三端设备控制。');
  return await window.glassbox.ipcRenderer.invoke(`harness:${operation}`, payload) as Response;
}

export function HarnessControlPage({ active }: { active: boolean }) {
  const { t } = useLanguage();
  const errorMessage = (code: string, fallback: string) => errors[code] || errors[fallback] || code;
  const [config, setConfig] = useState<Config>({ platform: 'android', deviceId: '', deviceKind: 'physical',
    appId: '', controlPackage: 'com.alipay.hulu', controlPort: 23342, wdaPort: 8100, actionValidationStrategy: 'full-page' });
  const [devices, setDevices] = useState<Device[]>([]);
  const [packages, setPackages] = useState<string[]>([]);
  const [appLabels, setAppLabels] = useState<Record<string, string>>({});
  const [appSearch, setAppSearch] = useState('');
  const [appPickerOpen, setAppPickerOpen] = useState(false);
  const [appIndex, setAppIndex] = useState(0);
  const [labelStatus, setLabelStatus] = useState('');
  const [packageStatus, setPackageStatus] = useState('');
  const [frame, setFrame] = useState<Frame | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState('');
  const [filter, setFilter] = useState('');
  const [text, setText] = useState('');
  const [expected, setExpected] = useState('');
  const [draft, setDraft] = useState('');
  const [artifacts, setArtifacts] = useState(false);
  const initialized = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const selectedNode = frame?.elements.find(node => node.handle === selected);
  const patch = (value: Partial<Config>) => setConfig(current => ({ ...current, ...value }));
  async function run(operation: string, payload: unknown = {}) {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await invoke(operation, payload);
      if (!result.success) {
        if (result.disconnected) { setConnected(false); setFrame(null); }
        throw new Error(result.error || 'desktop_operation_failed');
      }
      const data = result.data || {};
      if (Array.isArray(data.devices)) setDevices(data.devices as Device[]);
      if (data.observationId && Array.isArray(data.elements)) {
        setFrame(data as unknown as Frame); setConnected(true); setSelected('');
      }
      if (data.state === 'completed' || data.state === 'disconnected') { setConnected(false); setFrame(null); }
      if (data.state === 'disconnected') setMessage(t("电脑端会话已结束。中断回放的设备清理结果保存在证据目录；未确认的动作不会自动重发。", "The desktop session ended. See the evidence folder for the cleanup result. Actions without confirmation are never resent automatically."));
      if (data.requirement) { setDraft(JSON.stringify(data.requirement, null, 2)); setMessage(t("录制已保存。请核对用例中的步骤、初始状态和验收条件后回放。", "Recording saved. Review the steps, initial state, and assertions before replay.")); }
      if (data.artifacts) setArtifacts(true);
      if (data.receipt) {
        const receipt = data.receipt as { state?: string };
        if (receipt.state === 'succeeded') setMessage(t("已收到动作成功回执；测试是否通过仍由固定断言判断。", "Action succeeded. The test outcome depends on the assertions."));
        else if (receipt.state === 'rejected') {
          setMessage(t("动作未执行，录制步骤已保留，页面已重新观察。请重新选择节点或操作；不会自动重发。", "Action rejected. Recorded steps were kept and the screen was refreshed. Select an element or action again."));
          const reason = typeof data.actionError === 'string' ? data.actionError : 'android_action_rejected';
          setError(errorMessage(reason, 'android_action_rejected'));
        }
      }
      if (data.assertion) {
        const assertion = data.assertion as { status: string };
        setMessage(t(`验收条件已记录，本次检查：${assertion.status}。预期值保持你输入的内容。`, `Assertion saved. Result: ${assertion.status}. The expected value is kept as entered.`));
      }
      if (data.result) {
        const report = data.result as { status?: string; htmlExportError?: string; desktopCleanup?: { state: string } };
        const warning = report.desktopCleanup?.state === 'unconfirmed' ? t("设备清理未确认，请先检查手机状态。", "Device cleanup unconfirmed. Check the phone state first.") : '';
        const exportWarning = report.htmlExportError ? t("HTML 导出未完成，请查看原始 JSON 报告。", "HTML export incomplete. Open the original JSON report.") : '';
        setMessage(`固定回放结果：${report.status || 'not_tested'}。打开证据目录查看完整报告、截图及清理结果。${warning}${exportWarning}`);
      }
      return true;
    } catch (e) {
      const code = e instanceof Error ? e.message : 'desktop_operation_failed';
      setError(errorMessage(code, ''));
      if (code.startsWith('harness_') || code === 'no_device_session' || code === 'action_outcome_unknown') {
        setConnected(false); setFrame(null);
      }
      return false;
    } finally { setBusy(false); }
  }
  useEffect(() => {
    if (active && !initialized.current) { initialized.current = true; void run('discover'); }
  }, [active]);
  useEffect(() => {
    let cancelled = false;
    setPackages([]);
    if (!active || config.platform !== 'android' || !config.deviceId) { setPackageStatus(''); return; }
    setPackageStatus(t("正在读取手机已安装的应用…", "Loading apps installed on the phone…"));
    window.glassbox?.ipcRenderer?.invoke('adb:list-packages', config.deviceId).then((result: { packages?: string[]; error?: string }) => {
      if (cancelled) return;
      if (result.error) { setPackageStatus(t("读取应用失败，请检查手机连接，或手动填写包名。", "Could not load apps. Check the phone connection or enter the package name manually.")); return; }
      const list = Array.isArray(result.packages) ? result.packages.filter((p): p is string => typeof p === 'string' && /^[A-Za-z][A-Za-z0-9_.-]*$/.test(p)) : [];
      setPackages(list);
      const controls = list.filter(p => p === 'com.alipay.hulu' || p.startsWith('com.alipay.hulu.'));
      if (controls.length === 1) setConfig(current => current.deviceId === config.deviceId && current.platform === 'android' ? { ...current, controlPackage: controls[0] } : current);
      setPackageStatus(controls.length > 1 ? t("检测到多个 SoloPi 副本，请选择控制包并核对端口。", "Multiple SoloPi packages found. Select the control package and check its port.") : controls.length === 0 ? t("未发现 SoloPi 控制包，请检查安装或手动填写。", "SoloPi control package unavailable. Check the installation or enter the package name.") : t("已读取手机应用；请选择要测试的 App。", "Apps loaded. Select the app to test."));
    }).catch(() => { if (!cancelled) setPackageStatus(t("读取应用失败，请检查手机连接，或手动填写包名。", "Could not load apps. Check the phone connection or enter the package name manually.")); });
    return () => { cancelled = true; };
  }, [active, config.platform, config.deviceId]);
  useEffect(() => {
    let cancelled = false;
    if (!active || connected || busy || config.platform !== 'android' || !config.deviceId || !packages.length) return;
    setLabelStatus(t("正在读取应用名称…", "Loading app names…"));
    const query = { ...config, appId: config.controlPackage };
    void invoke('apps', query).then(result => {
      if (cancelled) return;
      const apps = result.data?.apps;
      if (!result.success || !Array.isArray(apps)) { setLabelStatus(t("应用名称暂不可用，显示包名。", "App names unavailable. Showing package names.")); return; }
      const labels: Record<string, string> = {};
      for (const app of apps) if (typeof app?.packageName === 'string' && typeof app?.label === 'string' && packages.includes(app.packageName)) labels[app.packageName] = app.label;
      setAppLabels(labels); setLabelStatus(t("可按应用名称或包名搜索。", "Search by app name or package name."));
    }).catch(() => { if (!cancelled) setLabelStatus(t("应用名称暂不可用，显示包名。", "App names unavailable. Showing package names.")); });
    return () => { cancelled = true; };
  }, [active, connected, busy, config.platform, config.deviceId, config.deviceKind, config.controlPackage, config.controlPort, config.wdaPort, config.actionValidationStrategy, packages]);
  const matchingApps = packages.filter(p => p !== config.controlPackage && (!appSearch.trim() || p.toLowerCase().includes(appSearch.trim().toLowerCase()) || (appLabels[p] || '').toLowerCase().includes(appSearch.trim().toLowerCase())))
    .sort((a, b) => Number(Boolean(appLabels[b])) - Number(Boolean(appLabels[a])) || (appLabels[a] || a).localeCompare(appLabels[b] || b, 'zh-CN'));
  const displayedApps = matchingApps.slice(0, 80);
  const chooseApp = (packageName: string) => { patch({ appId: packageName }); setAppPickerOpen(false); setAppSearch(''); setAppIndex(0); };
  const command = (value: Record<string, unknown>) => run('command', {
    observationId: frame?.observationId, handle: selected, ...value,
  });
  const act = (action: string, extra: Record<string, unknown> = {}) => command({ type: 'act', action, ...extra });
  const can = (action: string, node = false) => connected && !busy && frame?.actions.includes(action)
    && (!node || selectedNode?.hittable);
  const replay = () => {
    try { void run('replay', { config, requirement: JSON.parse(draft) }); }
    catch { setError(t("用例不是有效 JSON，请先修正。", "Invalid case JSON. Fix it before continuing.")); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([draft], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'solopi-desktop-requirement.json'; link.click();
    URL.revokeObjectURL(url);
  };
  return <section className="flex h-full min-h-0 flex-col overflow-auto bg-slate-50 p-5" aria-label={t("三端设备控制", "Device control")}>
    <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="flex items-center gap-2 text-xl font-bold"><MonitorSmartphone className="h-6 w-6 text-blue-600" />{t("三端设备控制", "Device control")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("选择设备 → 观察页面 → 操作真实节点 → 固定验收 → 导出与回放", "Select a device → Inspect the screen → Interact with UI elements → Add assertions → Export and replay")}</p></div>
      <div className="flex gap-2"><button className={button} disabled={busy} onClick={() => void run('discover')}><RefreshCw className="h-4 w-4" />{t("刷新设备", "Refresh devices")}</button>
        <button className={button} disabled={!connected && !busy} onClick={() => void run('stop')}><Square className="h-4 w-4" />{t("断开 / 停止", "Disconnect / Stop")}</button></div>
    </header>
    <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="grid items-end gap-3 md:grid-cols-[140px_minmax(180px,1fr)_minmax(240px,1.25fr)_auto]">
        <label className="text-xs font-medium text-slate-500">{t("平台", "Platform")}<select aria-label={t("平台", "Platform")} className={input + ' mt-1'} disabled={connected || busy} value={config.platform}
          onChange={e => { setAppPickerOpen(false); setAppSearch(''); setAppLabels({}); patch({ platform: e.target.value as Platform, deviceId: '', appId: '', deviceKind: e.target.value === 'harmony_next' ? 'simulator' : 'physical' }); }}>
          {Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="text-xs font-medium text-slate-500">{t("设备", "Device")}<select aria-label={t("已发现设备", "Discovered devices")} className={input + ' mt-1'} disabled={connected || busy} value={config.deviceId}
          onChange={e => { const device = devices.find(d => d.platform === config.platform && d.deviceId === e.target.value); if (device) { setAppLabels({}); patch({ deviceId: device.deviceId, deviceKind: device.deviceKind, appId: '' }); } }}>
          <option value="">{t("选择设备", "Select a device")}</option>{devices.filter(d => d.platform === config.platform).map(d => <option key={d.deviceId} value={d.deviceId}>{d.name} · {d.deviceKind === 'physical' ? t("真机", "Physical device") : t("模拟器", "Simulator")} · {d.state}</option>)}</select></label>
        <div className="relative text-xs font-medium text-slate-500">
          <label htmlFor="harness-app-picker">{t("被测应用", "App under test")}</label>
          {config.platform === 'android' ? <>
            <input id="harness-app-picker" role="combobox" aria-label={t("搜索并选择被测应用", "Search and select the app under test")} aria-expanded={appPickerOpen} aria-controls="harness-app-options" aria-autocomplete="list" aria-activedescendant={appPickerOpen && displayedApps[appIndex] ? `harness-app-option-${appIndex}` : undefined}
              className={input + ' mt-1'} disabled={connected || busy || !packages.length} placeholder={packages.length ? t("搜索应用名称或包名", "Search by app name or package") : t("等待设备应用列表", "Waiting for installed apps")}
              value={appPickerOpen ? appSearch : (appLabels[config.appId] ? `${appLabels[config.appId]} · ${config.appId}` : config.appId)}
              onFocus={() => { setAppPickerOpen(true); setAppSearch(''); setAppIndex(0); }}
              onChange={e => { setAppSearch(e.target.value); setAppIndex(0); setAppPickerOpen(true); }}
              onBlur={() => setAppPickerOpen(false)}
              onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setAppPickerOpen(true); setAppIndex(i => Math.max(0, Math.min(i + 1, displayedApps.length - 1))); } else if (e.key === 'ArrowUp') { e.preventDefault(); setAppIndex(i => Math.max(0, i - 1)); } else if (e.key === 'Enter' && appPickerOpen && displayedApps[appIndex]) { e.preventDefault(); chooseApp(displayedApps[appIndex]); } else if (e.key === 'Escape') setAppPickerOpen(false); }} />
            {appPickerOpen && <div id="harness-app-options" role="listbox" aria-label={t("已安装的应用", "Installed apps")} className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              {displayedApps.map((p, i) => <button id={`harness-app-option-${i}`} role="option" aria-selected={i === appIndex} type="button" key={p} className={`block w-full px-3 py-2 text-left ${i === appIndex ? 'bg-blue-50' : 'hover:bg-slate-50'}`} onMouseDown={e => e.preventDefault()} onMouseEnter={() => setAppIndex(i)} onClick={() => chooseApp(p)}><span className="block text-sm text-slate-800">{appLabels[p] || p}</span>{appLabels[p] && <span className="block truncate text-xs text-slate-400">{p}</span>}</button>)}
              {!displayedApps.length && <p className="px-3 py-3 text-slate-500">{t("没有匹配的应用，可在高级设置中手动输入包名。", "No matching apps. Enter a package name in Advanced settings.")}</p>}
              {matchingApps.length > displayedApps.length && <p className="px-3 py-2 text-slate-400">{t("继续输入名称或包名以缩小范围", "Keep typing to narrow the results")}</p>}
            </div>}
          </> : <input id="harness-app-picker" aria-label={t("被测应用标识", "App identifier")} className={input + ' mt-1'} disabled={connected || busy} value={config.appId} onChange={e => patch({ appId: e.target.value })} placeholder={t("输入 Bundle ID / 应用标识", "Enter bundle ID or app identifier")} />}
        </div>
        <button className={button + ' min-h-[38px] !border-blue-600 !bg-blue-600 !text-white'} disabled={busy || connected || !config.deviceId || !config.appId || (config.platform === 'android' && config.appId === config.controlPackage)} onClick={() => void run('connect', config)}><Play className="h-4 w-4" />{t("连接并录制", "Connect and record")}</button>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>{connected ? t("已连接，配置在断开后可修改。", "Connected. Disconnect to change these settings.") : config.platform === 'android' ? (packageStatus || t("选择设备后读取已安装应用。", "Select a device to load its installed apps.")) : t("选择设备并填写应用标识，即可开始录制。", "Select a device and enter the app identifier to start recording.")}</span>
        {config.platform === 'android' && labelStatus && <span>{labelStatus}</span>}
      </div>
      <details className="mt-3 border-t border-slate-100 pt-3"><summary className="cursor-pointer text-xs font-medium text-slate-600">{t("高级设置与环境要求", "Advanced settings and requirements")}</summary>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <label className="text-xs">{t("设备 ID", "Device ID")}<input aria-label={t("设备 ID", "Device ID")} className={input} disabled={connected || busy} value={config.deviceId} onChange={e => patch({ deviceId: e.target.value })} /></label>
          <label className="text-xs">{t("设备类型", "Device type")}<select className={input} disabled={connected || busy} value={config.deviceKind} onChange={e => patch({ deviceKind: e.target.value as Config['deviceKind'] })}><option value="physical">{t("真机", "Physical device")}</option><option value="simulator">{t("模拟器", "Simulator")}</option></select></label>
          {config.platform === 'android' ? <><label className="text-xs">{t("SoloPi 控制包", "SoloPi control package")}<select aria-label={t("选择 SoloPi 控制包", "Choose the SoloPi control package")} className={input} disabled={connected || busy || !packages.some(p => p === 'com.alipay.hulu' || p.startsWith('com.alipay.hulu.'))} value={packages.includes(config.controlPackage) ? config.controlPackage : ''} onChange={e => patch({ controlPackage: e.target.value })}><option value="">{t("选择已安装的 SoloPi", "Select an installed SoloPi package")}</option>{packages.filter(p => p === 'com.alipay.hulu' || p.startsWith('com.alipay.hulu.')).map(p => <option key={p} value={p}>{p}</option>)}</select></label>
            <label className="text-xs">{t("SoloPi 控制端口（默认 23342）", "SoloPi control port (default 23342)")}<input aria-label={t("控制端口", "Control port")} className={input} disabled={connected || busy} type="number" value={config.controlPort} onChange={e => patch({ controlPort: Number(e.target.value) })} /></label>
            <label className="text-xs md:col-span-2">{t("手动填写被测应用包名", "Enter app package manually")}<input aria-label={t("被测应用标识", "App identifier")} className={input} disabled={connected || busy} value={config.appId} onChange={e => patch({ appId: e.target.value })} placeholder={t("例如 com.example.app", "Example: com.example.app")} /></label>
            <label className="text-xs md:col-span-2">{t("手动填写 SoloPi 控制包", "Enter SoloPi control package manually")}<input aria-label={t("SoloPi 控制包", "SoloPi control package")} className={input} disabled={connected || busy} value={config.controlPackage} onChange={e => patch({ controlPackage: e.target.value })} /></label>
            <label className="text-xs md:col-span-2">{t("录制时的点击校验", "Tap validation during recording")}<select aria-label={t("录制时的点击校验", "Tap validation during recording")} className={input} disabled={connected || busy} value={config.actionValidationStrategy}
              onChange={e => patch({ actionValidationStrategy: e.target.value as Config['actionValidationStrategy'] })}>
              <option value="full-page">{t("整页一致（默认）", "Full screen match (default)")}</option><option value="target-context-v1">{t("目标与相关区域一致（需设备支持）", "Match target and surrounding area (requires device support)")}</option></select>
              <span className="mt-1 block text-slate-500">{t("目标、遮挡和窗口仍会检查；其他动作继续要求整页一致。", "The target, occlusion, and window are still checked. Other actions require a full screen match.")}</span></label></>
            : config.platform === 'ios' ? <label className="text-xs">{t("WDA 本机端口", "Local WDA port")}<input className={input} disabled={connected || busy} type="number" value={config.wdaPort} onChange={e => patch({ wdaPort: Number(e.target.value) })} /></label> : null}
        </div><p className="mt-2 text-xs text-slate-500">{t("Android 需要支持 Agent 会话协议的 SoloPi 和辅助功能。iOS 需要匹配设备的 WDA；真机还需签名、信任与本机 USB 转发。NEXT 当前仅支持 HDC 模拟器；输入只支持空字段和受限字符。所有平台依赖本机 Python 3.9+。", "Android requires SoloPi with Agent session support and accessibility enabled. iOS requires a matching WDA setup, with signing, trust, and local USB forwarding for physical devices. HarmonyOS NEXT supports HDC simulators, with text input limited to empty fields and a restricted character set. All platforms require Python 3.9 or later.")}</p>
      </details>
    </div>
    {config.platform === 'android' && config.appId && config.appId === config.controlPackage && <div role="alert" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{t("被测应用与 SoloPi 控制包相同；请在被测应用中选择需要测试的 App。", "The selected app is the SoloPi control package. Choose the app you want to test.")}</div>}
    {error && <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <p role="status" className="mb-3 text-sm text-slate-600">{busy ? t("正在处理，请等待回执；停止后不会自动重发动作。", "Waiting for the device response. Stopping does not resend the action.") : message || t("连接后，每次操作会自动保存原图、观察和回执。", "While connected, SoloPi saves screenshots, observations, and action receipts.")}</p>
    <div className="grid gap-4 xl:grid-cols-[320px_minmax(300px,1fr)_320px]">
      <div className="rounded-xl border bg-white p-3 text-center">
        <h2 className="mb-2 text-sm font-semibold">{t("完整页面预览", "Device screen preview")}</h2>
        {frame?.screenshotDataUrl ? <img src={frame.screenshotDataUrl} alt={t("当前设备完整截图", "Full screenshot of the selected device")} className="mx-auto h-auto max-h-[580px] max-w-full object-contain" />
          : <div className="flex h-64 items-center justify-center text-sm text-slate-400">{t("连接后显示设备原图", "Connect a device to preview its screen")}</div>}
        <p className="mt-2 text-xs text-slate-400">{t("截图用于预览；通过右侧节点执行操作。", "Use the element list to interact with the device.")}</p>
        <button className={button + ' mt-3'} disabled={!connected || busy} onClick={() => void command({ type: 'observe' })}><RefreshCw className="h-4 w-4" />{t("刷新页面", "Refresh screen")}</button>
      </div>
      <div className="rounded-xl border bg-white p-3">
        <h2 className="mb-2 text-sm font-semibold">{t("选择页面节点", "Select a UI element")}</h2>
        <input aria-label={t("筛选节点", "Filter UI elements")} className={input} value={filter} onChange={e => setFilter(e.target.value)} placeholder={t("按文字、标识或类型筛选", "Filter by text, identifier, or type")} />
        <div className="mt-2 max-h-[540px] space-y-1 overflow-auto">
          {frame?.elements.filter(node => JSON.stringify(node).toLowerCase().includes(filter.toLowerCase())).map(node =>
            <button key={node.handle} className={`block w-full rounded-lg border p-2 text-left ${selected === node.handle ? 'border-blue-500 bg-blue-50' : 'border-transparent hover:bg-slate-50'}`}
              disabled={busy} onClick={() => setSelected(node.handle)}>
              <span className="block text-sm font-medium">{node.text || node.description || Object.values(node.selector)[0]}</span>
              <span className="block break-all text-xs text-slate-500">{JSON.stringify(node.selector)}{!node.hittable && t(" · 不可操作 / 仅可验收", " · Assertions only")}</span>
            </button>)}
          {frame && !frame.elements.length && <p className="p-3 text-sm text-slate-500">{t("没有唯一可定位节点，当前页面不支持节点操作。", "No unique UI elements were found on this screen.")}</p>}
        </div>
      </div>
      <div className="space-y-4 rounded-xl border bg-white p-4">
        <h2 className="text-sm font-semibold">{t("操作与固定验收", "Actions and assertions")}</h2>
        <p className="text-xs text-slate-500">{t(`已录制 ${frame?.stepCount || 0} 步 · ${frame?.checkpointCount || 0} 个验收条件`, `${frame?.stepCount || 0} recorded steps · ${frame?.checkpointCount || 0} assertions`)}</p>
        <div className="flex flex-wrap gap-2"><button className={button} disabled={!can('click', true)} onClick={() => void act('click')}>{t("点击节点", "Tap element")}</button>
          <button className={button} disabled={!can('longClick', true)} onClick={() => void act('longClick', { durationMs: 1000 })}>{t("长按", "Long press")}</button>
          <button className={button} disabled={!can('back')} onClick={() => void act('back')}>{t("返回", "Back")}</button>
          <button className={button} disabled={!can('wait')} onClick={() => void act('wait', { durationMs: 500 })}>{t("等待", "Wait")}</button></div>
        <div className="flex gap-2"><button className={button} disabled={!can('scroll', true)} onClick={() => void act('scroll', { direction: 'up', distance: 60 })}>{t("向上滚动", "Scroll up")}</button>
          <button className={button} disabled={!can('scroll', true)} onClick={() => void act('scroll', { direction: 'down', distance: 60 })}>{t("向下滚动", "Scroll down")}</button></div>
        <label className="block text-xs">{t("输入内容", "Text to enter")}<input aria-label={t("输入内容", "Text to enter")} className={input + ' mt-1'} value={text} onChange={e => setText(e.target.value)} maxLength={4096} /></label>
        <button className={button} disabled={!can('input', true) || !text} onClick={() => void act('input', { text })}>{t("向所选节点输入", "Type into selected element")}</button>
        <hr />
        <label className="block text-xs">{t("预期文字（请手动填写）", "Expected text (enter manually)")}<input aria-label={t("预期文字", "Expected text")} className={input + ' mt-1'} value={expected} onChange={e => setExpected(e.target.value)} maxLength={4096} placeholder={t("用例应达到的结果", "Expected test result")} /></label>
        <button className={button} disabled={!connected || busy || !selectedNode || !frame?.stepCount} onClick={() => void command({ type: 'assert', expected })}><Check className="h-4 w-4" />{t("添加文字相等断言", "Assert exact text match")}</button>
        <button className={button + ' w-full !bg-blue-600 !text-white'} disabled={!connected || busy || !frame?.checkpointCount} onClick={() => void command({ type: 'end' })}>{t("结束录制并生成用例", "Finish recording and create test case")}</button>
      </div>
    </div>
    <div className="mt-4 rounded-xl border bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">{t("可编辑回归用例", "Editable regression test case")}</h2><p className="text-xs text-slate-500">{t("回放前恢复初始状态，或在用例中加入重置步骤。回放复用固定验收，不会把实际结果写成预期。", "Restore the initial state before replay or add a reset step to the case. Replay checks the original assertions against the observed results.")}</p></div>
        <div className="flex gap-2"><input ref={fileInput} type="file" accept=".json" className="hidden" onChange={async e => {
          const file = e.target.files?.[0]; if (!file) return;
          if (file.size > 512 * 1024) { setError(t("用例文件不能超过 512 KiB", "Test case files must be 512 KiB or smaller")); return; }
          setDraft(await file.text());
        }} /><button className={button} disabled={busy || connected} onClick={() => fileInput.current?.click()}>导入 JSON</button>
          <button className={button} disabled={!draft} onClick={download}><Download className="h-4 w-4" />下载用例</button>
          <button className={button} disabled={busy || connected || !draft || !config.deviceId} onClick={replay}><Play className="h-4 w-4" />固定回放</button>
          <button className={button} disabled={!artifacts} onClick={() => void run('reveal')}><FolderOpen className="h-4 w-4" />证据目录</button></div></div>
      <textarea aria-label="回归用例 JSON" className={input + ' min-h-48 font-mono text-xs'} value={draft} onChange={e => setDraft(e.target.value)} disabled={busy} placeholder="完成录制后显示用例；也可导入已有 Harness requirement JSON。" />
    </div>
  </section>;
}
