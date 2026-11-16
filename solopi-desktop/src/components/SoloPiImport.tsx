import { ArrowRight, CircleAlert, FilePlus2, LoaderCircle, Play, RefreshCw, Square, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import RecordingTargetFields from './RecordingTargetFields';
import { AutomationCase } from '@/lib/automationCase';

type Session = { id: string; serial: string; name: string; state: string; error: string; finished: boolean };
type Conversion = { testCase: AutomationCase; issues: Array<{ index: number; action: string; reason: string }>; operationCount: number };
type Api = { ipcRenderer: { invoke: (channel: string, ...args: unknown[]) => Promise<any> } }; // Electron's typed channel boundary validates payloads in main.

export default function SoloPiImport({ api, mode, phoneSerial, phonePackage, phoneRuntime = 'android', glassesSerial, onRefreshDevices, onImport, onClose }: {
  api: Api | null; mode: 'import' | 'record'; phoneSerial: string; phonePackage: string; phoneRuntime?: 'android' | 'harmony'; glassesSerial?: string; onRefreshDevices?: () => void; onImport: (value: AutomationCase) => void; onClose: () => void;
}) {
  const [name, setName] = useState('新录制用例');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [conversion, setConversion] = useState<Conversion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const operationRef = useRef(0);
  const [pendingAction, setPendingAction] = useState('');
  const [targetOverride, setTargetOverride] = useState<{ serial: string; packageName: string } | null>(null);
  const [permissionCheck, setPermissionCheck] = useState<{ root?: boolean; missing: Array<{ key: string; label: string; action: string }> } | null>(null);
  const recordingTarget = targetOverride || { serial: phoneSerial, packageName: phonePackage };
  const recordingSerial = recordingTarget.serial;
  const recordingPackage = recordingTarget.packageName;
  async function invoke(channel: string, value?: unknown) {
    if (!api) throw new Error('请在桌面应用中使用 SoloPi 导入/录制');
    const result = await api.ipcRenderer.invoke(channel, value);
    if (result.canceled) return null;
    if (!result.success) throw Object.assign(new Error(result.error || 'SoloPi 操作失败'), { permissionCheck: result.permissionCheck });
    return result;
  }
  async function refresh() {
    const result = await invoke('solopi:current');
    setSessions(result.sessions);
    return result;
  }
  useEffect(() => {
    let active = true;
    void invoke('solopi:current').then(result => {
      if (!active) return;
      setSessions(result.sessions);
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  async function work(action: () => Promise<void>, kind = 'work') {
    const operation = ++operationRef.current;
    setBusy(true); setPendingAction(kind); setError(''); setPermissionCheck(null);
    try { await action(); } catch (e) { if (operation === operationRef.current) { setError(e instanceof Error ? e.message : String(e)); if (e && typeof e === 'object' && 'permissionCheck' in e) setPermissionCheck(e.permissionCheck as typeof permissionCheck); } }
    finally { if (operation === operationRef.current) { setBusy(false); setPendingAction(''); } }
  }
  const activeSession = sessions.some(s => !s.finished);
  const blockingSession = sessions.some(s => !s.finished && s.state !== 'recovery-required');
  const startBlockReason = busy ? '正在处理录制，请稍候' : activeSession ? '已有尚未结束的录制会话，不能重复开始。完成手机操作后停止并转换，或放弃本次导入。' : conversion ? '请先保存或处理已转换的草稿' : phoneRuntime !== 'android' ? '当前录制组件仅支持 Android 手机' : !recordingSerial ? '未检测到在线手机，无法开始录制。请连接并解锁手机，确认 USB 调试已授权。' : !recordingPackage ? '请在顶部选择要录制的应用' : !name.trim() ? '请填写用例名称' : '';
  function startRecording(skipPermissionPrecheck = false) {
    if (startBlockReason) return;
    return work(async () => {
      try {
        const result = await invoke('solopi:record-start', { serial: recordingSerial, name, targetPackage: recordingPackage, startMode: 'app-launch', preparationShell: '', ...(skipPermissionPrecheck ? { skipPermissionPrecheck: true } : {}) });
        setSessionId(result.id);
      } finally { await refresh(); }
    }, 'start');
  }
  const primaryButton = 'inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-blue-600 bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:border-blue-700 hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none';
  const closeReason = busy ? '正在处理录制，请稍候' : blockingSession ? '请先停止或放弃录制，再关闭窗口' : '关闭窗口';
  const sessionLabels: Record<string, string> = { 'recovery-required': '需要恢复', starting: '准备录制', recording: '录制中', stopped: '已停止' };
  const field = 'mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900';
  return <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-950/40 p-6" role="dialog" aria-modal="true" aria-labelledby="solopi-import-title">
    <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
      <div className="flex items-center justify-between gap-4"><h2 id="solopi-import-title" className="text-lg font-bold">{mode === 'record' ? 'SoloPi 录制生成用例' : '导入 SoloPi 历史用例'}</h2>
        <button type="button" disabled={busy || blockingSession} onClick={onClose} aria-label="关闭录制窗口" title={closeReason} className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"><X className="h-4 w-4" /></button></div>
      <p className="my-3 text-sm text-slate-500">SoloPi 记录手机操作，每个操作转换为可编辑节点。不会从视频识别步骤，也不会自动补业务断言。输入内容默认移除。</p>
      {mode === 'import' && <button type="button" disabled={busy} className={primaryButton} onClick={() => void work(async () => {
        const source = await invoke('solopi:select-file'); if (!source) return;
        setConversion(await invoke('solopi:convert', { source: source.source }));
      })}>选择 SoloPi 导出的 JSON</button>}
      {mode === 'record' && <>
        <div className="my-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          <RecordingTargetFields api={api} target={recordingTarget} runtime={phoneRuntime} excludedSerial={glassesSerial} disabled={busy || activeSession} onChange={setTargetOverride} />
          <p className="mt-2 text-xs">默认沿用顶部设备与应用，可在这里临时调整本次录制。</p>
          <p className="mt-2 text-xs">Desktop 会检查所需权限；root 已授权的设备自动尝试补齐，仍缺权限时会提示处理，无需手动进入 SoloPi。</p>
          <p className="mt-2 text-xs">开始录制会重新打开目标应用，从应用首页开始。准备完成前请勿在手机操作；结束后点击“停止并转换”。</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 text-xs font-bold">用例名称<input className={field} value={name} onChange={e => setName(e.target.value)} /></label>
        </div>
        <button type="button" className={`mt-4 ${primaryButton}`} disabled={Boolean(startBlockReason)} title={startBlockReason || '开始录制'} aria-describedby={startBlockReason ? 'solopi-start-block-reason' : undefined} onClick={() => void startRecording()}><Play className="h-4 w-4" />开始录制</button>
        {startBlockReason && <div id="solopi-start-block-reason" role="status" className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <span className="flex min-w-0 flex-1 items-start gap-2"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{startBlockReason}</span>
          {!recordingSerial && onRefreshDevices && <button type="button" onClick={onRefreshDevices} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500"><RefreshCw className="h-3.5 w-3.5" />重新检测设备</button>}
        </div>}
      </>}
      {sessions.map(s => <div key={s.id} className={`mt-4 rounded-xl border p-4 ${s.state === 'recovery-required' ? 'border-amber-200 bg-amber-50/60' : 'border-blue-100 bg-blue-50/60'}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1"><p className="break-words text-sm font-bold text-slate-900">{s.name}</p><p className="mt-1 font-mono text-xs text-slate-500">{s.serial}</p></div>
          <span className={`shrink-0 rounded-full border px-2 py-1 text-xs font-bold ${s.state === 'recovery-required' ? 'border-amber-200 bg-amber-100 text-amber-800' : 'border-blue-100 bg-white text-blue-700'}`}>{sessionLabels[s.state] || s.state}</span>
        </div>
        {s.error && <p className="mt-3 flex items-start gap-2 text-sm text-red-600"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{s.error}</p>}
        {!s.finished && <p className="mt-2 text-xs leading-relaxed text-slate-600">完成手机操作后，点击“停止并转换”生成草稿；不需要保留时，选择“放弃本次导入”。</p>}
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <button type="button" disabled={busy} className={primaryButton} onClick={() => void work(async () => {
            const result = await invoke('solopi:record-stop', { id: s.id }); setSessionId(s.id); setConversion(result); await refresh();
          })}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : s.finished ? <RefreshCw className="h-4 w-4" /> : <Square className="h-4 w-4" />}{s.finished ? '重新读取录制用例' : '停止并转换'}{!busy && <ArrowRight className="h-4 w-4" />}</button>
          <button type="button" disabled={busy && (s.state !== 'recovery-required' || pendingAction === 'discard')} className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white px-3.5 py-2 text-sm font-semibold text-rose-600 transition-colors hover:border-rose-300 hover:bg-rose-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-500 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400" onClick={() => void work(async () => {
            const result = await invoke('solopi:record-discard', { id: s.id }); if (sessionId === s.id) { setConversion(null); setSessionId(''); } await refresh(); if (result?.warning) setError(result.warning);
          }, 'discard')}><Trash2 className="h-4 w-4" />放弃本次导入</button>
        </div>
        {!s.finished && <p className="mt-3 text-xs text-slate-500">{s.state === 'recovery-required' ? '可以直接关闭窗口；恢复会话会保留，再次打开后可继续处理。' : '请先停止或放弃本次录制，再关闭窗口。'}</p>}
      </div>)}
      {conversion && <div className="mt-4 rounded-lg border p-4">
        <p className="font-bold">{conversion.testCase.name} · {conversion.operationCount} 个操作 · {conversion.issues.length} 个待处理节点</p>
        <p className="mt-2 text-xs text-slate-500">保存为新草稿，不覆盖原用例。待处理节点完成修改或替换前禁止执行；转换成功也不代表业务测试通过。</p>
        <ul className="mt-2 max-h-40 overflow-auto text-sm text-amber-700">{conversion.issues.map(item => <li key={item.index}>{item.index + 1}. {item.action}：{item.reason}</li>)}</ul>
        <button type="button" disabled={busy || activeSession} className={`mt-3 ${primaryButton}`} onClick={() => void work(async () => {
          if (sessionId) await invoke('solopi:record-discard', { id: sessionId });
          onImport(conversion.testCase); onClose();
        })}><FilePlus2 className="h-4 w-4" />生成可编辑草稿</button>
      </div>}
      {busy && <p className="mt-3 text-sm text-blue-600" role="status">{pendingAction === 'discard' ? '正在放弃导入并释放本地会话…' : pendingAction === 'start' ? '正在检查权限并准备录制；准备完成前请勿操作手机…' : '正在等待 SoloPi 回执；失败会话可点击放弃取消等待…'}</p>}
      {permissionCheck && <div role="alertdialog" aria-modal="true" aria-labelledby="solopi-permissions-title" className="fixed inset-0 z-[170] flex items-center justify-center bg-slate-950/50 p-6">
        <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
          <h3 id="solopi-permissions-title" className="font-bold text-slate-900">SoloPi 权限未就绪</h3>
          <p className="mt-2 text-sm text-slate-600">{permissionCheck.root ? '已尝试使用 root 补齐权限，以下项目仍未通过手机端检查。' : '未取得可用的 root 授权，请在手机系统设置中处理以下项目。'}如果已经授权或系统检测不准确，可点击“我已授权，直接进入”，跳过本次 Desktop 权限预检。手机端实际缺失的权限仍可能导致启动失败。</p>
          <ul className="mt-3 space-y-3 text-sm">{permissionCheck.missing.map(item => <li key={item.key}><strong>{item.label}</strong><p className="text-slate-600">{item.action}</p></li>)}</ul>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" disabled={Boolean(startBlockReason)} className={primaryButton} onClick={() => void startRecording(true)}>我已授权，直接进入</button>
            <button type="button" disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600" onClick={() => setPermissionCheck(null)}>返回，处理后重新开始</button>
          </div>
        </div>
      </div>}
      {error && !sessions.some(s => s.error === error) && <p className="mt-3 whitespace-pre-wrap text-sm text-red-600" role="alert">{error}</p>}
    </div>
  </div>;
}
