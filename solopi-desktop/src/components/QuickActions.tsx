import { useLanguage } from '../language';
import { useEffect, useMemo, useRef, useState } from 'react';
import { moveQuickAction } from '../lib/quickActionOrder';
import { sessionPresentation } from '../lib/quickActionPresentation';
import { QuickActionFeedback, QuickActionResult } from './QuickActionFeedback';
import { ChevronDown, ChevronUp, CircleHelp, Download, FileCode2, FolderOpen, Loader2, Play, Plus, Square, X } from 'lucide-react';
import { queryReadiness } from '../lib/quickActionStatus';

interface QuickActionsProps { phoneSerial: string; glassesSerial: string; phonePackage: string; glassesPackage: string; onManage: () => void }
type InputType = 'text' | 'number' | 'boolean' | 'select' | 'file' | 'directory' | 'multiline';
interface SelectOption { label: string; value: string }
interface ActionInput { key: string; label: string; type: InputType; required: boolean; userInput?: boolean; defaultValue: string; placeholder?: string; options?: Array<SelectOption | string> }
interface QueryConfig { enabled: boolean; args: string[]; resultPath: string; targetInputKey: string; rerunAfterExecute: boolean; showOnCard?: boolean }
interface QuickAction { showInToolbar?: boolean; sessionConfig?: { enabled: boolean; startArgs: string[]; stopArgs: string[]; exportArgs: string[] }; id: string; name: string; description: string; scriptPath: string; inputs: ActionInput[]; queryConfig?: QueryConfig }
interface IpcResult { success?: boolean; canceled?: boolean; error?: string; stdout?: string; stderr?: string; actions?: QuickAction[]; action?: QuickAction; importedActions?: QuickAction[]; path?: string; resultValue?: string; queryResult?: { resultValue?: string } }

const COLLAPSED_KEY = 'glassbox.quickActions.collapsed';
const VARIABLES = [
  ['{{phoneSerial}}', '当前手机 SN'], ['{{glassesSerial}}', '当前眼镜 SN'],
  ['{{phonePackage}}', '当前手机包名'], ['{{glassesPackage}}', '当前眼镜包名'],
  ['{{adbPath}}', '当前 ADB 路径'], ['{{outputDir}}', '本次执行产物目录'],
  ['{{appDataDir}}', 'solopi-desktop 用户数据目录'], ['{{platform}}', '当前系统'],
  ['{{arch}}', '当前 CPU 架构'], ['{{resourcesDir}}', 'solopi-desktop 内置资源目录'],
  ['{{inputs.参数名}}', '引用另一个表单参数'],
] as const;

function getIpcRenderer() {
  try { return window.glassbox?.ipcRenderer; } catch (_error) { return null; }
}

function getDefaultValues(action: QuickAction) {
  return Object.fromEntries(action.inputs.map((input) => [input.key, input.defaultValue || '']));
}

function conciseMessage(value: string) {
  const lines = value.split('\n').filter((line) => !/^Command failed:|^exitCode:|^signal:|^\[(?:stderr|stdout)\]/.test(line));
  return (lines.join('\n').trim() || value).slice(0, 800);
}

function normalizeOption(option: SelectOption | string): SelectOption {
  return typeof option === 'string' ? { label: option, value: option } : option;
}

export function QuickActions({ phoneSerial, glassesSerial, phonePackage, glassesPackage, onManage }: QuickActionsProps) {
  const { t } = useLanguage();
  const ipcRenderer = useMemo(getIpcRenderer, []);
  const [actions, setActions] = useState<QuickAction[]>([]);
  const dragId = useRef('');
  const suppressClickUntil = useRef(0);
  const reorderLock = useRef(false);
  const [draggingId, setDraggingId] = useState('');
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
  const [reordering, setReordering] = useState(false);
  const endDrag = () => {
    dragId.current = ''; setDraggingId(''); setDropTarget(null);
    suppressClickUntil.current = Date.now() + 300;
  };
  const dropAction = async (targetId: string, after: boolean) => {
    const sourceId = dragId.current;
    endDrag();
    if (!ipcRenderer || reorderLock.current || !sourceId) return;
    const next = moveQuickAction(actions, sourceId, targetId, after);
    if (next.every((action, index) => action.id === actions[index]?.id)) return;
    reorderLock.current = true; setReordering(true);
    try {
      const result = await ipcRenderer.invoke('quick-actions:reorder', { ids: next.map((action) => action.id) }) as IpcResult;
      if (!result.success) throw new Error(result.error || t("排序保存失败", "Could not save the action order"));
      setActions(result.actions || next);
      window.dispatchEvent(new Event('glassbox:quick-actions-changed'));
    } catch (error) {
      setFeedback({ type: 'error', message: t(`排序未保存：${error instanceof Error ? error.message : String(error)}`, `Order not saved: ${error instanceof Error ? error.message : String(error)}`) });
    } finally { reorderLock.current = false; setReordering(false); }
  };
  const [sessions, setSessions] = useState<Record<string, {status: string; device: string}>>({});
  const visibleActions = actions.filter((action) => action.showInToolbar !== false || sessions[action.id]);
  const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem(COLLAPSED_KEY) === 'true');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<QuickAction | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [runningId, setRunningId] = useState('');
  const [queryingId, setQueryingId] = useState('');
  const [currentQueryValue, setCurrentQueryValue] = useState('');
  const [queryWarning, setQueryWarning] = useState('');
  const [cardStates, setCardStates] = useState<Record<string, { text: string; loading?: boolean }>>({});
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [showVariables, setShowVariables] = useState(false);
  const [feedback, setFeedback] = useState<QuickActionResult | null>(null);

  useEffect(() => {
    if (!ipcRenderer) { setLoading(false); return; }
    const loadActions = () => void ipcRenderer.invoke('quick-actions:list').then((result: IpcResult) => {
      setActions(result.actions || []); setLoading(false);
      setSessions((result as IpcResult & {sessions?: typeof sessions}).sessions || {});
    });
    loadActions();
    const changed = () => { loadActions(); setRefreshVersion(v => v + 1); window.dispatchEvent(new Event('glassbox:device-state-refresh')); };
    ipcRenderer.on('quick-actions:changed', changed);
    window.addEventListener('glassbox:quick-actions-changed', loadActions);
    return () => { ipcRenderer.removeListener('quick-actions:changed', changed); window.removeEventListener('glassbox:quick-actions-changed', loadActions); };
  }, [ipcRenderer]);
  useEffect(() => { window.localStorage.setItem(COLLAPSED_KEY, String(collapsed)); }, [collapsed]);

  useEffect(() => {
    const refresh = () => setRefreshVersion((value) => value + 1);
    window.addEventListener('glassbox:device-state-refresh', refresh);
    return () => window.removeEventListener('glassbox:device-state-refresh', refresh);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const context = { phoneSerial, glassesSerial, phonePackage, glassesPackage };
    setCardStates({});
    const update = (id: string, text: string, loading = false) => {
      if (!cancelled) setCardStates((previous) => ({ ...previous, [id]: { text, loading } }));
    };
    // Sequential queries avoid flooding ADB; invalidated results never reach a new device.
    void (async () => {
      for (const action of actions) {
        if (action.showInToolbar === false) continue;
        if (cancelled) break;
        if (!action.queryConfig?.enabled || !action.queryConfig.showOnCard) continue;
        const defaults = getDefaultValues(action);
        const waiting = queryReadiness(action.queryConfig.args, defaults, context);
        if (waiting) { update(action.id, waiting); continue; }
        if (!ipcRenderer) { update(action.id, t("桌面接口不可用", "Desktop API unavailable")); continue; }
        update(action.id, t("查询中…", "Querying…"), true);
        try {
          const result = await ipcRenderer.invoke('quick-actions:query', { id: action.id, values: defaults, context }) as IpcResult;
          const raw = result.resultValue ?? '';
          const target = action.inputs.find((input) => input.key === action.queryConfig?.targetInputKey);
          const label = target?.options?.map(normalizeOption).find((option) => option.value === raw)?.label || raw;
          update(action.id, result.success ? `当前：${label || '空值'}` : `查询失败：${conciseMessage(result.error || '请检查查询配置')}`);
        } catch (error) { update(action.id, t(`查询失败：${String(error)}`, `Query failed: ${String(error)}`)); }
      }
    })();
    return () => { cancelled = true; };
  }, [actions, ipcRenderer, phoneSerial, glassesSerial, phonePackage, glassesPackage, refreshVersion]);

  const executeAction = async (action: QuickAction, inputValues: Record<string, string>) => {
    if (!ipcRenderer || runningId) return;
    setRunningId(action.id); setFeedback(null);
    try {
    const result = await ipcRenderer.invoke('quick-actions:execute', {
      id: action.id, values: inputValues, context: { phoneSerial, glassesSerial, phonePackage, glassesPackage },
    }) as IpcResult;
    setRunningId('');
    if (!result.success) { setFeedback({ type: 'error', title: action.name, message: conciseMessage(result.error || result.stderr || t("脚本执行失败", "Script failed")) }); return; }
    const verified = result.queryResult?.resultValue ? `\n当前状态：${result.queryResult.resultValue}` : '';
    setFeedback({ type: 'success', title: action.name, message: `${conciseMessage(result.stdout || result.stderr || t("脚本执行完成", "Script completed"))}${verified}`, outputDir: (result as IpcResult & { outputDir?: string }).outputDir });
    setSelected(null);
    window.dispatchEvent(new Event('glassbox:device-state-refresh'));
    } catch (error) { setFeedback({ type: 'error', title: action.name, message: conciseMessage(String(error)) }); }
    finally { setRunningId(''); window.dispatchEvent(new Event('glassbox:quick-actions-changed')); }
  };
  const execute = () => selected && executeAction(selected, values);

  const openAction = async (action: QuickAction) => {
    if (sessions[action.id]) { await executeAction(action, {}); return; }
    const defaultValues = getDefaultValues(action);
    setFeedback(null);
    setCurrentQueryValue('');
    setQueryWarning('');
    if (action.queryConfig?.enabled && ipcRenderer) {
      setQueryingId(action.id);
      try {
      const result = await ipcRenderer.invoke('quick-actions:query', {
        id: action.id,
        values: defaultValues,
        context: { phoneSerial, glassesSerial, phonePackage, glassesPackage },
      }) as IpcResult;
      if (!result.success) {
        throw new Error(t("无法读取当前状态，仍可手动填写参数并执行。请确认目标值后再操作。", "Could not read current state. You can enter arguments manually. Verify the target value before running."));
      }
      const resultValue = result.resultValue || '';
      const targetInput = action.inputs.find((input) => input.key === action.queryConfig?.targetInputKey);
      if (targetInput?.type === 'select' && !(targetInput.options || []).map(normalizeOption).some((option) => option.value === resultValue)) {
        throw new Error(t(`查询结果“${resultValue}”未匹配已配置选项，请手动选择目标值。`, `The query result “${resultValue}” did not match any configured options. Choose the target value manually.`));
      }
      setCurrentQueryValue(resultValue);
      if (action.queryConfig.targetInputKey) defaultValues[action.queryConfig.targetInputKey] = resultValue;
      } catch (_error) {
        setQueryWarning(t("当前状态未知（查询失败或结果未匹配），仍可手动选择目标值并执行。", "Current state is unknown. You can select the target value manually and run the action."));
        if (action.queryConfig.targetInputKey) defaultValues[action.queryConfig.targetInputKey] = '';
      } finally {
        setQueryingId('');
      }
    }
    setValues(defaultValues);
    setSelected(action);
  };

  const selectPath = async (input: ActionInput) => {
    if (!ipcRenderer) return;
    const result = await ipcRenderer.invoke('quick-actions:select-path', { type: input.type }) as IpcResult;
    if (result.success && result.path) setValues((current) => ({ ...current, [input.key]: result.path || '' }));
  };

  return <>
    <section className={collapsed ? 'relative h-0 shrink-0 overflow-visible' : 'shrink-0 border-b border-slate-200 bg-white px-3 py-2'} aria-label={t("快捷操作", "Quick Actions")}>
      {collapsed ? (
        <button type="button" onClick={() => setCollapsed(false)} className="absolute right-3 top-2 z-40 flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 shadow-md hover:bg-slate-50 hover:text-slate-700" title={t("展开快捷操作", "Expand Quick Actions")}><ChevronDown className="h-4 w-4" /></button>
      ) : <>
      <div className="flex min-w-0 items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto" aria-label={t("快捷操作列表", "Quick Actions list")} onDragOver={(event) => {
        if (!dragId.current) return;
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left + 48) event.currentTarget.scrollLeft -= 32;
        else if (event.clientX > bounds.right - 48) event.currentTarget.scrollLeft += 32;
      }}>
        {loading && <div className="flex h-11 items-center gap-2 px-3 text-xs font-bold text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />{t("正在读取快捷操作", "Loading Quick Actions")}</div>}
        {!loading && visibleActions.length === 0 && <div className="flex h-11 shrink-0 items-center px-3 text-xs font-bold text-slate-400">{t("在设置中点亮眼睛图标，即可展示快捷操作", "Show quick actions from Settings")}</div>}
        {visibleActions.map((action) => <div key={action.id} draggable={!reordering && !runningId && !queryingId} title={t("拖动调整顺序", "Drag to reorder")}
          onDragStart={(event) => { if (reorderLock.current) { event.preventDefault(); return; } dragId.current = action.id; setDraggingId(action.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-solopi-desktop-quick-action', action.id); }}
          onDragEnd={endDrag}
          onDragOver={(event) => { if (!dragId.current) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; const rect = event.currentTarget.getBoundingClientRect(); setDropTarget({ id: action.id, after: event.clientX > rect.left + rect.width / 2 }); }}
          onDrop={(event) => { if (!dragId.current) return; event.preventDefault(); event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); void dropAction(action.id, event.clientX > rect.left + rect.width / 2); }}
          className={`flex h-11 w-[220px] shrink-0 cursor-grab items-center rounded-xl border border-slate-200 bg-white shadow-sm hover:border-blue-200 hover:bg-blue-50/40 ${draggingId === action.id ? 'opacity-40' : ''} ${dropTarget?.id === action.id && draggingId !== action.id ? dropTarget.after ? 'border-r-4 border-r-blue-500' : 'border-l-4 border-l-blue-500' : ''}`}>
          <button type="button" onClick={() => { if (dragId.current || Date.now() < suppressClickUntil.current) return; void openAction(action); }} disabled={reordering || Boolean(runningId) || queryingId === action.id} className="flex min-w-0 flex-1 items-center gap-2 px-3 text-left disabled:cursor-wait">
            <span aria-label={action.sessionConfig?.enabled || sessions[action.id] ? sessionPresentation(sessions[action.id]?.status).subtitle : t("执行脚本", "Run script")} className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white ${sessions[action.id] ? 'bg-emerald-600' : 'bg-blue-600'}`}>
              {runningId === action.id || queryingId === action.id || cardStates[action.id]?.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : action.sessionConfig?.enabled || sessions[action.id] ? sessionPresentation(sessions[action.id]?.status).icon === 'download' ? <Download className="h-3.5 w-3.5" /> : sessionPresentation(sessions[action.id]?.status).icon === 'stop' ? <Square className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 fill-current" /> : <FileCode2 className="h-3.5 w-3.5" />}
            </span>
            <span className="min-w-0 flex-1"><span title={action.name} className="block truncate text-xs font-black text-slate-800">{action.name}</span>
              {(action.sessionConfig?.enabled || sessions[action.id]) ? <span title={sessions[action.id] ? t(`开始时设备：${sessions[action.id].device}`, `Starting device: ${sessions[action.id].device}`) : t("点击开始", "Click to start")} aria-live="polite" className="block truncate text-[10px] font-bold text-emerald-600">{runningId === action.id ? t("执行中…", "Running…") : sessionPresentation(sessions[action.id]?.status).subtitle}</span> : action.queryConfig?.enabled && action.queryConfig.showOnCard && <span title={cardStates[action.id]?.text} aria-live="polite" className="block truncate text-[10px] font-bold text-slate-500">{cardStates[action.id]?.text || t("等待查询", "Waiting for query")}</span>}
            </span>
          </button>
        </div>)}
        <button type="button" onClick={onManage} onDragOver={(event) => { if (dragId.current) { event.preventDefault(); setDropTarget({ id: actions[actions.length - 1]?.id || '', after: true }); } }} onDrop={(event) => { if (!dragId.current) return; event.preventDefault(); event.stopPropagation(); void dropAction(actions[actions.length - 1]?.id || '', true); }} className="flex h-11 shrink-0 items-center gap-2 rounded-xl border border-dashed border-blue-200 bg-blue-50 px-3 text-xs font-black text-blue-700 hover:bg-blue-100" title={t("前往设置中心添加快捷操作", "Add Quick Actions in Settings")}>
          <Plus className="h-4 w-4" />{t("添加脚本", "Add script")}
        </button>
        {reordering && <span role="status" className="shrink-0 text-xs text-slate-500">{t("保存顺序中…", "Saving order…")}</span>}
      </div>
        <button type="button" onClick={() => setCollapsed(true)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 hover:bg-slate-50 hover:text-slate-700" title={t("收起快捷操作", "Collapse Quick Actions")} aria-label={t("收起快捷操作", "Collapse Quick Actions")}><ChevronUp className="h-4 w-4" /></button>
      </div>

      </>}
    </section>
    <QuickActionFeedback feedback={feedback}
      busy={runningId ? `${actions.find((action) => action.id === runningId)?.name || t("快捷操作", "Quick Actions")} · ${sessions[runningId] ? '正在结束或导出，请稍候…' : '正在执行，请稍候…'}` : queryingId ? `${actions.find((action) => action.id === queryingId)?.name || t("快捷操作", "Quick Actions")} · 正在查询…` : ''}
      sessions={Object.entries(sessions).filter(([id]) => id !== runningId).map(([id, session]) => ({ id, name: actions.find((action) => action.id === id)?.name || t("快捷操作", "Quick Actions"), status: sessionPresentation(session.status).subtitle }))}
      onDismiss={() => setFeedback(null)} onOpenDirectory={(directory) => void ipcRenderer?.invoke('shell:open-path', directory)} />

    {selected && <Modal onClose={() => setSelected(null)}>
      <div className="flex items-start justify-between gap-4"><div><h2 className="text-base font-black text-slate-900">{selected.name}</h2><p className="mt-1 text-xs font-bold text-slate-400">{selected.description}</p></div><CloseButton onClick={() => setSelected(null)} /></div>
      {selected.queryConfig?.enabled && <div className="mt-4 flex items-center justify-between rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3"><span className="text-xs font-bold text-blue-600">查询到的当前状态</span><strong className="font-mono text-xs text-blue-800">{currentQueryValue || '未知'}</strong></div>}
      {queryWarning && <p role="alert" className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800">{queryWarning}</p>}
      <div className="mt-5 max-h-[55vh] space-y-4 overflow-auto pr-1">
        {selected.inputs.every((input) => input.userInput === false) && <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-center text-xs font-bold text-slate-500">{t("无需填写参数，将使用已配置的默认值执行。", "The action runs with its configured defaults.")}</div>}
        {selected.inputs.filter((input) => input.userInput !== false).map((input) => <div key={input.key}>
          <div className="mb-1.5 flex items-center justify-between gap-2"><label htmlFor={`quick-action-${input.key}`} className="text-xs font-black text-slate-700">{input.label}{input.required ? ' *' : ''}</label><span className="font-mono text-[10px] font-bold text-slate-400">{input.key}</span></div>
          {input.type === 'boolean' ? <label className="flex h-11 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-xs font-bold text-slate-600"><input id={`quick-action-${input.key}`} type="checkbox" checked={values[input.key] === 'true'} onChange={(event) => setValues((current) => ({ ...current, [input.key]: String(event.target.checked) }))} className="h-4 w-4 accent-blue-600" />{t("启用", "Enable")}</label>
          : input.type === 'select' ? <select id={`quick-action-${input.key}`} value={values[input.key] || ''} onChange={(event) => setValues((current) => ({ ...current, [input.key]: event.target.value }))} className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold outline-none focus:border-blue-300 focus:bg-white"><option value="">{t("请选择", "Select an option")}</option>{(input.options || []).map(normalizeOption).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          : input.type === 'multiline' ? <textarea id={`quick-action-${input.key}`} value={values[input.key] || ''} onChange={(event) => setValues((current) => ({ ...current, [input.key]: event.target.value }))} rows={4} placeholder={input.placeholder || t("可填写文字或 {{}} 变量", "Enter text or a {{}} variable")} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-blue-300 focus:bg-white" />
          : <div className="flex gap-2"><input id={`quick-action-${input.key}`} type={input.type === 'number' ? 'number' : 'text'} value={values[input.key] || ''} onChange={(event) => setValues((current) => ({ ...current, [input.key]: event.target.value }))} placeholder={input.placeholder || t("可直接填写值，也可使用 {{}} 变量", "Enter a value or a {{}} variable")} className="h-11 min-w-0 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold outline-none focus:border-blue-300 focus:bg-white" />{(input.type === 'file' || input.type === 'directory') && <button type="button" onClick={() => void selectPath(input)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 text-slate-500 hover:bg-blue-50 hover:text-blue-600" title={t("选择路径", "Choose path")}><FolderOpen className="h-4 w-4" /></button>}</div>}
        </div>)}
      </div>
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4"><button type="button" onClick={() => setShowVariables(true)} className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black text-blue-600 hover:bg-blue-50"><CircleHelp className="h-4 w-4" />{t("变量怎么写", "Variable syntax")}</button><button type="button" onClick={execute} disabled={runningId === selected.id} className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-black text-white hover:bg-blue-700 disabled:opacity-60">{runningId === selected.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}{runningId === selected.id ? t("执行中", "Running") : t("执行", "Run")}</button></div>
    </Modal>}

    {showVariables && <Modal onClose={() => setShowVariables(false)}><div className="flex items-center justify-between"><h2 className="text-base font-black text-slate-900">{t("内置变量", "Built-in variables")}</h2><CloseButton onClick={() => setShowVariables(false)} /></div><p className="mt-1 text-xs font-bold leading-5 text-slate-400">{t("变量可以写在参数默认值或执行时输入值中，运行前由 solopi-desktop 替换。脚本参数、控件和枚举统一在设置中心配置，不需要伴随配置文件。", "Use variables in default or runtime values. SoloPi Desktop resolves them before running. Configure script arguments, controls, and options in Settings.")}</p><div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">{VARIABLES.map(([variable, description]) => <div key={variable} className="grid grid-cols-[180px_1fr] gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0"><code className="text-xs font-black text-blue-700">{variable}</code><span className="text-xs font-bold text-slate-500">{description}</span></div>)}</div></Modal>}
  </>;
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  return <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/35 p-5 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}><div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl">{children}</div></div>;
}

function CloseButton({ onClick }: { onClick: () => void }) {
  const { t } = useLanguage();

  return <button type="button" onClick={onClick} className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100" aria-label={t("关闭", "Close")}><X className="h-4 w-4" /></button>;
}
