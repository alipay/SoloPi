import { useLanguage } from '../language';
import { automaticArguments, usesAutomaticArguments, QuickActionArguments } from './QuickActionArguments';
import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Eye, FileCode2, FolderSearch, GitBranch, Upload, Loader2, Plus, Save, Trash2, XCircle } from 'lucide-react';

type InputType = 'text' | 'number' | 'boolean' | 'select' | 'file' | 'directory' | 'multiline';
interface SelectOption { label: string; value: string }
interface ActionInput { key: string; label: string; type: InputType; required: boolean; userInput?: boolean; defaultValue: string; placeholder?: string; options?: SelectOption[] }
interface QueryConfig { enabled: boolean; args: string[]; resultPath: string; targetInputKey: string; rerunAfterExecute: boolean; showOnCard?: boolean }
interface GitSource { key: string; repoUrl: string; branch: string; directory: string; relativePath: string }
interface QuickAction { showInToolbar?: boolean; gitSource?: GitSource; sessionConfig?: { enabled: boolean; startArgs: string[]; stopArgs: string[]; exportArgs: string[] }; id: string; name: string; description: string; usageInstructions?: string; scriptPath: string; inputs: ActionInput[]; args: string[]; queryConfig?: QueryConfig; metadataSource?: 'script-comments' | 'positional-arguments'; detectedInputCount?: number; userConfigured?: boolean }
interface IpcResult { success?: boolean; canceled?: boolean; error?: string; actions?: QuickAction[]; action?: QuickAction; importedActions?: QuickAction[] }

const INPUT_TYPES: Array<{ value: InputType; label: [string, string] }> = [
  { value: 'text', label: ['单行文本', 'Single-line text'] },
  { value: 'multiline', label: ['多行文本', 'Multiline text'] },
  { value: 'number', label: ['数字', 'Number'] },
  { value: 'boolean', label: ['开关', 'Toggle'] },
  { value: 'select', label: ['下拉选择', 'Dropdown'] },
  { value: 'file', label: ['文件', 'File'] },
  { value: 'directory', label: ['目录', 'Directory'] },
];
const EMPTY_QUERY: QueryConfig = { enabled: false, args: [], resultPath: '', targetInputKey: '', rerunAfterExecute: false };

function getIpcRenderer() {
  try { return window.glassbox?.ipcRenderer; } catch (_error) { return null; }
}

function notifyActionsChanged() {
  window.dispatchEvent(new Event('glassbox:quick-actions-changed'));
}

export function QuickActionsSettings() {
  const { t } = useLanguage();
  const ipcRenderer = useMemo(getIpcRenderer, []);
  const [advancedArgs, setAdvancedArgs] = useState(false);
  const [actions, setActions] = useState<QuickAction[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<QuickAction | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [gitForm, setGitForm] = useState(false);
  const [gitMode, setGitMode] = useState<'pull' | 'push'>('pull');
  const [repoUrl, setRepoUrl] = useState('');
  const [repoBranch, setRepoBranch] = useState('');
  const [repoDirectory, setRepoDirectory] = useState('');
  const [gitLoading, setGitLoading] = useState(false);
  const [visibilityBusy, setVisibilityBusy] = useState('');
  const repositories = [...new Map(actions.filter((action) => action.gitSource).map((action) => [action.gitSource!.key, action.gitSource!])).values()];
  const importGit = async (source = { repoUrl, branch: repoBranch, directory: repoDirectory }) => {
    if (!ipcRenderer || gitLoading) return;
    setGitLoading(true); setMessage(null);
    try {
      const result = await ipcRenderer.invoke('quick-actions:import-git', source) as IpcResult & { count?: number };
      if (!result.success) throw new Error(result.error || t("拉取失败", "Could not pull scripts"));
      setActions(result.actions || []);
      notifyActionsChanged();
      setMessage({ type: 'success', text: `已拉取 ${result.count || 0} 个脚本。点击名称前的眼睛图标，即可展示在顶部；已有参数配置保留。` });
    } catch (error) { setMessage({ type: 'error', text: error instanceof Error ? error.message : String(error) }); }
    finally { setGitLoading(false); }
  };
  const toggleVisibility = async (action: QuickAction) => {
    if (!ipcRenderer || visibilityBusy) return;
    setMessage(null);
    setVisibilityBusy(action.id);
    try {
      const result = await ipcRenderer.invoke('quick-actions:visibility', { id: action.id, show: action.showInToolbar === false }) as IpcResult;
      if (!result.success) throw new Error(result.error || t("修改展示状态失败", "Could not update visibility"));
      setActions(result.actions || []);
      notifyActionsChanged();
    } catch (error) { setMessage({ type: 'error', text: error instanceof Error ? error.message : String(error) }); }
    finally { setVisibilityBusy(''); }
  };
  const [saving, setSaving] = useState(false);
  const [reorderingId, setReorderingId] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const selectAction = (action: QuickAction) => {
    setSelectedId(action.id);
    const cloned = structuredClone(action);
    cloned.queryConfig = cloned.queryConfig || { ...EMPTY_QUERY };
    cloned.inputs = cloned.inputs.map((input) => ({
      ...input,
      options: (input.options || []).map((option) => typeof option === 'string' ? { label: option, value: option } : option),
    }));
    setAdvancedArgs(!usesAutomaticArguments(cloned.inputs, cloned.args));
    setDraft(cloned);
    setMessage(null);
  };

  useEffect(() => {
    if (!ipcRenderer) { setLoading(false); return; }
    void ipcRenderer.invoke('quick-actions:list').then((result: IpcResult) => {
      const next = result.actions || [];
      setActions(next);
      if (next[0]) selectAction(next[0]);
      setLoading(false);
    });
  }, [ipcRenderer]);

  useEffect(() => {
    if (!ipcRenderer) return;
    let canceled = false;
    const refreshOrder = () => void ipcRenderer.invoke('quick-actions:list').then((result: IpcResult) => {
      // Toolbar sorting must not discard an unsaved settings draft.
      if (!canceled && result.actions) setActions(result.actions);
    }).catch(() => {});
    ipcRenderer.on('quick-actions:changed', refreshOrder);
    window.addEventListener('glassbox:quick-actions-changed', refreshOrder);
    return () => { canceled = true; ipcRenderer.removeListener('quick-actions:changed', refreshOrder); window.removeEventListener('glassbox:quick-actions-changed', refreshOrder); };
  }, [ipcRenderer]);

  const importScript = async () => {
    if (!ipcRenderer) return;
    setImporting(true); setMessage(null);
    const result = await ipcRenderer.invoke('quick-actions:import-script') as IpcResult;
    setImporting(false);
    if (result.canceled) return;
    if (!result.success) { setMessage({ type: 'error', text: result.error || t("导入脚本失败", "Could not import script") }); return; }
    const next = result.actions || [];
    setActions(next);
    const imported = result.importedActions?.[0] || result.action;
    if (imported) selectAction(imported);
    notifyActionsChanged();
    setMessage({ type: 'success', text: `已添加 ${result.importedActions?.length || 1} 个快捷操作` });
  };

  const save = async () => {
    if (!ipcRenderer || !draft) return;
    setSaving(true); setMessage(null);
    const result = await ipcRenderer.invoke('quick-actions:update', {
      id: draft.id,
      name: draft.name,
      description: draft.description,
      usageInstructions: draft.usageInstructions || '',
      inputs: draft.inputs,
      args: advancedArgs ? draft.args : automaticArguments(draft.inputs),
      queryConfig: draft.queryConfig,
      sessionConfig: draft.sessionConfig,
    }) as IpcResult;
    setSaving(false);
    if (!result.success) { setMessage({ type: 'error', text: result.error || t("保存失败", "Could not save") }); return false; }
    setActions(result.actions || []);
    if (result.action) selectAction(result.action);
    notifyActionsChanged();
    setMessage({ type: 'success', text: t("快捷操作配置已保存", "Quick action settings saved") });
    return true;
  };

  const uploadGit = async () => {
    if (!ipcRenderer || !draft || gitLoading) return;
    setGitLoading(true); setMessage(null);
    try {
      if (!await save()) return;
      const result = await ipcRenderer.invoke('quick-actions:export-git', { id: draft.id, repoUrl, branch: repoBranch, directory: repoDirectory }) as IpcResult & { unchanged?: boolean; relativePath?: string };
      if (!result.success) throw new Error(result.error || t("上传失败", "Upload failed"));
      setMessage({ type: 'success', text: result.unchanged ? t("Git 中的脚本和配置已是最新，无需提交。", "The repository already has the current script and configuration.") : t(`已上传脚本及配置：${result.relativePath}`, `Uploaded script and configuration: ${result.relativePath}`) });
    } catch (error) { setMessage({ type: 'error', text: error instanceof Error ? error.message : String(error) }); }
    finally { setGitLoading(false); setSaving(false); }
  };

  const remove = async () => {
    if (!ipcRenderer || !draft || !window.confirm(t(`删除快捷操作“${draft.name}”？脚本文件不会被删除。`, `Remove the quick action “${draft.name}”? The script file is kept.`))) return;
    const result = await ipcRenderer.invoke('quick-actions:remove', { id: draft.id }) as IpcResult;
    if (!result.success) { setMessage({ type: 'error', text: result.error || t("删除失败", "Could not delete") }); return; }
    const next = result.actions || [];
    setActions(next);
    if (next[0]) selectAction(next[0]); else { setSelectedId(''); setDraft(null); }
    notifyActionsChanged();
    setMessage({ type: 'success', text: t("快捷操作已删除", "Quick action removed") });
  };

  const moveAction = async (index: number, direction: -1 | 1) => {
    if (!ipcRenderer) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= actions.length) return;
    const reordered = [...actions];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    setReorderingId(actions[index].id);
    setMessage(null);
    const result = await ipcRenderer.invoke('quick-actions:reorder', { ids: reordered.map((action) => action.id) }) as IpcResult;
    setReorderingId('');
    if (!result.success) { setMessage({ type: 'error', text: result.error || t("调整顺序失败", "Could not reorder actions") }); return; }
    setActions(result.actions || reordered);
    notifyActionsChanged();
    setMessage({ type: 'success', text: t("快捷操作顺序已保存", "Quick action order saved") });
  };

  const revealScript = async () => {
    if (!ipcRenderer || !draft?.scriptPath) return;
    setMessage(null);
    const result = await ipcRenderer.invoke('shell:show-item-in-folder', draft.scriptPath) as IpcResult;
    if (!result.success) setMessage({ type: 'error', text: result.error || t("无法打开脚本所在文件夹", "Could not open the script folder") });
  };

  const updateInput = (index: number, patch: Partial<ActionInput>) => {
    setDraft((current) => current ? {
      ...current,
      inputs: current.inputs.map((input, inputIndex) => inputIndex === index ? { ...input, ...patch } : input),
    } : current);
  };

  const renameInput = (index: number, nextKey: string) => {
    const previousKey = draft?.inputs[index]?.key;
    if (!draft || !previousKey) return;
    const replaceReference = (value: string) => value.split(`{{inputs.${previousKey}}}`).join(`{{inputs.${nextKey}}}`);
    setDraft({
      ...draft,
      inputs: draft.inputs.map((input, inputIndex) => inputIndex === index ? { ...input, key: nextKey } : input),
      args: draft.args.map(replaceReference),
      sessionConfig: draft.sessionConfig ? { ...draft.sessionConfig, startArgs: draft.sessionConfig.startArgs.map(replaceReference), stopArgs: draft.sessionConfig.stopArgs.map(replaceReference), exportArgs: draft.sessionConfig.exportArgs.map(replaceReference) } : undefined,
      queryConfig: draft.queryConfig ? {
        ...draft.queryConfig,
        args: draft.queryConfig.args.map(replaceReference),
        targetInputKey: draft.queryConfig.targetInputKey === previousKey ? nextKey : draft.queryConfig.targetInputKey,
      } : draft.queryConfig,
    });
  };

  const addInput = () => {
    if (!draft) return;
    let position = draft.inputs.length + 1;
    while (draft.inputs.some((input) => input.key === `param${position}`)) position += 1;
    const key = `param${position}`;
    setDraft({
      ...draft,
      inputs: [...draft.inputs, { key, label: `参数 ${position}`, type: 'text', required: false, defaultValue: '', placeholder: '', options: [] }],
    });
  };

  const removeInput = (index: number) => {
    if (!draft) return;
    const removedKey = draft.inputs[index]?.key;
    if (!removedKey) return;
    const reference = `{{inputs.${removedKey}}}`;
    setDraft({
      ...draft,
      inputs: draft.inputs.filter((_, inputIndex) => inputIndex !== index),
      args: draft.args.filter((argument) => argument.trim() !== reference),
      queryConfig: draft.queryConfig ? {
        ...draft.queryConfig,
        args: draft.queryConfig.args.filter((argument) => argument.trim() !== reference),
        targetInputKey: draft.queryConfig.targetInputKey === removedKey ? '' : draft.queryConfig.targetInputKey,
      } : draft.queryConfig,
    });
  };

  const updateOption = (inputIndex: number, optionIndex: number, patch: Partial<SelectOption>) => {
    const input = draft?.inputs[inputIndex];
    if (!input) return;
    const options = [...(input.options || [])];
    options[optionIndex] = { ...options[optionIndex], ...patch };
    updateInput(inputIndex, { options });
  };

  const moveOption = (inputIndex: number, optionIndex: number, direction: -1 | 1) => {
    const input = draft?.inputs[inputIndex];
    if (!input) return;
    const targetIndex = optionIndex + direction;
    const options = [...(input.options || [])];
    if (targetIndex < 0 || targetIndex >= options.length) return;
    [options[optionIndex], options[targetIndex]] = [options[targetIndex], options[optionIndex]];
    updateInput(inputIndex, { options });
  };

  return <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
      <div>
        <div className="flex items-center gap-2"><FileCode2 className="h-4 w-4 text-blue-600" /><h3 className="text-sm font-black text-slate-900">{t("快捷操作", "Quick actions")}</h3></div>
        <p className="mt-1 text-xs font-bold leading-5 text-slate-400">{t("在这里添加、删除和配置电脑脚本。工作区只展示并执行已配置的快捷操作。", "Add, remove, and configure scripts here. Configured actions appear in the workspace.")}</p>
      </div>
      <div className="flex shrink-0 gap-2"><button type="button" onClick={() => { setGitMode('pull'); setGitForm(!gitForm || gitMode !== 'pull'); }} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600"><GitBranch className="h-4 w-4" />{t("从 Git 拉取", "Pull from Git")}</button>
      <button type="button" disabled={!draft || gitLoading} onClick={() => { setGitMode('push'); setGitForm(true); if (draft?.gitSource) { setRepoUrl(draft.gitSource.repoUrl); setRepoBranch(draft.gitSource.branch); setRepoDirectory(draft.gitSource.directory); } }} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 disabled:opacity-50"><Upload className="h-4 w-4" />{t("上传到 Git", "Push to Git")}</button>
      <button type="button" onClick={importScript} disabled={importing} className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-black text-white hover:bg-blue-700 disabled:opacity-60">
        {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{t("新增快捷操作", "Add quick action")}
      </button></div>
    </div>

    {(gitForm || repositories.length > 0) && <div className="space-y-3 border-b border-slate-100 bg-slate-50/70 p-5">
      {gitForm && <div className="space-y-3">
        <p className="text-xs text-slate-500">{gitMode === 'push' ? `上传当前快捷操作「${draft?.name || ''}」的脚本及参数配置（包含默认值）。会先保存当前编辑；脚本依赖文件需自行放入仓库。使用系统 Git 凭据及提交身份，目标分支须已存在。` : t("使用电脑上的 Git 与已有 SSH / HTTPS 凭据。只拉取脚本，不执行；仅添加你信任的仓库。", "Uses local Git and existing SSH or HTTPS credentials. Scripts are fetched without running them. Add only repositories you trust.")}</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 text-xs font-bold">{t("Git 仓库地址", "Git repository URL")}<input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder={t("https://host/team/scripts.git 或 git@host:team/scripts.git", "https://host/team/scripts.git or git@host:team/scripts.git")} className="mt-1 w-full rounded-xl border p-3 font-normal" /></label>
          <label className="text-xs font-bold">{t("分支", "Branch")}{gitMode === 'push' ? t("（必填）", " (required)") : t("（可选）", " (optional)")}<input value={repoBranch} onChange={(e) => setRepoBranch(e.target.value)} placeholder={t("留空使用远端默认分支", "Leave blank to use the remote default branch")} className="mt-1 w-full rounded-xl border p-3 font-normal" /></label>
          <label className="text-xs font-bold">{t("脚本子目录（可选）", "Script subdirectory (optional)")}<input value={repoDirectory} onChange={(e) => setRepoDirectory(e.target.value)} placeholder={t("留空扫描整个仓库", "Leave blank to scan the whole repository")} className="mt-1 w-full rounded-xl border p-3 font-normal" /></label>
        </div>
        <button type="button" disabled={gitLoading || saving || !repoUrl.trim() || (gitMode === 'push' && (!draft || !repoBranch.trim()))} onClick={() => void (gitMode === 'push' ? uploadGit() : importGit())} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{gitLoading && <Loader2 className="h-4 w-4 animate-spin" />}{gitMode === 'push' ? t("保存并上传当前操作", "Save and upload action") : t("拉取脚本", "Pull scripts")}</button>
      </div>}
      {repositories.map((source) => <div key={source.key} className="flex items-center gap-3 rounded-xl border bg-white p-3"><GitBranch className="h-4 w-4 shrink-0 text-slate-400" /><span className="min-w-0 flex-1 truncate text-xs text-slate-600" title={source.repoUrl}>{source.repoUrl} · {source.branch || t("默认分支", "Default branch")}{source.directory ? ` / ${source.directory}` : ''}</span><button type="button" disabled={gitLoading} onClick={() => void importGit(source)} className="shrink-0 text-xs font-bold text-blue-600 disabled:opacity-50">{gitLoading ? t("拉取中…", "Pulling…") : t("拉取更新", "Pull updates")}</button></div>)}
    </div>}

    <div className="grid min-h-[480px] grid-cols-[240px_minmax(0,1fr)]">
      <div className="border-r border-slate-100 bg-slate-50/70 p-3">
        {loading ? <div className="flex items-center gap-2 px-3 py-4 text-xs font-bold text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />{t("正在读取", "Loading…")}</div>
          : actions.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-xs font-bold leading-5 text-slate-400">{t("还没有快捷操作", "No quick actions yet")}<br />{t("点击右上角选择脚本", "Select a script using the button above.")}</div>
          : <div className="space-y-2">{actions.map((action, index) => <div key={action.id} className={`group flex overflow-hidden rounded-2xl border transition-colors ${selectedId === action.id ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-white hover:border-blue-100'}`}>
            <button type="button" aria-label={t(`${action.showInToolbar === false ? '展示' : '隐藏'} ${action.name}`, `${action.showInToolbar === false ? 'Show' : 'Hide'} ${action.name}`)} aria-pressed={action.showInToolbar !== false} title={action.showInToolbar === false ? t("点击展示在顶部", "Show in toolbar") : t("点击从顶部隐藏", "Hide from toolbar")} disabled={Boolean(visibilityBusy)} onClick={() => void toggleVisibility(action)} className={`shrink-0 px-2 ${action.showInToolbar === false ? 'text-slate-300 hover:text-slate-500' : 'text-blue-600'} disabled:opacity-50`}><Eye className="h-4 w-4" /></button>
            <button type="button" onClick={() => selectAction(action)} className="min-w-0 flex-1 px-3 py-3 text-left">
              <div className={`truncate text-xs font-black ${selectedId === action.id ? 'text-blue-700' : 'text-slate-700'}`}>{action.name}</div>
              <div className="mt-1 truncate text-[10px] font-bold text-slate-400">{action.inputs.length} {t("个参数 · 第", "arguments · #")} {index + 1} {t("位", " ")}</div>
            </button>
            <div className={`flex w-8 shrink-0 flex-col border-l ${selectedId === action.id ? 'border-blue-100' : 'border-slate-100'}`}>
              <button type="button" onClick={() => void moveAction(index, -1)} disabled={index === 0 || Boolean(reorderingId)} className="flex flex-1 items-center justify-center text-slate-400 hover:bg-white/70 hover:text-blue-600 disabled:opacity-20" title={t("上移", "Move up")}><ChevronUp className={`h-3.5 w-3.5 ${reorderingId === action.id ? 'animate-pulse' : ''}`} /></button>
              <button type="button" onClick={() => void moveAction(index, 1)} disabled={index === actions.length - 1 || Boolean(reorderingId)} className="flex flex-1 items-center justify-center border-t border-inherit text-slate-400 hover:bg-white/70 hover:text-blue-600 disabled:opacity-20" title={t("下移", "Move down")}><ChevronDown className="h-3.5 w-3.5" /></button>
            </div>
          </div>)}</div>}
      </div>

      <div className="min-w-0 p-5">
        {!draft ? <div className="flex h-full items-center justify-center text-xs font-bold text-slate-400">{t("选择一个快捷操作进行配置", "Select a quick action to configure it.")}</div> : <>
          <div className="grid grid-cols-2 gap-4">
            <label className="block"><span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t("展示名称", "Display name")}</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none focus:border-blue-300 focus:bg-white" /></label>
            <label className="block"><span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t("脚本位置", "Script location")}</span><div className="mt-1.5 flex gap-2"><input value={draft.scriptPath} readOnly className="h-10 min-w-0 flex-1 truncate rounded-xl border border-slate-200 bg-slate-100 px-3 font-mono text-[11px] font-bold text-slate-500" /><button type="button" onClick={() => void revealScript()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600" title={t("在文件夹中显示", "Show in folder")} aria-label={t("在文件夹中显示", "Show in folder")}><FolderSearch className="h-4 w-4" /></button></div></label>
          </div>
          <label className="mt-4 block"><span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t("说明", "Description")}</span><input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none focus:border-blue-300 focus:bg-white" /></label>

          <label className="mt-4 block"><span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t("使用说明", "Usage instructions")}</span><textarea aria-label={t("快捷操作使用说明", "Quick action usage instructions")} maxLength={12000} value={draft.usageInstructions || ''} onChange={(event) => setDraft({ ...draft, usageInstructions: event.target.value })} placeholder={t("适用场景、前置条件、输入格式、副作用、成功判据及清理方式", "Use cases, prerequisites, input format, side effects, success criteria, and cleanup")} className="mt-1.5 min-h-28 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs outline-none focus:border-blue-300 focus:bg-white" /><span className="mt-1 block text-xs text-slate-500">{t("供使用者与 Agent 查阅。设备与包名的传参说明会根据实际参数配置自动生成。", "Shown to users and the Agent. Device and package argument details are generated from the configured fields.")}</span></label>
          {draft.metadataSource === 'positional-arguments' && !draft.userConfigured && <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div><p className="text-xs font-black">{t("仅从脚本识别到", "Detected")} {draft.detectedInputCount ?? draft.inputs.length} {t("个位置参数", "positional arguments in the script")}</p><p className="mt-1 text-[11px] font-bold leading-5 text-amber-700">{t("solopi-desktop 不知道这些参数的业务含义，也不会替你生成名称、枚举或环境配置。请按脚本实际用法在下方自行配置；不需要任何伴随配置文件。", "Configure names and options below based on how the script uses each argument. No companion configuration file is required.")}</p></div>
          </div>}

          <div className="mt-5 flex items-end justify-between gap-3"><div><h4 className="text-xs font-black text-slate-900">{t("参数表单", "Argument form")}</h4><p className="mt-1 text-[11px] font-bold text-slate-400">{t("按脚本真实用途配置参数。下拉选项的实际传值会原样交给脚本。", "Configure fields to match the script. The selected option value is passed to the script as entered.")}</p></div><div className="flex items-center gap-2"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-500">{draft.inputs.length} {t("个参数", "arguments")}</span><button type="button" onClick={addInput} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-black text-blue-600 hover:bg-blue-50"><Plus className="h-3 w-3" />{t("添加参数", "Add argument")}</button></div></div>
          <div className="mt-3 max-h-[360px] space-y-3 overflow-auto pr-1">
            {draft.inputs.length === 0 && <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-xs font-bold text-slate-400">{t("该脚本无需参数", "This script requires no arguments")}</div>}
            {draft.inputs.map((input, index) => <div key={`${index}-${input.key}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="grid grid-cols-[minmax(120px,0.8fr)_minmax(140px,1fr)_150px_auto] items-end gap-3">
                <label><span className="text-[10px] font-black text-slate-400">{t("参数名", "Parameter name")}</span><input value={input.key} onChange={(event) => renameInput(index, event.target.value)} className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-[11px] font-bold outline-none focus:border-blue-300" /></label>
                <label><span className="text-[10px] font-black text-slate-400">{t("展示名称", "Display name")}</span><input value={input.label} onChange={(event) => updateInput(index, { label: event.target.value })} className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none focus:border-blue-300" /></label>
                <label><span className="text-[10px] font-black text-slate-400">{t("输入控件", "Input type")}</span><select value={input.type} onChange={(event) => updateInput(index, { type: event.target.value as InputType })} className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none focus:border-blue-300">{INPUT_TYPES.map((type) => <option key={type.value} value={type.value}>{t(...type.label)}</option>)}</select></label>
                <div className="flex h-9 items-center gap-1"><label className="flex items-center gap-2 whitespace-nowrap text-xs font-bold text-slate-600"><input type="checkbox" checked={input.required} onChange={(event) => updateInput(index, { required: event.target.checked })} className="h-4 w-4 accent-blue-600" />{t("必填", "Required")}</label><button type="button" onClick={() => removeInput(index)} className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" title={t("删除参数", "Delete argument")}><Trash2 className="h-3.5 w-3.5" /></button></div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <label><span className="text-[10px] font-black text-slate-400">{t("默认值", "Default value")}</span><input value={input.defaultValue} onChange={(event) => updateInput(index, { defaultValue: event.target.value })} placeholder={t("支持 {{phoneSerial}} 等变量", "Supports variables such as {{phoneSerial}}")} className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none focus:border-blue-300" /></label>
                <label><span className="text-[10px] font-black text-slate-400">{t("输入提示", "Placeholder")}</span><input value={input.placeholder || ''} onChange={(event) => updateInput(index, { placeholder: event.target.value })} className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none focus:border-blue-300" /></label>
              </div>
              <label className="mt-3 flex items-center gap-2 text-xs font-bold text-slate-600"><input type="checkbox" checked={input.userInput !== false} onChange={(event) => updateInput(index, { userInput: event.target.checked })} className="h-4 w-4 accent-blue-600" />{t("用户填写", "User input")}<span className="text-[11px] font-medium text-slate-400">{t("关闭后在执行弹窗中隐藏，自动使用默认值或内置变量；必填校验仍生效。", "Disable to hide this field at runtime and use its default value or a built-in variable. Required validation still applies.")}</span></label>
              {input.type === 'select' && <div className="mt-3 border-t border-slate-200 pt-3">
                <div className="flex items-center justify-between"><span className="text-[10px] font-black text-slate-500">{t("下拉选项", "Dropdown options")}</span><button type="button" onClick={() => updateInput(index, { options: [...(input.options || []), { label: '新选项', value: '' }] })} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-black text-blue-600 hover:bg-blue-50"><Plus className="h-3 w-3" />{t("添加选项", "Add option")}</button></div>
                <div className="mt-2 space-y-2">{(input.options || []).map((option, optionIndex) => <div key={`${input.key}-${optionIndex}`} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                  <input value={option.label} onChange={(event) => updateOption(index, optionIndex, { label: event.target.value })} placeholder={t("展示名称", "Display name")} className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-bold outline-none focus:border-blue-300" />
                  <input value={option.value} onChange={(event) => updateOption(index, optionIndex, { value: event.target.value })} placeholder={t("实际传值", "Value passed to script")} className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 font-mono text-[11px] font-bold outline-none focus:border-blue-300" />
                  <div className="flex items-center"><button type="button" onClick={() => moveOption(index, optionIndex, -1)} disabled={optionIndex === 0} className="flex h-7 w-7 items-center justify-center text-slate-400 hover:text-blue-600 disabled:opacity-25" title={t("上移", "Move up")}><ChevronUp className="h-3.5 w-3.5" /></button><button type="button" onClick={() => moveOption(index, optionIndex, 1)} disabled={optionIndex === (input.options?.length || 0) - 1} className="flex h-7 w-7 items-center justify-center text-slate-400 hover:text-blue-600 disabled:opacity-25" title={t("下移", "Move down")}><ChevronDown className="h-3.5 w-3.5" /></button><button type="button" onClick={() => updateInput(index, { options: (input.options || []).filter((_, currentIndex) => currentIndex !== optionIndex) })} className="flex h-7 w-7 items-center justify-center text-slate-400 hover:text-rose-600" title={t("删除选项", "Delete option")}><Trash2 className="h-3.5 w-3.5" /></button></div>
                </div>)}</div>
              </div>}
            </div>)}
          </div>

          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={Boolean(draft.sessionConfig?.enabled)} onChange={(event) => setDraft({ ...draft, sessionConfig: { startArgs: ['start'], stopArgs: ['stop'], exportArgs: ['export'], ...draft.sessionConfig, enabled: event.target.checked }, queryConfig: { ...(draft.queryConfig || EMPTY_QUERY), enabled: false } })} />{t("开始／结束型快捷操作", "Start and stop action")}</label>
            {draft.sessionConfig?.enabled && <div className="mt-3 space-y-3"><p className="text-xs text-slate-500">{t("同一脚本通过不同参数处理三个阶段。开始时保存参数和设备，再次点击结束并导出；失败保留记录。", "Uses the same script with different arguments for each phase. Start saves the arguments and device. Run again to stop and export. Failed runs retain their records.")}</p>{(['startArgs', 'stopArgs', 'exportArgs'] as const).map((key, index) => <QuickActionArguments key={key} label={[t("开始参数", "Start arguments"), t("结束参数", "Stop arguments"), t("导出参数", "Export arguments")][index]} inputs={draft.inputs} args={draft.sessionConfig![key]} onChange={(args) => setDraft({ ...draft, sessionConfig: { ...draft.sessionConfig!, [key]: args } })} />)}</div>}
            <div className="flex items-start justify-between gap-4"><div><h4 className="text-xs font-black text-slate-900">{t("执行流程", "Execution flow")}</h4><p className="mt-1 text-[11px] font-bold leading-5 text-slate-400">{t("普通脚本直接执行；查询后操作会在打开表单前先运行同一脚本并回填状态。", "Run the script directly, or query current state with the same script before opening the form.")}</p></div><select value={draft.queryConfig?.enabled ? 'query' : 'single'} onChange={(event) => setDraft({ ...draft, queryConfig: { ...(draft.queryConfig || EMPTY_QUERY), enabled: event.target.value === 'query' } })} className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black outline-none focus:border-blue-300"><option value="single">{t("普通执行", "Run directly")}</option><option value="query">{t("查询后操作", "Query before running")}</option></select></div>

            {draft.queryConfig?.enabled && <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-200 pt-4">
              <label className="col-span-2 flex items-start gap-2 text-xs font-bold text-slate-600"><input type="checkbox" checked={Boolean(draft.queryConfig.showOnCard)} onChange={(event) => setDraft({ ...draft, queryConfig: { ...draft.queryConfig!, showOnCard: event.target.checked } })} />{t("在快捷卡片展示查询结果（参数齐全时自动运行查询；设备、包名变化及执行成功后刷新。请确保查询命令只读）", "Show query results on the action card. Refreshes when the device or package changes or after a successful run. Use a read-only query command.")}</label>
              <div className="col-span-2"><QuickActionArguments label={t("查询参数", "Query arguments")} inputs={draft.inputs} args={draft.queryConfig.args} onChange={(args) => setDraft({ ...draft, queryConfig: { ...draft.queryConfig!, args } })} /></div>
              <label><span className="text-[10px] font-black text-slate-400">{t("JSON 结果字段", "JSON result field")}</span><input value={draft.queryConfig.resultPath} onChange={(event) => setDraft({ ...draft, queryConfig: { ...draft.queryConfig!, resultPath: event.target.value } })} placeholder="currentEnvironment" className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-[11px] font-bold outline-none focus:border-blue-300" /></label>
              <label><span className="text-[10px] font-black text-slate-400">{t("回填到参数", "Populate argument")}</span><select value={draft.queryConfig.targetInputKey} onChange={(event) => setDraft({ ...draft, queryConfig: { ...draft.queryConfig!, targetInputKey: event.target.value } })} className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none focus:border-blue-300"><option value="">{t("请选择", "Select an option")}</option>{draft.inputs.map((input) => <option key={input.key} value={input.key}>{input.label}（{input.key}）</option>)}</select></label>
              <label className="col-span-2 flex items-center gap-2 text-xs font-bold text-slate-600"><input type="checkbox" checked={draft.queryConfig.rerunAfterExecute} onChange={(event) => setDraft({ ...draft, queryConfig: { ...draft.queryConfig!, rerunAfterExecute: event.target.checked } })} className="h-4 w-4 accent-blue-600" />{t("执行成功后重新查询，校验并展示最新状态", "Query again after a successful run to verify and show the latest state")}</label>
            </div>}

            <div className="mt-4 border-t border-slate-200 pt-4">
              {!draft.sessionConfig?.enabled && <><label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={advancedArgs} onChange={(event) => { if (!event.target.checked && !usesAutomaticArguments(draft.inputs, draft.args) && !window.confirm(t("切换为自动传参会替换已有的固定值和参数顺序，是否继续？", "Switching to automatic arguments replaces your fixed values and custom argument order. Continue?"))) return; setAdvancedArgs(event.target.checked); setDraft({ ...draft, args: automaticArguments(draft.inputs) }); }} />{t("高级传参配置", "Advanced arguments")}</label>
              {advancedArgs ? <div className="mt-3"><QuickActionArguments label={t("执行参数", "Run arguments")} inputs={draft.inputs} args={draft.args} onChange={(args) => setDraft({ ...draft, args })} /></div> : <p className="mt-2 text-xs text-slate-500">{t("自动按上方参数列表顺序传给脚本，无需填写执行参数。隐藏字段仍使用默认值；固定值或特殊顺序请开启高级配置。", "Fields are passed to the script in the order listed above. Hidden fields use their defaults. Enable advanced arguments for fixed values or a custom order.")}</p>}</>}
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
            <button type="button" onClick={remove} className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" />{t("删除快捷操作", "Remove quick action")}</button>
            <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-black text-white hover:bg-blue-700 disabled:opacity-60">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t("保存配置", "Save configuration")}</button>
          </div>
        </>}
      </div>
    </div>
    {message && <div className={`mx-5 mb-5 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{message.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}{message.text}</div>}
  </section>;
}
