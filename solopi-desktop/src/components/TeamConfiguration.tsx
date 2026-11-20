import { useLanguage } from '../language';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Download, FileJson, GitBranch, Loader2, MonitorSmartphone, Play, Sparkles, Upload, XCircle } from 'lucide-react';
import { configurationDemos, capabilityDemos, type OnboardingDestination } from './OnboardingDemo';
import { OnboardingSpotlight } from './OnboardingSpotlight';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';

type Destination = OnboardingDestination;
type Props = { onNavigate: (where: Destination) => void; onDemonstrationChange?: (active:boolean)=>void };
type Step = { id: string; label: string; status: 'running' | 'success' | 'failed'; unchanged?: boolean; errorCode?: string };
type Bindings = {phoneSerials?: string[];glassesSerials?: string[];phoneDefaultPackage?: string;glassesDefaultPackage?: string};
type Status = {success: boolean;counts: {caseRepositories:number;quickActions:number;llmProviders:number;tts:boolean;phone:number;glasses:number;phonePackage:string;glassesPackage:string};deviceBindings:Bindings;showWelcome:boolean;onboarding?:{step:number;status:string;route?:'choice'|'team'|'manual';demoIndex?:number};lastImport?:{id:string;success:boolean;time:string;steps:Step[]}};
type Summary = {id:string;name:string;version:string;caseRepositories:number;shortcutRepositories:number;quickActions:number;llmProviders:number;tts:boolean;devices:boolean};
type Result = {success:boolean;canceled?:boolean;error?:string;summary?:Summary;steps?:Step[]};
async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  if (!window.glassbox?.ipcRenderer) throw Error('请在 solopi-desktop 桌面应用中打开此功能');
  return await window.glassbox.ipcRenderer.invoke(channel, payload) as T;
}
const button = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40';
const primary = button + ' !border-blue-600 !bg-blue-600 !text-white hover:!bg-blue-700';
function useStatus() {
  const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState('');
  const refresh=async()=>{try{setStatus(await invoke<Status>('team-config:status'));setError('');}catch(e){setError(String(e));}};
  useEffect(()=>{
    void refresh(); const ipc=window.glassbox?.ipcRenderer;
    const changed=()=>{void refresh();};ipc?.on('team-config:changed',changed);
    return ()=>ipc?.removeListener('team-config:changed',changed);
  },[]);
  return {status,error,refresh};
}
function Receipt({steps}:{steps:Step[]}) {
  const { t } = useLanguage();

  return <ol className="space-y-2" aria-live="polite">{steps.map(s=><li key={s.id} className="flex items-center gap-2 text-sm"><span className={s.status==='failed'?'text-red-600':'text-emerald-600'}>{s.status==='running'?<Loader2 className="h-4 w-4 animate-spin"/>:s.status==='success'?<Check className="h-4 w-4"/>:<XCircle className="h-4 w-4"/>}</span><span>{s.label}</span><span className="ml-auto text-xs text-slate-500">{s.status==='running'?t("进行中", "In progress"):s.status==='failed'?(s.errorCode||t("未完成", "Incomplete")):s.unchanged?t("保留已有", "Kept existing"):t("已保存", "Saved")}</span></li>)}</ol>;
}
function ConfigurationImport({onBusyChange=()=>{}}:{onBusyChange?:(busy:boolean)=>void}) {
  const { t } = useLanguage();
  const [manifest,setManifest]=useState(''),[summary,setSummary]=useState<Summary|null>(null),[fileName,setFileName]=useState('');
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[steps,setSteps]=useState<Step[]>([]),[overwrite,setOverwrite]=useState(true);
  const picker=useRef<HTMLInputElement>(null);
  useEffect(()=>{
    const ipc=window.glassbox?.ipcRenderer;
    const progress=(_e:unknown,s:Step)=>setSteps(old=>[...old.filter(x=>x.id!==s.id),s]);
    ipc?.on('team-config:progress',progress);return()=>ipc?.removeListener('team-config:progress',progress);
  },[]);
  const choose=async(file:File)=>{
    setManifest('');setSummary(null);setMessage('');setSteps([]);setFileName(file.name);
    if(file.size>5*1024*1024){setMessage(t("配置文件不能超过 5 MB", "The configuration file must be 5 MB or smaller."));return;}
    try{
      const content=await file.text();const r=await invoke<Result>('team-config:validate',{manifest:content});
      if(!r.success||!r.summary)throw Error(r.error||t("配置格式无效", "Invalid configuration format"));setManifest(content);setSummary(r.summary);
    }catch(e){setMessage(String(e));}
  };
  const apply=async()=>{
    setBusy(true);onBusyChange(true);setSteps([]);setMessage(t("模型、设备默认值、TTS 和本地快捷操作并发导入，再下载快捷仓库，最后导入用例与素材。", "Importing models, device defaults, TTS and local quick actions, followed by quick action repositories, test cases and assets."));
    try{const r=await invoke<Result>('team-config:import',{manifest,overwrite});if(r.steps)setSteps(r.steps);setMessage(r.success?t("团队配置已导入。可继续确认本机设备，也可直接浏览用例。", "Team configuration imported. Confirm your local devices or browse test cases."):r.error||t("导入未完成，已保存项目保留。", "Import incomplete. Saved items were kept."));}
    catch{setMessage(t("未收到导入结果，请先查看下方进度和当前配置。", "No import result received. Check the progress and current configuration below."));}
    finally{setBusy(false);onBusyChange(false);}
  };
  return <div className="space-y-4">
    <input ref={picker} type="file" accept=".json,application/json" className="hidden" aria-label={t("选择团队配置文件", "Choose a team configuration file")} disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)void choose(f);e.target.value='';}}/>
    <button disabled={busy} onClick={()=>picker.current?.click()} className="flex w-full items-center gap-4 rounded-2xl border border-dashed border-blue-300 bg-blue-50/50 p-5 text-left transition hover:bg-blue-50"><FileJson className="h-9 w-9 shrink-0 text-blue-600"/><span><strong className="block text-slate-900">{fileName || t('选择团队配置文件', 'Choose a team configuration file')}</strong><span className="mt-1 block text-xs text-slate-500">{t("一个 JSON，配置用例仓库、快捷操作、模型、TTS 和设备默认值", "Use one JSON file to configure test libraries, quick actions, models, text-to-speech, and device defaults.")}</span></span><Upload className="ml-auto h-5 w-5 text-blue-500"/></button>
    {summary&&<div className="rounded-2xl border border-slate-200 p-4"><div className="flex items-center justify-between"><strong>{summary.name}</strong><span className="font-mono text-xs text-slate-500">v{summary.version}</span></div><div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">{[[t("用例仓库", "Test repositories"),summary.caseRepositories],[t("快捷操作", "Quick actions"),summary.quickActions+summary.shortcutRepositories],[t("模型", "Models"),summary.llmProviders],['TTS',summary.tts?t("包含", "Included"):t("未提供", "Not included")],[t("设备 / 默认包", "Devices / default packages"),summary.devices?t("包含", "Included"):t("未提供", "Not included")]].map(([label,v])=><div key={label} className="rounded-lg bg-slate-50 px-2 py-3"><b className="block text-base text-slate-800">{v}</b><span className="text-slate-500">{label}</span></div>)}</div></div>}
    <label className="flex items-start gap-2 text-xs leading-5 text-slate-600"><input type="checkbox" checked={overwrite} disabled={busy} onChange={e=>setOverwrite(e.target.checked)} className="mt-1 accent-blue-600"/>{t("更新文件中指定的配置；取消勾选则保留同 ID / 同来源的已有项目。其他本地配置保留。", "Update the settings in this file. Clear this option to keep existing items with the same ID or source. Other local settings are preserved.")}</label>
    <p className="text-xs leading-5 text-slate-500">{t("覆盖导入时，文件给了 Key 就使用，没给就留空。不需要登录。导入只保存配置和脚本，不运行脚本、用例或模型请求。", "When overwriting, keys are imported if present and left blank otherwise. Import saves settings and scripts without running them or contacting a model.")}</p>
    <button className={primary} disabled={!manifest||busy} onClick={()=>void apply()}>{busy?<Loader2 className="h-4 w-4 animate-spin"/>:<Upload className="h-4 w-4"/>}{busy?t("正在导入", "Importing"):t("导入团队配置", "Import team configuration")}</button>
    {message&&<p role="status" className="text-sm leading-6 text-slate-600">{message}</p>}
    {!!steps.length&&<Receipt steps={steps}/>}
  </div>;
}
function CapabilityCards({status,onNavigate}:{status:Status|null;onNavigate:Props['onNavigate']}) {
  const { t } = useLanguage();
  const c=status?.counts;
  return <div className="grid gap-3 sm:grid-cols-2">{[
    {to:'cases' as const,title:t("浏览与运行用例", "Browse and run test cases"),detail:c?.caseRepositories?t(`${c.caseRepositories} 个 Git 用例库已配置；运行前按用例检查依赖`, `Git test repositories configured: ${c.caseRepositories}. Check each case’s dependencies before running it.`):t("可查看报告和本地用例；团队用例库尚未配置", "Local test cases and reports are available. A team test library has yet to be configured."),icon:GitBranch},
    {to:(c?.llmProviders?'agent':'model') as Destination,title:t("让 Agent 协助分析", "Analyze with the Agent"),detail:c?.llmProviders?t(`${c.llmProviders} 个模型已配置，连通性尚未验证`, `Models configured: ${c.llmProviders}. Connectivity has yet to be verified.`):t("模型可稍后配置，不影响浏览报告", "You can view reports before configuring a model."),icon:Sparkles},
    {to:'quick-actions' as const,title:t("一键执行常用操作", "Run common actions"),detail:c?.quickActions?t(`${c.quickActions} 项操作已保存，点击后才执行`, `Quick actions saved: ${c.quickActions}. Click an action to run it.`):t("可从团队文件导入，也可自行配置脚本", "Import actions from a team file or configure your own scripts."),icon:Play},
    {to:'device' as const,title:t("设备、性能与录屏", "Devices, performance, and recordings"),detail:t("确认在线设备后，按任务选择日志、性能和录屏", "Check that the device is online, then choose logs, performance metrics, and screen recordings for the run."),icon:MonitorSmartphone},
  ].map(x=><button key={x.to} className="group rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-blue-300 hover:shadow-sm" onClick={()=>onNavigate(x.to)}><x.icon className="mb-3 h-5 w-5 text-blue-600"/><strong className="block text-sm">{x.title}<ArrowRight className="float-right h-4 w-4 text-slate-400 transition group-hover:translate-x-1"/></strong><span className="mt-2 block text-xs leading-5 text-slate-500">{x.detail}</span></button>)}</div>;
}
export function TeamConfigurationPanel({onNavigate}:Props) {
  const { t } = useLanguage();
  const {status,error,refresh}=useStatus();
  const [includeKeys,setIncludeKeys]=useState(false),[name,setName]=useState(t("我的团队配置", "My team configuration")),[teamId,setTeamId]=useState('my-team'),[version,setVersion]=useState('1'),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{if(status?.lastImport?.id)setTeamId(status.lastImport.id);},[status?.lastImport?.id]);
  const exportFile=async()=>{
    setBusy(true);try{const r=await invoke<Result>('team-config:export',{includeKeys,name,version,id:teamId});setMessage(r.canceled?t("已取消导出", "Export canceled"):r.success?t("配置文件已导出", "Configuration exported"):r.error||t("导出失败", "Export failed"));}catch{setMessage(t("导出失败，请检查脚本来源文件是否仍存在。", "Export failed. Check that the original script files still exist."));}finally{setBusy(false);}
  };
  return <section className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><header className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-black">{t("团队配置，一次到位", "Team setup")}</h3><p className="mt-2 text-sm text-slate-500">{t("加入团队，或把当前配置交给下一位同事。", "Join a team or share your current setup with a teammate.")}</p></div><button className={button} onClick={()=>window.dispatchEvent(new Event('solopi-desktop:show-onboarding'))}>{t("入门引导", "Getting started")}</button></header>
    <ConfigurationImport onBusyChange={setBusy}/>
    <div className="space-y-3 border-t border-slate-100 pt-5"><h4 className="font-bold">{t("导出当前配置", "Export current configuration")}</h4><div className="flex flex-wrap gap-3"><input aria-label={t("团队配置 ID", "Team configuration ID")} className="w-40 rounded-xl border px-3 py-2 text-sm" value={teamId} onChange={e=>setTeamId(e.target.value)}/><input aria-label={t("团队配置名称", "Team configuration name")} className="rounded-xl border px-3 py-2 text-sm" value={name} onChange={e=>setName(e.target.value)}/><input aria-label={t("团队配置版本", "Team configuration version")} className="w-28 rounded-xl border px-3 py-2 text-sm" value={version} onChange={e=>setVersion(e.target.value)}/></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeKeys} onChange={e=>setIncludeKeys(e.target.checked)} className="accent-blue-600"/>{t("包含模型 Key、Git Token 和 TTS 请求头", "Include model keys, Git tokens, and TTS request headers")}</label><p className="text-xs leading-5 text-slate-500">{t("脚本正文、参数和请求模板将原样导出，请自行决定分享范围。设备连接地址、目录与系统工具路径不随包迁移。", "The export includes script content, parameters, and request templates as entered. Device addresses, directories, and system tool paths stay local.")}</p><button className={button} disabled={busy||!teamId.trim()||!name.trim()||!version.trim()} onClick={()=>void exportFile()}><Download className="h-4 w-4"/>{t("导出 JSON", "Export JSON")}</button>{message&&<p role="status" className="text-sm text-slate-600">{message}</p>}</div>
    <div className="border-t border-slate-100 pt-5"><div className="mb-3 flex items-center justify-between"><h4 className="font-bold">{t("配置后可以做什么", "What you can do")}</h4><button className="text-xs text-blue-600" onClick={()=>void refresh()}>{t("刷新状态", "Refresh status")}</button></div><CapabilityCards status={status} onNavigate={onNavigate}/>{error&&<p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}{status?.lastImport&&<div className="mt-4 rounded-xl bg-slate-50 p-4"><p className="mb-3 text-xs text-slate-500">{t("最近导入 ·", "Last import ·")} {new Date(status.lastImport.time).toLocaleString()} · {status.lastImport.success?t("完成", "Complete"):t("未全部完成", "Partially complete")}</p><Receipt steps={status.lastImport.steps}/></div>}</div>
  </section>;
}
function SetupAnimation({step}:{step:number}) {
  const { t } = useLanguage();

  return <div className="rounded-2xl bg-slate-950 px-5 py-7 text-white" aria-hidden="true"><style>{`@keyframes lw-setup-reveal{from{opacity:.25;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}.lw-setup-node{animation:lw-setup-reveal 700ms ease both}@media(prefers-reduced-motion:reduce){.lw-setup-node{animation:none}}`}</style><div className="flex items-center justify-between gap-2">{[FileJson,MonitorSmartphone,Play].map((Icon,i)=><div key={i} className="contents"><div className="lw-setup-node flex flex-col items-center gap-2" style={{animationDelay:`${i*140}ms`}}><span className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${i===step?'border-blue-300 bg-blue-500 text-white':'border-slate-600 bg-slate-800 text-slate-400'}`}><Icon className="h-6 w-6"/></span><span className="text-[11px]">{[t("导入配置", "Import configuration"),t("确认设备", "Confirm devices"),t("开始使用", "Get started")][i]}</span></div>{i<2&&<span className="h-px flex-1 bg-slate-600"/>}</div>)}</div></div>;
}
function DeviceMapping({onBusyChange}:{onBusyChange:(busy:boolean)=>void}) {
  const { t } = useLanguage();

  const {status,refresh}=useStatus();const [devices,setDevices]=useState<Array<{serial:string;state:string;model?:string}>>([]),[phone,setPhone]=useState(''),[glasses,setGlasses]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{setPhone(status?.deviceBindings.phoneSerials?.[0]||'');setGlasses(status?.deviceBindings.glassesSerials?.[0]||'');},[status]);
  const discover=async()=>{setBusy(true);onBusyChange(true);try{const r=await invoke<{devices:typeof devices;error?:string}>('adb:list-devices');setDevices(r.devices||[]);setMessage(r.error?t("设备读取失败，可稍后在设备管理中重试。", "Could not list devices. Try again later in Device Management."):r.devices.length?t("请选择本机设备角色。", "Choose roles for your local devices."):t("尚未检测到设备，可跳过，稍后连接。", "No devices detected. Skip this step to connect later."));}catch{setMessage(t("设备读取失败，可稍后配置。", "Could not list devices. You can configure them later."));}finally{setBusy(false);onBusyChange(false);}};
  const save=async()=>{setBusy(true);onBusyChange(true);try{const r=await invoke<Result>('team-config:devices',{deviceBindings:{phoneSerials:phone?[phone]:[],glassesSerials:glasses?[glasses]:[]}});setMessage(r.success?t("设备角色已保存；任务运行前仍会检查在线状态。", "Device roles saved. Connectivity will be checked before each run."):r.error||t("设备映射保存失败", "Could not save device mappings"));await refresh();}catch{setMessage(t("设备映射保存失败，请检查角色是否重复。", "Could not save device mappings. Check for duplicate roles."));}finally{setBusy(false);onBusyChange(false);}};
  return <div className="space-y-4"><p className="text-sm leading-6 text-slate-500">{t("团队里的设备可能不在这台电脑上。只在你点击检测时查询设备，不安装应用、不重启 ADB。", "Team devices may be connected to another computer. Detect only lists devices, without installing apps or restarting ADB.")}</p><button className={button} disabled={busy} onClick={()=>void discover()}>{busy?<Loader2 className="h-4 w-4 animate-spin"/>:<MonitorSmartphone className="h-4 w-4"/>}{t("检测已连接设备", "Detect connected devices")}</button><div className="grid grid-cols-2 gap-3">{[[t("手机", "Phone"),phone,setPhone],[t("眼镜", "Glasses"),glasses,setGlasses]].map(([label,value,setter])=><label key={String(label)} className="text-sm font-bold">{String(label)}<select aria-label={t(`${label}设备映射`, `${label} device mapping`)} value={String(value)} disabled={busy} onChange={e=>(setter as (v:string)=>void)(e.target.value)} className="mt-2 w-full rounded-xl border p-3 font-mono text-xs"><option value="">{t("暂不设置", "Set up later")}</option>{value&&!devices.some(d=>d.serial===value)&&<option value={String(value)}>{String(value)} {t("· 团队候选 / 未验证", "· Team device / unverified")}</option>}{devices.map(d=><option key={d.serial} value={d.serial} disabled={d.state!=='device'}>{d.model||d.serial} · {d.serial} · {d.state}</option>)}</select></label>)}</div><p className="text-xs text-slate-500">{t("默认包：手机", "Default packages: Phone")} {status?.counts.phonePackage||t("未配置", "Not configured")} {t("/ 眼镜", "/ Glasses")} {status?.counts.glassesPackage||t("未配置", "Not configured")}</p><button className={primary} disabled={busy||!!(phone&&phone===glasses)} onClick={()=>void save()}>{t("确认设备角色", "Confirm device roles")}</button>{phone&&phone===glasses&&<p role="alert" className="text-sm text-red-600">{t("手机和眼镜不能选择同一设备。", "Phone and glasses must be different devices.")}</p>}{message&&<p role="status" className="text-sm text-slate-600">{message}</p>}</div>;
}
export function TeamOnboarding({onNavigate,onDemonstrationChange}:Props) {
  const { t } = useLanguage();
  const {status}=useStatus();
  const [open,setOpen]=useState(false),[step,setStep]=useState(0),[route,setRoute]=useState<'choice'|'team'|'manual'>('choice');
  const [demoIndex,setDemoIndex]=useState(0),[preview,setPreview]=useState<keyof typeof capabilityDemos|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');const initial=useRef(false);
  useEffect(()=>{if(status&&!initial.current){initial.current=true;if(status.showWelcome||status.onboarding?.status==='active'){
    setStep(status.onboarding?.step||0);setRoute(status.onboarding?.route||(status.onboarding?'team':'choice'));
    setDemoIndex(Math.min(status.onboarding?.demoIndex||0,configurationDemos.length-1));setOpen(true);
  }}},[status]);
  // Keep the real application inaccessible; the dialog itself is portaled to body.
  useEffect(()=>{if(!open)return;const root=document.getElementById('root');if(!root)return;const previous=root.inert;root.inert=true;return()=>{root.inert=previous;};},[open]);
  useEffect(()=>{const show=()=>{setRoute('choice');setStep(0);setPreview(null);setError('');setOpen(true);};window.addEventListener('solopi-desktop:show-onboarding',show);return()=>window.removeEventListener('solopi-desktop:show-onboarding',show);},[]);
  const persist=async(next:number,action:'active'|'dismissed'|'completed',nextRoute=route,nextDemo=demoIndex)=>{
    setBusy(true);
    try{await invoke('team-config:onboarding',{step:next,status:action,route:nextRoute,demoIndex:nextDemo});setStep(next);setRoute(nextRoute);setDemoIndex(nextDemo);if(action!=='active')setOpen(false);setError('');return true;}
    catch{setError(t("未能保存引导进度，请重试。", "Could not save setup progress. Try again."));return false;}finally{setBusy(false);}
  };
  const demo=preview?capabilityDemos[preview]:route==='manual'?configurationDemos[demoIndex]:null;
  const demonstrationCallback=useRef(onDemonstrationChange);demonstrationCallback.current=onDemonstrationChange;
  const demonstrating=!!(open&&demo);
  useLayoutEffect(()=>{demonstrationCallback.current?.(demonstrating);return()=>{if(demonstrating)demonstrationCallback.current?.(false);};},[demonstrating]);
  if(open&&demo)return <OnboardingSpotlight key={demo.id} demo={demo} progress={preview ? t('使用演示', 'Feature tour') : t(`配置介绍 ${demoIndex+1}/${configurationDemos.length}`, `Setup tour ${demoIndex+1}/${configurationDemos.length}`)} onNavigate={onNavigate} busy={busy} error={error}
    onNext={()=>{if(preview)setPreview(null);else void persist(0,demoIndex===configurationDemos.length-1?'completed':'active','manual',Math.min(demoIndex+1,configurationDemos.length-1));}}
    onBack={()=>{if(preview)setPreview(null);else void persist(0,'active',demoIndex>0?'manual':'choice',Math.max(0,demoIndex-1));}}
    onExit={()=>void persist(step,'dismissed')} nextLabel={preview? t("返回开始使用", "Back to getting started"):demoIndex===configurationDemos.length-1? t("完成介绍", "Finish tour"): t("下一项", "Next")}/>;
  const titles=[t("把团队配置带过来", "Import your team configuration"),t("确认这台电脑的设备", "Confirm local devices"),t("从这里开始", "Get started")];
  return <Dialog open={open} onOpenChange={next=>{if(!next&&!busy)void persist(step,'dismissed');}}>
    <DialogContent overlayClassName="z-[200] bg-slate-950/60" className="z-[201] max-h-[90dvh] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto rounded-3xl p-6 sm:p-7" onKeyDown={e=>e.stopPropagation()} onEscapeKeyDown={e=>{if(busy)e.preventDefault();}} onPointerDownOutside={e=>e.preventDefault()}>
      <div className="pr-7"><span className="text-xs font-bold tracking-widest text-blue-600">solopi-desktop · {route==='team'?`${step+1} / 3`: t("欢迎使用", "Welcome")}</span>
        <DialogTitle className="mt-2 text-2xl font-black">{route==='choice'? t("欢迎使用 solopi-desktop", "Welcome to SoloPi Desktop"):titles[step]}</DialogTitle>
        <DialogDescription className="mt-2 text-sm leading-6">{route==='choice'? t("选择适合你的入门方式，稍后也可从设置中心重新打开引导。", "Choose how to get started. You can reopen this guide in Settings."):step===0? t("导入团队已有配置，再确认本机设备。", "Import your team configuration and confirm your local devices."):step===1? t("设备角色由你确认；只有点击检测时才查询设备。", "Confirm each device role. Device discovery starts when you choose Detect."): t("先看看各项能力怎么使用，再开始实际操作。", "Explore the features to get started.")}</DialogDescription>
      </div>
      {route==='choice'?<div className="grid gap-4 sm:grid-cols-2">
        <button type="button" aria-label={t("有团队配置文件", "I have a team configuration file")} disabled={busy} className="rounded-2xl border border-blue-200 bg-blue-50 p-6 text-left transition hover:border-blue-500 disabled:opacity-40" onClick={()=>void persist(0,'active','team',0)}><FileJson className="mb-4 h-8 w-8 text-blue-600"/><strong className="block text-lg">{t("有团队配置文件", "I have a team configuration file")}</strong><span className="mt-2 block text-sm leading-6 text-slate-600">{t("导入团队提供的 JSON，沿用已有模型、TTS、快捷操作和用例库配置。", "Import your team's JSON file to reuse its model, text-to-speech, quick action, and test library settings.")}</span></button>
        <button type="button" aria-label={t("无团队配置文件", "Set up manually")} disabled={busy} className="rounded-2xl border border-slate-200 bg-white p-6 text-left transition hover:border-blue-500 disabled:opacity-40" onClick={()=>void persist(0,'active','manual',0)}><Sparkles className="mb-4 h-8 w-8 text-blue-600"/><strong className="block text-lg">{t("无团队配置文件", "Set up manually")}</strong><span className="mt-2 block text-sm leading-6 text-slate-600">{t("在真实页面上跟随高亮和箭头，逐项了解配置入口和用途。", "Follow the guided tour to find the settings you need.")}</span></button>
      </div>:<><SetupAnimation key={step} step={step}/>{step===0?<ConfigurationImport onBusyChange={setBusy}/>:step===1?<DeviceMapping onBusyChange={setBusy}/>:<CapabilityCards status={status} onNavigate={where=>setPreview(where==='model'?'agent':where as keyof typeof capabilityDemos)}/>}</>}
      <footer className="mt-2 flex items-center justify-between gap-3 border-t border-slate-100 pt-4"><button className="text-sm text-slate-500" disabled={busy} onClick={()=>void persist(step,'dismissed')}>{t("暂时跳过", "Skip for now")}</button><div className="flex gap-2">
        {preview?<button className={primary} onClick={()=>setPreview(null)}>{t("返回开始使用", "Back to getting started")}</button>:route==='manual'?<><button className={button} disabled={busy} onClick={()=>void persist(0,'active',demoIndex>0?'manual':'choice',Math.max(0,demoIndex-1))}>{demoIndex>0? t("上一步", "Back"): t("返回选择", "Back to setup options")}</button><button className={primary} disabled={busy} onClick={()=>void persist(0,demoIndex===configurationDemos.length-1?'completed':'active','manual',Math.min(demoIndex+1,configurationDemos.length-1))}>{demoIndex===configurationDemos.length-1? t("完成介绍", "Finish tour"): t("下一项", "Next")}<ArrowRight className="h-4 w-4"/></button></>:route==='team'?<><button className={button} disabled={busy} onClick={()=>void persist(Math.max(0,step-1),'active',step===0?'choice':'team')}>{step>0? t("上一步", "Back"): t("返回选择", "Back to setup options")}</button><button className={primary} disabled={busy} onClick={()=>void persist(Math.min(step+1,2),step===2?'completed':'active')}>{step===2?t("开始使用", "Get started"):t("下一步", "Next")}<ArrowRight className="h-4 w-4"/></button></>:null}
      </div></footer>{error&&<p role="alert" className="text-sm text-red-600">{error}</p>}
    </DialogContent>
  </Dialog>;
}
