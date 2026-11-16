import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Download, FileJson, GitBranch, Loader2, MonitorSmartphone, Play, Sparkles, Upload, XCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';

type Destination = 'team' | 'device' | 'model' | 'tts' | 'quick-actions' | 'cases' | 'agent';
type Props = { onNavigate: (where: Destination) => void };
type Step = { id: string; label: string; status: 'running' | 'success' | 'failed'; unchanged?: boolean; errorCode?: string };
type Bindings = {phoneSerials?: string[];glassesSerials?: string[];phoneDefaultPackage?: string;glassesDefaultPackage?: string};
type Status = {success: boolean;counts: {caseRepositories:number;quickActions:number;llmProviders:number;tts:boolean;phone:number;glasses:number;phonePackage:string;glassesPackage:string};deviceBindings:Bindings;showWelcome:boolean;onboarding?:{step:number;status:string};lastImport?:{id:string;success:boolean;time:string;steps:Step[]}};
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
  return <ol className="space-y-2" aria-live="polite">{steps.map(s=><li key={s.id} className="flex items-center gap-2 text-sm"><span className={s.status==='failed'?'text-red-600':'text-emerald-600'}>{s.status==='running'?<Loader2 className="h-4 w-4 animate-spin"/>:s.status==='success'?<Check className="h-4 w-4"/>:<XCircle className="h-4 w-4"/>}</span><span>{s.label}</span><span className="ml-auto text-xs text-slate-500">{s.status==='running'?'进行中':s.status==='failed'?(s.errorCode||'未完成'):s.unchanged?'保留已有':'已保存'}</span></li>)}</ol>;
}
function ConfigurationImport({onBusyChange=()=>{}}:{onBusyChange?:(busy:boolean)=>void}) {
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
    if(file.size>5*1024*1024){setMessage('配置文件不能超过 5 MB');return;}
    try{
      const content=await file.text();const r=await invoke<Result>('team-config:validate',{manifest:content});
      if(!r.success||!r.summary)throw Error(r.error||'配置格式无效');setManifest(content);setSummary(r.summary);
    }catch(e){setMessage(String(e));}
  };
  const apply=async()=>{
    setBusy(true);onBusyChange(true);setSteps([]);setMessage('正在导入，仓库下载可能需要一些时间。');
    try{const r=await invoke<Result>('team-config:import',{manifest,overwrite});if(r.steps)setSteps(r.steps);setMessage(r.success?'团队配置已导入。可继续确认本机设备，也可直接浏览用例。':r.error||'导入未完成，已保存项目保留。');}
    catch{setMessage('未收到导入结果，请先查看下方进度和当前配置。');}
    finally{setBusy(false);onBusyChange(false);}
  };
  return <div className="space-y-4">
    <input ref={picker} type="file" accept=".json,application/json" className="hidden" aria-label="选择团队配置文件" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)void choose(f);e.target.value='';}}/>
    <button disabled={busy} onClick={()=>picker.current?.click()} className="flex w-full items-center gap-4 rounded-2xl border border-dashed border-blue-300 bg-blue-50/50 p-5 text-left transition hover:bg-blue-50"><FileJson className="h-9 w-9 shrink-0 text-blue-600"/><span><strong className="block text-slate-900">{fileName||'选择团队配置文件'}</strong><span className="mt-1 block text-xs text-slate-500">一个 JSON，配置用例仓库、快捷操作、模型、TTS 和设备默认值</span></span><Upload className="ml-auto h-5 w-5 text-blue-500"/></button>
    {summary&&<div className="rounded-2xl border border-slate-200 p-4"><div className="flex items-center justify-between"><strong>{summary.name}</strong><span className="font-mono text-xs text-slate-500">v{summary.version}</span></div><div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">{[['用例仓库',summary.caseRepositories],['快捷操作',summary.quickActions+summary.shortcutRepositories],['模型',summary.llmProviders],['TTS',summary.tts?'包含':'未提供'],['设备 / 默认包',summary.devices?'包含':'未提供']].map(([label,v])=><div key={label} className="rounded-lg bg-slate-50 px-2 py-3"><b className="block text-base text-slate-800">{v}</b><span className="text-slate-500">{label}</span></div>)}</div></div>}
    <label className="flex items-start gap-2 text-xs leading-5 text-slate-600"><input type="checkbox" checked={overwrite} disabled={busy} onChange={e=>setOverwrite(e.target.checked)} className="mt-1 accent-blue-600"/>更新文件中指定的配置；取消勾选则保留同 ID / 同来源的已有项目。其他本地配置保留。</label>
    <p className="text-xs leading-5 text-slate-500">覆盖导入时，文件给了 Key 就使用，没给就留空。不需要登录。导入只保存配置和脚本，不运行脚本、用例或模型请求。</p>
    <button className={primary} disabled={!manifest||busy} onClick={()=>void apply()}>{busy?<Loader2 className="h-4 w-4 animate-spin"/>:<Upload className="h-4 w-4"/>}{busy?'正在导入':'导入团队配置'}</button>
    {message&&<p role="status" className="text-sm leading-6 text-slate-600">{message}</p>}
    {!!steps.length&&<Receipt steps={steps}/>}
  </div>;
}
function CapabilityCards({status,onNavigate}:{status:Status|null;onNavigate:Props['onNavigate']}) {
  const c=status?.counts;
  return <div className="grid gap-3 sm:grid-cols-2">{[
    {to:'cases' as const,title:'浏览与运行用例',detail:c?.caseRepositories?`${c.caseRepositories} 个 Git 用例库已配置；运行前按用例检查依赖`:'可查看报告和本地用例；团队用例库尚未配置',icon:GitBranch},
    {to:(c?.llmProviders?'agent':'model') as Destination,title:'让 Agent 协助分析',detail:c?.llmProviders?`${c.llmProviders} 个模型已配置，连通性尚未验证`:'模型可稍后配置，不影响浏览报告',icon:Sparkles},
    {to:'quick-actions' as const,title:'一键执行常用操作',detail:c?.quickActions?`${c.quickActions} 项操作已保存，点击后才执行`:'可从团队文件导入，也可自行配置脚本',icon:Play},
    {to:'device' as const,title:'设备、性能与录屏',detail:'确认在线设备后，按任务选择日志、性能和录屏',icon:MonitorSmartphone},
  ].map(x=><button key={x.to} className="group rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-blue-300 hover:shadow-sm" onClick={()=>onNavigate(x.to)}><x.icon className="mb-3 h-5 w-5 text-blue-600"/><strong className="block text-sm">{x.title}<ArrowRight className="float-right h-4 w-4 text-slate-400 transition group-hover:translate-x-1"/></strong><span className="mt-2 block text-xs leading-5 text-slate-500">{x.detail}</span></button>)}</div>;
}
export function TeamConfigurationPanel({onNavigate}:Props) {
  const {status,error,refresh}=useStatus();
  const [includeKeys,setIncludeKeys]=useState(false),[name,setName]=useState('我的团队配置'),[teamId,setTeamId]=useState('my-team'),[version,setVersion]=useState('1'),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{if(status?.lastImport?.id)setTeamId(status.lastImport.id);},[status?.lastImport?.id]);
  const exportFile=async()=>{
    setBusy(true);try{const r=await invoke<Result>('team-config:export',{includeKeys,name,version,id:teamId});setMessage(r.canceled?'已取消导出':r.success?'配置文件已导出':r.error||'导出失败');}catch{setMessage('导出失败，请检查脚本来源文件是否仍存在。');}finally{setBusy(false);}
  };
  return <section className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><header className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-black">团队配置，一次到位</h3><p className="mt-2 text-sm text-slate-500">加入团队，或把当前配置交给下一位同事。</p></div><button className={button} onClick={()=>window.dispatchEvent(new Event('solopi-desktop:show-onboarding'))}>入门引导</button></header>
    <ConfigurationImport onBusyChange={setBusy}/>
    <div className="space-y-3 border-t border-slate-100 pt-5"><h4 className="font-bold">导出当前配置</h4><div className="flex flex-wrap gap-3"><input aria-label="团队配置 ID" className="w-40 rounded-xl border px-3 py-2 text-sm" value={teamId} onChange={e=>setTeamId(e.target.value)}/><input aria-label="团队配置名称" className="rounded-xl border px-3 py-2 text-sm" value={name} onChange={e=>setName(e.target.value)}/><input aria-label="团队配置版本" className="w-28 rounded-xl border px-3 py-2 text-sm" value={version} onChange={e=>setVersion(e.target.value)}/></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeKeys} onChange={e=>setIncludeKeys(e.target.checked)} className="accent-blue-600"/>包含模型 Key、Git Token 和 TTS 请求头</label><p className="text-xs leading-5 text-slate-500">脚本正文、参数和请求模板将原样导出，请自行决定分享范围。设备连接地址、目录与系统工具路径不随包迁移。</p><button className={button} disabled={busy||!teamId.trim()||!name.trim()||!version.trim()} onClick={()=>void exportFile()}><Download className="h-4 w-4"/>导出 JSON</button>{message&&<p role="status" className="text-sm text-slate-600">{message}</p>}</div>
    <div className="border-t border-slate-100 pt-5"><div className="mb-3 flex items-center justify-between"><h4 className="font-bold">配置后可以做什么</h4><button className="text-xs text-blue-600" onClick={()=>void refresh()}>刷新状态</button></div><CapabilityCards status={status} onNavigate={onNavigate}/>{error&&<p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}{status?.lastImport&&<div className="mt-4 rounded-xl bg-slate-50 p-4"><p className="mb-3 text-xs text-slate-500">最近导入 · {new Date(status.lastImport.time).toLocaleString()} · {status.lastImport.success?'完成':'未全部完成'}</p><Receipt steps={status.lastImport.steps}/></div>}</div>
  </section>;
}
function SetupAnimation({step}:{step:number}) {
  return <div className="rounded-2xl bg-slate-950 px-5 py-7 text-white" aria-hidden="true"><style>{`@keyframes lw-setup-reveal{from{opacity:.25;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}.lw-setup-node{animation:lw-setup-reveal 700ms ease both}@media(prefers-reduced-motion:reduce){.lw-setup-node{animation:none}}`}</style><div className="flex items-center justify-between gap-2">{[FileJson,MonitorSmartphone,Play].map((Icon,i)=><div key={i} className="contents"><div className="lw-setup-node flex flex-col items-center gap-2" style={{animationDelay:`${i*140}ms`}}><span className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${i===step?'border-blue-300 bg-blue-500 text-white':'border-slate-600 bg-slate-800 text-slate-400'}`}><Icon className="h-6 w-6"/></span><span className="text-[11px]">{['导入配置','确认设备','开始使用'][i]}</span></div>{i<2&&<span className="h-px flex-1 bg-slate-600"/>}</div>)}</div></div>;
}
function DeviceMapping({onBusyChange}:{onBusyChange:(busy:boolean)=>void}) {
  const {status,refresh}=useStatus();const [devices,setDevices]=useState<Array<{serial:string;state:string;model?:string}>>([]),[phone,setPhone]=useState(''),[glasses,setGlasses]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{setPhone(status?.deviceBindings.phoneSerials?.[0]||'');setGlasses(status?.deviceBindings.glassesSerials?.[0]||'');},[status]);
  const discover=async()=>{setBusy(true);onBusyChange(true);try{const r=await invoke<{devices:typeof devices;error?:string}>('adb:list-devices');setDevices(r.devices||[]);setMessage(r.error?'设备读取失败，可稍后在设备管理中重试。':r.devices.length?'请选择本机设备角色。':'尚未检测到设备，可跳过，稍后连接。');}catch{setMessage('设备读取失败，可稍后配置。');}finally{setBusy(false);onBusyChange(false);}};
  const save=async()=>{setBusy(true);onBusyChange(true);try{const r=await invoke<Result>('team-config:devices',{deviceBindings:{phoneSerials:phone?[phone]:[],glassesSerials:glasses?[glasses]:[]}});setMessage(r.success?'设备角色已保存；任务运行前仍会检查在线状态。':r.error||'设备映射保存失败');await refresh();}catch{setMessage('设备映射保存失败，请检查角色是否重复。');}finally{setBusy(false);onBusyChange(false);}};
  return <div className="space-y-4"><p className="text-sm leading-6 text-slate-500">团队里的设备可能不在这台电脑上。只在你点击检测时查询设备，不安装应用、不重启 ADB。</p><button className={button} disabled={busy} onClick={()=>void discover()}>{busy?<Loader2 className="h-4 w-4 animate-spin"/>:<MonitorSmartphone className="h-4 w-4"/>}检测已连接设备</button><div className="grid grid-cols-2 gap-3">{[['手机',phone,setPhone],['眼镜',glasses,setGlasses]].map(([label,value,setter])=><label key={String(label)} className="text-sm font-bold">{String(label)}<select aria-label={`${label}设备映射`} value={String(value)} disabled={busy} onChange={e=>(setter as (v:string)=>void)(e.target.value)} className="mt-2 w-full rounded-xl border p-3 font-mono text-xs"><option value="">暂不设置</option>{value&&!devices.some(d=>d.serial===value)&&<option value={String(value)}>{String(value)} · 团队候选 / 未验证</option>}{devices.map(d=><option key={d.serial} value={d.serial} disabled={d.state!=='device'}>{d.model||d.serial} · {d.serial} · {d.state}</option>)}</select></label>)}</div><p className="text-xs text-slate-500">默认包：手机 {status?.counts.phonePackage||'未配置'} / 眼镜 {status?.counts.glassesPackage||'未配置'}</p><button className={primary} disabled={busy||!!(phone&&phone===glasses)} onClick={()=>void save()}>确认设备角色</button>{phone&&phone===glasses&&<p role="alert" className="text-sm text-red-600">手机和眼镜不能选择同一设备。</p>}{message&&<p role="status" className="text-sm text-slate-600">{message}</p>}</div>;
}
export function TeamOnboarding({onNavigate}:Props) {
  const {status}=useStatus();const [open,setOpen]=useState(false),[step,setStep]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');const initial=useRef(false);
  useEffect(()=>{if(status&&!initial.current){initial.current=true;if(status.showWelcome||status.onboarding?.status==='active'){setStep(status.onboarding?.step||0);setOpen(true);if(!status.onboarding)void invoke('team-config:onboarding',{step:0,status:'active'}).catch(()=>setError('未能保存引导进度，可稍后重试。'));}}},[status]);
  useEffect(()=>{const show=()=>{setStep(status?.onboarding?.step||0);setOpen(true);};window.addEventListener('solopi-desktop:show-onboarding',show);return()=>window.removeEventListener('solopi-desktop:show-onboarding',show);},[status]);
  const persist=async(next:number,action:'active'|'dismissed'|'completed')=>{
    try{await invoke('team-config:onboarding',{step:next,status:action});setStep(next);if(action!=='active')setOpen(false);setError('');return true;}catch{setError('未能保存引导进度，请重试。');return false;}
  };
  const go=async(where:Destination)=>{if(await persist(step,'dismissed'))onNavigate(where);};
  return <Dialog open={open} onOpenChange={next=>{if(!next&&!busy)void persist(step,'dismissed');}}><DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-3xl p-6" onEscapeKeyDown={e=>{if(busy)e.preventDefault();}} onPointerDownOutside={e=>{if(busy)e.preventDefault();}}><div className="pr-7"><span className="text-xs font-bold tracking-widest text-blue-600">SoloPi Desktop · {step+1} / 3</span><DialogTitle className="mt-2 text-2xl font-black">{['把团队配置带过来','确认这台电脑的设备','从这里开始'][step]}</DialogTitle><DialogDescription className="mt-2 text-sm leading-6">{['不用从零填写。导入一次，完成常用配置。也可以跳过，稍后自行设置。','设备角色由你确认，模型和 TTS 不要求登录。','配置已保存不等于服务已验证。使用时只检查当前任务需要的依赖。'][step]}</DialogDescription></div><SetupAnimation key={step} step={step}/>{step===0?<ConfigurationImport onBusyChange={setBusy}/>:step===1?<DeviceMapping onBusyChange={setBusy}/>:<CapabilityCards status={status} onNavigate={where=>void go(where)}/>}<footer className="mt-2 flex items-center justify-between gap-3 border-t border-slate-100 pt-4"><button className="text-sm text-slate-500" disabled={busy} onClick={()=>void persist(step,'dismissed')}>暂时跳过</button><div className="flex gap-2">{step>0&&<button className={button} disabled={busy} onClick={()=>void persist(step-1,'active')}>上一步</button>}<button className={primary} disabled={busy} onClick={()=>void persist(Math.min(step+1,2),step===2?'completed':'active')}>{step===2?'开始使用':'下一步'}<ArrowRight className="h-4 w-4"/></button></div></footer>{error&&<p role="alert" className="text-sm text-red-600">{error}</p>}</DialogContent></Dialog>;
}
