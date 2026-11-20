import { useLanguage } from '../language';
import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import ReplyKnowledgePanel from './ReplyKnowledgePanel';
import { modelOptions, type AgentModel } from './agent-turns';

type Settings = { device: string; contacts: string[]; textModel: string; visionModel: string; role: string; contextCount: number };
type Device = { serial: string; model?: string; state: string; kind?: string };
type Task = { status:string; reason:string|null; cleanupConfirmed:boolean; pending:boolean; processed:number };
type RecordItem = {id:string;status:string;reason?:string;text?:string;reply?:string};
type Evidence = {id:string;createdAt:string};
type Confirmation = {token:string;deviceId:string;contact:string;text:{address:string;model:string};vision:{address:string;model:string}|null;contextCount:number};
const taskErrors:Record<string,string> = {reply_configuration_required:'请先保存设备和文字模型。',reply_model_unavailable:'所选模型不可用，请检查设置。',reply_model_address_invalid:'模型地址无效，或包含用户名、密码、查询参数；请将凭据放在模型密钥设置中。',reply_confirmation_expired:'确认已失效，请重新检查启动信息。',reply_already_active:'已有任务正在执行。',reply_not_running:'请先启动受控测试。',reply_busy:'任务正在处理消息，请稍后再试。',send_requires_manual_review:'上次发送结果不明，请先核查，不能自动重发。',cleanup_recovery_required:'上次副屏尚未确认释放，请先恢复清理。',notification_unavailable:'通知读取服务未就绪。',android_setup_required:'SoloPi 设备控制服务未就绪。',conversation_identity_unconfirmed:'无法确认受控会话身份。',fixture_entry_unavailable:'受控测试页面不可用。',fixture_device_request_failed:'设备请求失败，请检查手机服务与权限。',pending_review_changed:'待核查记录已变化，请重新查看。',reply_task_failed:'任务未能启动，请检查设备、辅助功能与通知权限。',reply_evidence_unavailable:'无法读取或删除本地证据，请检查任务状态及本地文件权限。',reply_evidence_not_found:'证据记录已变化，请刷新后重试。'};
const englishStatus: Record<string, string> = { stopped: 'Idle', starting: 'Starting', running: 'Listening', paused: 'Paused' };
const statusText:Record<string,string> = {stopped:'未运行',starting:'正在启动',running:'监听中',paused:'已暂停'};
const evidenceErrors:Record<string,string> = {reply_evidence_unsafe:'证据位置或权限异常，无法删除。',reply_evidence_busy:'任务或待核查记录仍需这些证据，请先完成清理与核查。'};
const reasonText:Record<string,string> = {stopped:'已停止',notification_interrupted:'通知服务中断',conversation_identity_unconfirmed:'会话身份无法确认',message_history_unconfirmed:'消息历史发生变化',send_outcome_unknown:'发送结果不明，不能自动重发',cleanup_unconfirmed:'副屏清理未确认',processing_failed:'处理失败',fixture_simulation_failed:'模拟消息未确认，任务已停止，请检查受控页面',knowledge_records_unavailable:'知识库记录不可用，请检查知识库',state_storage_unavailable:'本地记录不可用',start_failed:'启动失败',session_duration_limit:'测试时长已到，需要重新启动'};
const initial: Settings = { device: '', contacts: [], textModel: '', visionModel: '', role: '', contextCount: 6 };

export default function ReplyAutomationSettings({ models, onClose, embedded = false }: { models: AgentModel[]; onClose?: () => void; embedded?: boolean }) {
  const { t } = useLanguage();
  const [settings, setSettings] = useState(initial);
  const [contacts, setContacts] = useState('');
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation|null>(null);
  const confirmationToken = useRef<string|null>(null);
  const mounted = useRef(true);
  const [task,setTask] = useState<Task>({status:'stopped',reason:null,cleanupConfirmed:true,pending:false,processed:0});
  const [taskLoaded,setTaskLoaded] = useState(false);
  const [history,setHistory] = useState<{history:RecordItem[];pending:RecordItem|null}>({history:[],pending:null});
  const [evidence,setEvidence] = useState<Evidence[]>([]);
  const [evidenceLoaded,setEvidenceLoaded] = useState(false);
  const [evidenceError,setEvidenceError] = useState('');
  const invoke = async (channel: string, payload?: unknown) => {
    const result = await window.glassbox?.ipcRenderer?.invoke(channel, payload);
    if (!result || result.success === false) throw new Error(taskErrors[result?.error] || evidenceErrors[result?.error] || t("操作失败，请检查本地配置及设备连接。", "Operation failed. Check local settings and the device connection."));
    return result;
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const token = confirmationToken.current;
      confirmationToken.current = null;
      if (token) void invoke('reply-task:cancel-fixture-confirmation', token).catch(() => {});
    };
  }, []);
  useEffect(() => {
    let active = true;
    void invoke('reply-settings:load').then(result => { if (active) { setSettings(result.value); setContacts(result.value.contacts.join('\n')); } }).catch(e => { if (active) setError(e.message); });
    void invoke('adb:list-devices').then(result => { if (active) setDevices(result.devices || []); }).catch(() => { if (active) setError(t("无法获取 Android 设备列表。", "Could not load Android devices.")); });
    const refresh = () => { void invoke('reply-task:status').then(result => {if (active) {setTask(result.value); setTaskLoaded(true);}}).catch(()=>{if (active) setTaskLoaded(false);}); void invoke('reply-task:history').then(result => {if (active) setHistory(result.value);}).catch(()=>{}); void invoke('reply-evidence:list').then(result => {if (active) {setEvidence(result.value); setEvidenceLoaded(true); setEvidenceError('');}}).catch(e=>{if (active) {setEvidenceLoaded(false); setEvidenceError(e.message);}}); };
    const changed = (_event:unknown, value:Task) => {if (active) {setTask(value); refresh();}};
    refresh(); window.glassbox?.ipcRenderer?.on('reply-task:changed',changed);
    return () => { active = false; window.glassbox?.ipcRenderer?.removeListener('reply-task:changed',changed); };
  }, []);
  const save = async () => {
    setBusy(true); setError(''); setSaved(false);
    try {
      const result = await invoke('reply-settings:save', { ...settings, contacts: contacts.split('\n').map(v => v.trim()).filter(Boolean) });
      setSettings(result.value); setContacts(result.value.contacts.join('\n')); setSaved(true);
    } catch (e) { setError(e instanceof Error ? e.message : t("保存失败。", "Could not save settings.")); }
    finally { setBusy(false); }
  };
  const command = async (channel:string, payload?:unknown) => {
    setBusy(true);setError('');
    try {const result=await invoke(channel,payload);if (channel !== 'reply-task:clear-history') setTask(result.value);
      setHistory((await invoke('reply-task:history')).value);
    } catch(e) {setError(e instanceof Error ? e.message : t("操作失败。", "Operation failed."));} finally {setBusy(false);}
  };
  const prepare = async () => {
    setBusy(true); setError(''); setConfirmation(null);
    try {
      const value:Confirmation = (await invoke('reply-task:prepare-fixture')).value;
      if (!mounted.current) { await invoke('reply-task:cancel-fixture-confirmation', value.token).catch(() => {}); return; }
      confirmationToken.current = value.token;
      setConfirmation(value);
    }
    catch(e) { if (mounted.current) setError(e instanceof Error ? e.message : t("无法准备启动信息。", "Could not prepare the test session.")); }
    finally { if (mounted.current) setBusy(false); }
  };
  const cancelConfirmation = () => {
    const token = confirmation?.token;
    confirmationToken.current = null;
    setConfirmation(null);
    if (token) void invoke('reply-task:cancel-fixture-confirmation', token).catch(() => {});
  };
  const startConfirmed = async () => {
    const token = confirmation?.token;
    confirmationToken.current = null;
    setConfirmation(null);
    if (token) await command('reply-task:start-fixture', token);
  };
  const refreshEvidence = async () => {
    setEvidence((await invoke('reply-evidence:list')).value);
    setEvidenceLoaded(true);
    setEvidenceError('');
  };
  const removeEvidence = async (item: Evidence) => {
    if (!window.confirm(t("确定删除这次运行的本地证据？此操作无法撤销。", "Permanently delete the local evidence for this run?"))) return;
    setBusy(true); setEvidenceError('');
    try { await invoke('reply-evidence:remove', item.id); await refreshEvidence(); }
    catch(e) { setEvidenceError(e instanceof Error ? e.message : t("删除证据失败。", "Could not delete evidence.")); }
    finally { setBusy(false); }
  };
  const evidenceRemovable = taskLoaded && !busy && ['stopped','paused'].includes(task.status) && task.cleanupConfirmed && !task.pending;
  const selectClass = 'mt-1 w-full rounded border border-slate-300 px-2 py-2 text-sm';
  const modelSelect = (label: string, key: 'textModel' | 'visionModel') => <label className="block text-xs text-slate-600">{label}<select value={settings[key]} onChange={e => { setSaved(false); setSettings({ ...settings, [key]: e.target.value }); }} className={selectClass}><option value="">{t("请选择模型", "Select a model")}</option>{settings[key] && !models.some(m => m.id === settings[key]) && <option value={settings[key]}>{t("已保存的模型不可用", "Saved model unavailable")}</option>}{modelOptions(models).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>;
  const content = <>
    <div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs text-slate-600">{t("Android 设备", "Android device")}<select value={settings.device} onChange={e => { setSaved(false); setSettings({ ...settings, device: e.target.value }); }} className={selectClass}><option value="">{t("请选择设备", "Select a device")}</option>{settings.device && !devices.some(d => d.serial === settings.device) && <option value={settings.device}>{t("已保存设备（未连接）", "Saved device (disconnected)")}</option>}{devices.map(d => <option key={d.serial} disabled={d.state !== 'device'} value={d.serial}>{d.model || d.serial} · {d.state}</option>)}</select></label>{modelSelect(t("文字模型", "Text model"), 'textModel')}{modelSelect(t("图片模型", "Image model"), 'visionModel')}<label className="block text-xs text-slate-600">{t("最近可见聊天文字条数", "Recent visible chat messages")}<input type="number" min={0} max={20} value={settings.contextCount} onChange={e => { setSaved(false); setSettings({ ...settings, contextCount: Number(e.target.value) }); }} className={selectClass}/></label></div>
    <label className="block text-xs text-slate-600">{t("允许的联系人（每行一个名称）", "Allowed contacts (one name per line)")}<textarea rows={3} value={contacts} onChange={e => { setSaved(false); setContacts(e.target.value); }} className={selectClass}/></label>
    <label className="block text-xs text-slate-600">{t("回复角色", "Reply persona")}<textarea rows={4} value={settings.role} maxLength={4000} onChange={e => { setSaved(false); setSettings({ ...settings, role: e.target.value }); }} className={selectClass}/></label>
    <p className="text-xs text-slate-500">{t("将来启用时，文字模型接收目标消息、所选范围内的聊天文字及命中的知识片段；图片模型仅接收目标图片和必要文字。配置和知识库保存在本机。", "When enabled, the text model receives the target message, selected chat context, and relevant knowledge excerpts. The image model receives the target image and required text. Settings and the knowledge base are stored locally.")}</p>
    <ReplyKnowledgePanel />
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}{saved && <p role="status" className="text-sm text-green-700">{t("配置已保存", "Settings saved")}</p>}
    <div className="border-t border-slate-200 pt-3 space-y-3"><div className="flex flex-wrap items-center gap-3"><button type="button" disabled={busy} onClick={() => void save()} className="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-40">{t("保存配置", "Save configuration")}</button><button type="button" disabled={busy || !saved || !!confirmation || ['starting','running'].includes(task.status)} onClick={() => void prepare()} className="rounded border px-3 py-2 text-sm disabled:opacity-40">{t("启动受控测试", "Start controlled test")}</button><button type="button" disabled={busy || task.status !== 'running'} onClick={() => void command('reply-task:simulate-arrival')} className="rounded border px-3 py-2 text-sm disabled:opacity-40">{t("模拟测试消息", "Simulate text message")}</button><button type="button" disabled={busy || task.status !== 'running'} onClick={() => void command('reply-task:simulate-image')} className="rounded border px-3 py-2 text-sm disabled:opacity-40">{t("模拟测试图片", "Simulate image message")}</button><button type="button" disabled={busy || !['starting','running'].includes(task.status)} onClick={() => void command('reply-task:stop')} className="rounded border px-3 py-2 text-sm disabled:opacity-40">{t("停止", "Stop")}</button><button type="button" disabled={busy || task.cleanupConfirmed || task.status === 'running'} onClick={() => void command('reply-task:recover')} className="rounded border px-3 py-2 text-sm disabled:opacity-40">{t("恢复清理", "Resume cleanup")}</button></div>
      {confirmation && <section aria-label={t("确认受控测试", "Confirm controlled test")} className="space-y-2 border-y border-slate-200 py-3 text-sm"><h3 className="font-semibold">{t("确认受控测试", "Confirm controlled test")}</h3><p>{t("设备：", "Device:")}{confirmation.deviceId}{t("；联系人：", "· Contact:")}{confirmation.contact}</p><p className="break-all">{t("文字模型：", "Text model:")}{confirmation.text.model} · {confirmation.text.address}</p><p className="break-all">{t("图片模型：", "Image model:")}{confirmation.vision ? `${confirmation.vision.model} · ${confirmation.vision.address}` : t("未配置，图片消息不会处理", "Unconfigured. Image messages will be skipped.")}</p><p>{t("文字模型接收合成消息、最近", "The text model receives the synthetic message, the last")} {confirmation.contextCount} {t("条可见聊天文字和命中的本地知识片段；图片模型仅接收目标测试图片。", "visible chat messages, and matching local knowledge. The image model receives only the selected test image.")}</p><div className="flex gap-2"><button type="button" disabled={busy} onClick={() => void startConfirmed()} className="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-40">{t("确认并启动", "Confirm and start")}</button><button type="button" disabled={busy} onClick={cancelConfirmation} className="rounded border px-3 py-2 text-sm disabled:opacity-40">{t("取消", "Cancel")}</button></div></section>}
      <p className="text-xs text-slate-500">{t("受控测试使用本地测试应用及虚构联系人，文字发给所选模型；不会监听或回复微信。真实微信尚未开放。", "The controlled test uses a local test app and fictional contacts. Test text is sent to the selected model. Live WeChat monitoring and replies are unavailable.")}</p>
      <p role="status" className="text-sm">{t(statusText[task.status] || task.status, englishStatus[task.status] || task.status)}{task.reason ? ` · ${reasonText[task.reason] || task.reason}` : ''} · {t(`已处理 ${task.processed} 条`, `Processed ${task.processed}`)}{task.pending ? t("· 发送结果待核查", " · Send outcome pending review") : ''}</p>
      <div className="flex justify-between items-center"><h3 className="text-sm font-semibold">{t("本地处理记录", "Local activity")}</h3><button type="button" disabled={busy || ['starting','running'].includes(task.status)} onClick={() => void command('reply-task:clear-history')} className="text-xs text-slate-600 disabled:opacity-40">{t("清理记录", "Cleanup history")}</button></div>
      {history.pending && <div className="space-y-1 text-xs text-amber-700"><p>{t("发送结果待核查，清理历史不会删除它。", "Send outcome pending review. Clearing history keeps this record.")}</p>{history.pending.text && <p className="break-words">{t("消息：", "Message:")}{history.pending.text}</p>}{history.pending.reply && <p className="break-words">{t("拟回复：", "Draft reply:")}{history.pending.reply}</p>}<button type="button" disabled={busy || !task.cleanupConfirmed || ['starting','running'].includes(task.status)} onClick={() => {if (window.confirm(t("确认已在设备上核查此记录？系统会保留结果未知状态，且不会重发。", "Mark this record as reviewed on the device? The result stays unknown and the message will not be resent."))) void command('reply-task:review-pending',{id:history.pending?.id});}} className="rounded border px-2 py-1 disabled:opacity-40">{t("标记已核查", "Mark reviewed")}</button></div>}
      {!history.history.length && <p className="text-xs text-slate-500">{t("暂无记录", "No records yet")}</p>}
      <ul className="divide-y divide-slate-100">{history.history.map((item,index)=><li key={`${item.id}-${index}`} className="py-2 text-xs"><div>{item.status === 'sent' ? t("已发送", "Sent") : item.status === 'reviewed' ? t("已核查，发送结果未知", "Reviewed. Send outcome unknown.") : item.reason === 'image_model_not_configured' ? t("已跳过：未配置图片模型", "Skipped. No image model configured.") : t("已跳过", "Skipped")}</div>{item.text && <div className="break-words text-slate-600">{t("消息：", "Message:")}{item.text}</div>}{item.reply && <div className="break-words text-slate-600">{t("回复：", "Reply:")}{item.reply}</div>}</li>)}</ul>
      <section aria-label={t("本地运行证据", "Local run artifacts")} className="space-y-2 border-t border-slate-200 pt-3">
        <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{t("本地运行证据", "Local run artifacts")}</h3><button type="button" disabled={busy} onClick={() => {setBusy(true); setEvidenceError(''); void refreshEvidence().catch(e => setEvidenceError(e instanceof Error ? e.message : t("无法读取证据。", "Could not load evidence."))).finally(() => setBusy(false));}} className="text-xs text-slate-600 disabled:opacity-40">{t("刷新", "Refresh")}</button></div>
        {evidenceError && <p role="alert" className="text-xs text-red-600">{evidenceError}</p>}
        {!evidenceLoaded && !evidenceError && <p className="text-xs text-slate-500">{t("正在读取证据", "Loading evidence")}</p>}
        {evidenceLoaded && !evidence.length && <p className="text-xs text-slate-500">{t("暂无可管理的证据", "No artifacts to manage")}</p>}
        {evidence.length > 0 && !evidenceRemovable && <p className="text-xs text-amber-700">{t("停止任务、确认副屏已清理并核查待处理发送后，才能删除证据。", "Stop the task, confirm that the secondary display was cleaned up, and review pending sends before deleting evidence.")}</p>}
        <ul className="divide-y divide-slate-100">{evidence.map((item,index) => <li key={item.id} className="flex items-center justify-between gap-2 py-2 text-xs"><span>{t("运行", "Run")} {index + 1} · {Number.isFinite(Date.parse(item.createdAt)) ? new Date(item.createdAt).toLocaleString() : t("时间不可用", "Time unavailable")}</span><button type="button" disabled={!evidenceRemovable} onClick={() => void removeEvidence(item)} aria-label={t(`删除运行 ${index + 1} 的本地证据`, `Delete local evidence for run ${index + 1}`)} title={t("删除这次运行的本地证据", "Delete local evidence for this run")} className="rounded p-1 text-red-600 disabled:opacity-40"><Trash2 size={14}/></button></li>)}</ul>
      </section>
    </div>
  </>;
  if (embedded) return <section className="min-w-0 space-y-4" aria-label={t("消息自动回复", "Automatic replies")}><div><h2 className="text-base font-semibold text-slate-900">{t("消息自动回复", "Automatic replies")} <span className="text-xs font-normal text-amber-700">{t("实验配置", "Experimental settings")}</span></h2><p className="mt-1 text-sm text-slate-500">{t("配置角色和知识库，先在受控测试应用验证。真实微信监听与发送尚未开放。", "Configure a reply persona and knowledge base, then verify them in the test app. Live WeChat monitoring and replies are unavailable.")}</p></div>{content}</section>;
  return <Dialog open onOpenChange={open => { if (!open) { cancelConfirmation(); onClose?.(); } }}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogTitle>{t("消息自动回复", "Automatic replies")} <span className="text-xs font-normal text-amber-700">{t("实验配置", "Experimental settings")}</span></DialogTitle><DialogDescription>{t("配置角色和知识库，先在受控测试应用验证。真实微信监听与发送尚未开放。", "Configure a reply persona and knowledge base, then verify them in the test app. Live WeChat monitoring and replies are unavailable.")}</DialogDescription>{content}</DialogContent></Dialog>;
}
