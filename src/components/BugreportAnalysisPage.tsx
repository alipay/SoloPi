import { LoaderCircle } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { DeviceSerialSelect } from './DeviceSelectors';
import { useEffect, useRef, useState } from 'react';

type Evidence = { source: string; line: number; text: string };
type Point = { at: number | null; segment: string; sourceType: string; levelPercent: number | null; currentMa: number | null; voltageMv: number | null; temperatureC: number | null; state: string; evidence: Evidence };
type Event = { uid?:number|null;name?:string; at: number | null; segment: string; type: string; scope: string; evidence: Evidence };
type SensorUsage = {handle:number;name:string|null;type:string|null;durationMs:number|null;count:number|null;powerMa:number|null;estimatedMah:number|null;evidence:Evidence;definitionEvidence:Evidence|null};
type ActivitySummary = {sensors?:SensorUsage[];uid:number;section:number;period:{label:string;evidence:Evidence}|null;metrics:Array<{kind:string;durationMs:number|null;detail:string;evidence:Evidence}>};
type AppUsage = {uid:number;packages:string[];summaries:ActivitySummary[];events:Event[]};
type UidPower = {uid:number;totalMah:number;components:Array<{kind:string;mah:number}>;evidence:Evidence};
type PowerStatistics = {section:number;period:{label:string;evidence:Evidence}|null;onBatteryMs:number|null;totalMs:number|null;capacityMah:number|null;computedMah:number|null;actualDrain:string|null;global:Array<{kind:string;mah:number;evidence:Evidence}>;uidPower:UidPower[];warnings:string[]};
type Result = {
  source:string;capturedAt:number|null;timeBasis:string;duplicateCount:number;unplacedHealthCount:number;
  points:Point[];events:Event[];warnings:string[];coverage:{start:number;end:number}|null;
  applications:AppUsage[];statistics:PowerStatistics[];
};
type Job = { id: string; status: string; phase: string; error?: string; diagnostic?: string; result?: Result; outputDirectory?: string;reportKey?:string;sourcePath?:string;sourceName?:string;createdAt?:string };
const busy = (job: Job | null) => Boolean(job && ['collecting','parsing','saving'].includes(job.status));
const time = (at: number | null) => at === null ? '时间未校准' : new Date(at).toISOString().replace('T',' ').replace('Z','');
const inputTime = (at: number) => new Date(at).toISOString().slice(0,23);
const parseTime = (value: string) => value ? Date.parse(`${value}Z`) : NaN;
export function batteryDates(points:Point[],sourceType:string) {
  const days=new Map<string,{day:string;start:number;end:number;count:number}>();
  for(const p of points){if(p.sourceType!==sourceType||p.at===null||!Number.isFinite(p.at))continue;const day=new Date(p.at).toISOString().slice(0,10),item=days.get(day);if(item){item.start=Math.min(item.start,p.at);item.end=Math.max(item.end,p.at);item.count++;}else days.set(day,{day,start:p.at,end:p.at,count:1});}
  return [...days.values()].sort((a,b)=>a.day.localeCompare(b.day));
}
export function defaultBatteryDate(points:Point[],sourceType:string) {
  const days=batteryDates(points,sourceType),calibrated=days.filter(d=>Number(d.day.slice(0,4))>=2000);
  return [...(calibrated.length?calibrated:days)].sort((a,b)=>b.count-a.count||b.start-a.start)[0];
}
const stateName = (value: string) => ({charging:'充电',discharging:'放电',full:'已充满','not-charging':'未充电',unknown:'未知'}[value] || value);
async function invoke(channel: string, payload: unknown = {}): Promise<any> {
  const api = window.glassbox?.ipcRenderer;
  if (!api) throw Error('请在 solopi-desktop 桌面应用中使用');
  return api.invoke(channel,payload);
}
function EvidenceView({ evidence }: { evidence: Evidence }) {
  return <details className="mt-1 text-xs text-slate-500"><summary className="cursor-pointer break-all">{evidence.source}:{evidence.line}</summary><pre className="mt-2 whitespace-pre-wrap break-all rounded-lg bg-slate-100 p-2">{evidence.text}</pre></details>;
}
const batteryMetrics = [
  {key:'currentMa',label:'电流',unit:'mA',color:'#2563eb',axis:10},
  {key:'voltageMv',label:'电压',unit:'mV',color:'#8b5cf6',axis:90},
  {key:'temperatureC',label:'温度',unit:'°C',color:'#ef4444',axis:810},
  {key:'levelPercent',label:'电量',unit:'%',color:'#059669',axis:890},
] as const;
const resourceNames:Record<string,string>={screen:'屏幕',charging:'充电',plugged:'外部供电',camera:'摄像头',audio:'音频',wake_lock:'唤醒锁',running:'CPU 运行'};
export function nearbyActivities(events:Event[],at:number,dimension:'apps'|'resources') {
  return events.filter(e=>e.at!==null&&Number.isFinite(e.at)&&Math.abs(e.at-at)<=30000&&(dimension==='apps'?e.scope==='uid'&&typeof e.uid==='number':Boolean(resourceNames[e.type.replace(/^[+-]/,'')])||e.type.startsWith('供电:'))).sort((a,b)=>a.at!-b.at!);
}
export function NearbyActivity({at,events,applications}:{at:number;events:Event[];applications:AppUsage[]}) {
  const [tab,setTab]=useState<'apps'|'resources'>('apps'),[selectedAt,setSelectedAt]=useState<number|null>(null);
  const rows=nearbyActivities(events,at,tab);
  const groups=Array.from(new Set(rows.map(e=>e.at!))).map(timestamp=>({at:timestamp,events:rows.filter(e=>e.at===timestamp),position:(timestamp-(at-30000))/60000*100,lane:0}));
  const laneEnds:number[]=[];
  for(const group of groups){let lane=laneEnds.findIndex(end=>group.position-end>=4);if(lane<0)lane=laneEnds.length;laneEnds[lane]=group.position;group.lane=lane;}
  const selectedGroup=groups.find(g=>g.at===selectedAt),selectedIndex=groups.indexOf(selectedGroup!);
  const label=(e:Event)=>{const kind=e.type.replace(/^[+-]/,'');return `${resourceNames[kind]||({fg:'前台活动',top:'顶部应用',proc:'进程'} as Record<string,string>)[kind]||kind}${e.type.startsWith('+')?' · 开始':e.type.startsWith('-')?' · 结束':''}`;};
  const appLabel=(e:Event)=>typeof e.uid==='number'?`${applications.find(a=>a.uid===e.uid)?.packages.join(' / ')||e.name||'未提供包名'} · UID ${e.uid}`:'整机事件，未归属应用';
  return <><Dialog.Title className="font-semibold">附近活动分析</Dialog.Title><Dialog.Description className="mt-1 text-xs text-slate-500">{time(at)} 前后 30 秒。活动关联不代表耗电量或因果关系；未记录不等于未发生。</Dialog.Description>
    <div role="tablist" aria-label="附近活动维度" className="my-3 flex gap-2">{(['apps','resources'] as const).map(value=><button key={value} role="tab" aria-selected={tab===value} onClick={()=>{setTab(value);setSelectedAt(null);}} className={`rounded-lg px-3 py-2 text-sm ${tab===value?'bg-blue-600 text-white':'bg-slate-100'}`}>{value==='apps'?'附近应用活动':'附近耗电项活动'}</button>)}</div>
    <div role="tabpanel" className="max-h-[50dvh] overflow-y-auto">
      <div className="overflow-auto rounded-xl border bg-slate-50 p-4"><div className="relative mx-3 min-w-[420px]" style={{height:90+Math.max(1,laneEnds.length)*24}} aria-label="活动时间轴">
        <div className="absolute left-0 right-0 top-10 h-px bg-slate-300"/>
        <div data-current-time={at} className="pointer-events-none absolute bottom-5 top-1 border-l-2 border-rose-500" style={{left:'50%'}}><span className="absolute -top-1 -translate-x-1/2 whitespace-nowrap bg-slate-50 px-1 text-xs font-semibold text-rose-600">当前时刻</span></div>
        {groups.map(g=><button key={g.at} type="button" data-event-time={g.at} aria-label={`${time(g.at)}，${g.events.length} 条活动`} aria-pressed={selectedAt===g.at} onClick={()=>setSelectedAt(g.at)} className="absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600" style={{left:`${g.position}%`,top:40+g.lane*24}}><span className={`h-3 w-3 rounded-full border-2 border-white ${selectedAt===g.at?'bg-amber-500 ring-2 ring-amber-300':g.at===at?'bg-rose-500':'bg-blue-600'}`}/><span className="sr-only">{g.events.length} 条</span><span className="pointer-events-none absolute left-1/2 top-0 -z-0 w-px bg-blue-200" style={{height:g.lane*24,transform:'translateY(-100%)'}}/><title>{time(g.at)} · {g.events.length} 条活动</title></button>)}
        <div className="absolute bottom-0 left-0 right-0 flex justify-between text-[11px] text-slate-500"><span>{time(at-30000).slice(11,23)}</span><span>{time(at+30000).slice(11,23)}</span></div>
      </div></div>
      <p className="mt-2 text-xs text-slate-500">蓝点：活动 · 红线：当前时刻 · 橙点：已选活动。同一时刻合并，密集点纵向错开，横向位置按时间比例绘制。</p>
      {!rows.length?<p className="py-6 text-center text-sm text-slate-400">该时间范围暂无{tab==='apps'?'带 UID 的应用':'耗电项'}活动记录</p>:!selectedGroup?<p className="py-6 text-center text-sm text-slate-400">点击时间轴上的点查看详情 · {rows.length} 条活动</p>:<div className="mt-3 rounded-xl bg-slate-50 p-3" aria-live="polite"><div className="flex items-center justify-between gap-2 text-xs"><span className="font-mono">{time(selectedGroup.at)} · {selectedGroup.events.length} 条活动</span><div className="flex gap-2"><button disabled={selectedIndex===0} onClick={()=>setSelectedAt(groups[selectedIndex-1].at)} className="disabled:opacity-30">上一点</button><button disabled={selectedIndex===groups.length-1} onClick={()=>setSelectedAt(groups[selectedIndex+1].at)} className="disabled:opacity-30">下一点</button></div></div>{selectedGroup.events.map((e,i)=><div key={i} className="mt-3 border-t pt-3 text-sm"><div className="font-semibold">{label(e)}{typeof e.uid==='number'?` · UID ${e.uid}`:''}</div><details className="mt-1 text-xs text-slate-500"><summary className="cursor-pointer truncate">{appLabel(e)}</summary><div className="mt-1 break-all">{appLabel(e)}</div></details><EvidenceView evidence={e.evidence}/></div>)}</div>}
    </div></>;

}
export function BatteryPlot({points,start,end,metric,events=[],applications=[]}: {points:Point[];start:number;end:number;events?:Event[];applications?:AppUsage[];metric?:typeof batteryMetrics[number]['key']}) {
  const metrics=metric?batteryMetrics.filter(m=>m.key===metric):batteryMetrics;
  const title=metric?`电池${metrics[0].label}`:'电池综合趋势';
  const left=metric?70:175,right=metric?465:785;
  const [open,setOpen]=useState(false),[selected,setSelected]=useState(0),[activityAt,setActivityAt]=useState<number|null>(null);
  const visible=points.filter(p=>p.at!==null&&metrics.some(m=>typeof p[m.key]==='number'));
  const index=Math.min(selected,Math.max(0,visible.length-1)),point=visible[index];
  const series=metrics.map(metric=>{
    const samples=visible.filter(p=>typeof p[metric.key]==='number');
    const values=samples.map(p=>p[metric.key] as number);
    const min=values.length?Math.min(...values):0,max=values.length?Math.max(...values):1;
    const y=(value:number)=>max===min?160:270-(value-min)/(max-min)*220;
    const links:Array<[Point,Point]>=[];
    let previous:Point|null=null;
    for(const sample of points){
      if(sample.at===null||typeof sample[metric.key]!=='number'){previous=null;continue;}
      if(previous&&previous.segment===sample.segment&&previous.sourceType===sample.sourceType&&previous.state===sample.state&&sample.at>previous.at!&&sample.at-previous.at!<=60000)links.push([previous,sample]);
      previous=sample;
    }
    const runs:Point[][]=[];
    for(const [from,to] of links){
      const last=runs[runs.length-1];
      if(last?.[last.length-1]===from)last.push(to);else runs.push([from,to]);
    }
    return {...metric,samples,min,max,y,runs};
  });
  const legend=<div className="flex flex-wrap gap-x-5 gap-y-2 text-xs">{metrics.map(m=><span key={m.key} style={{color:m.color}}>{m.label} {m.unit}</span>)}<span className="text-slate-500">实线：放电 · 虚线：充电 · 点线：其他状态</span></div>;
  const plot=(expanded:boolean)=>{
    const plotRight=expanded&&metric?945:right;
    const x=(at:number)=>left+(at-start)/Math.max(1,end-start)*(plotRight-left);
    return !visible.length?<p className="py-16 text-center text-sm text-slate-400">所选范围无可用数据</p>:visible.length>5000?<p className="py-16 text-center text-sm text-slate-500">超过5000个点，请缩小时间范围查看原始点。完整数据保留在明细与本地结果。</p>:<svg viewBox={`0 0 ${metric&&!expanded?490:970} 310`} preserveAspectRatio="xMidYMid meet" className={expanded?'block h-full min-h-0 w-full':'mt-3 w-full'} role={expanded?'group':'img'} aria-label={`${title}图`} onClick={expanded?event=>{const matrix=event.currentTarget.getScreenCTM();if(!matrix)return;const location=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());if(location.x<left||location.x>plotRight||location.y<40||location.y>270)return;const at=start+(location.x-left)/(plotRight-left)*(end-start);const closest=visible.reduce((best,p)=>Math.abs(p.at!-at)<Math.abs(best.at!-at)?p:best);setSelected(visible.indexOf(closest));setActivityAt(closest.at);}:undefined}>
    {[50,160,270].map(y=><line key={y} x1={left} x2={plotRight} y1={y} y2={y} stroke="#e2e8f0"/>)}
    {series.map(m=><g key={m.key} data-metric={m.key}>
      <text x={metric?5:m.axis} y="24" fontSize="11" fill={m.color}>{m.label} {m.unit}</text>
      {m.samples.length?[0,0.5,1].map(r=><text key={r} x={metric?5:m.axis} y={54+r*220} fontSize="11" fill={m.color}>{(m.max-(m.max-m.min)*r).toFixed(1)}</text>):<text x={metric?5:m.axis} y="54" fontSize="11" fill={m.color}>无数据</text>}
      {m.runs.map((run,i)=><path key={i} data-trend-segment="true" d={run.map((p,j)=>`${j?'L':'M'} ${x(p.at!)} ${m.y(p[m.key]!)}`).join(' ')} fill="none" stroke={m.color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeDasharray={run[0].state==='discharging'?undefined:run[0].state==='charging'?'6 4':'1 4'}/>)}
      {m.samples.map((p,i)=><g key={i}><circle cx={x(p.at!)} cy={m.y(p[m.key]!)} r="6" fill="transparent" role={expanded?'button':undefined} aria-label={`${time(p.at)} · ${m.label} ${p[m.key]} ${m.unit}`} onMouseEnter={expanded?()=>setSelected(visible.indexOf(p)):undefined} onClick={expanded?event=>{event.stopPropagation();setSelected(visible.indexOf(p));setActivityAt(p.at);}:undefined}><title>{`${time(p.at)} · ${m.label} ${p[m.key]} ${m.unit} · ${stateName(p.state)}`}</title></circle></g>)}
    </g>)}
    {expanded&&point&&<line x1={x(point.at!)} x2={x(point.at!)} y1="40" y2="270" stroke="#94a3b8" strokeDasharray="3 3" pointerEvents="none"/>}
    <text x={left} y="298" fontSize="11" fill="#64748b">{time(start).slice(0,10)===time(end).slice(0,10)?time(start).slice(11,19):time(start).slice(0,19)}</text><text x={plotRight} y="298" textAnchor="end" fontSize="11" fill="#64748b">{time(start).slice(0,10)===time(end).slice(0,10)?time(end).slice(11,19):time(end).slice(0,19)}</text>
  </svg>;
  };
  return <Dialog.Root open={open} onOpenChange={next=>{setOpen(next);if(next)setSelected(0);}}>
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
      {legend}<Dialog.Trigger asChild><button type="button" aria-label={metric?`放大查看${title}`:'放大查看电池趋势'} className="group block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
        {plot(false)}<span className="flex justify-between text-xs text-slate-400"><span>{visible.length} 个采样时刻{!metric&&' · 四项分别使用同色刻度'}</span><span className="group-hover:text-blue-600">放大 ↗</span></span>
      </button></Dialog.Trigger>
    </section>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[100] bg-slate-950/40"/><Dialog.Content className="fixed left-1/2 top-1/2 z-[101] grid h-[90dvh] min-h-0 w-[94vw] max-w-7xl grid-rows-[auto_auto_auto_minmax(0,1fr)_auto] -translate-x-1/2 -translate-y-1/2 gap-2 overflow-hidden rounded-2xl bg-white p-4 shadow-2xl">
      <div className="flex items-center justify-between"><Dialog.Title className="text-lg font-bold">{title}</Dialog.Title><Dialog.Close className="rounded-lg border px-3 py-1.5 text-sm">关闭</Dialog.Close></div>
      <Dialog.Description className="text-sm text-slate-500">{!metric&&'四项分别使用同色刻度。'}悬停查看数值，点击曲线查看附近活动；时间沿用设备日志，不转换时区。</Dialog.Description>
      {legend}<div className="min-h-0 min-w-0 overflow-hidden" data-expanded-chart="true">{plot(true)}</div>
      {point&&visible.length<=5000&&<div className="max-h-[30dvh] min-h-0 overflow-y-auto rounded-xl bg-slate-50 p-3" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="font-mono text-sm">{time(point.at)} <span className="text-slate-500">{stateName(point.state)}</span></div><div className="flex items-center gap-3 text-sm"><button type="button" aria-label="上一个采样点" disabled={index===0} onClick={()=>setSelected(index-1)} className="rounded-lg border px-3 py-2 disabled:opacity-30">上一点</button><span>{index+1} / {visible.length}</span><button type="button" aria-label="下一个采样点" disabled={index===visible.length-1} onClick={()=>setSelected(index+1)} className="rounded-lg border px-3 py-2 disabled:opacity-30">下一点</button></div></div>
        <div className="my-2 grid grid-cols-2 gap-2 sm:grid-cols-4">{metrics.map(m=><div key={m.key}><div className="text-xs" style={{color:m.color}}>{m.label}</div><div className="text-lg font-semibold">{typeof point[m.key]==='number'?`${point[m.key]} ${m.unit}`:'无数据'}</div></div>)}</div>
        <EvidenceView evidence={point.evidence}/>
      </div>}
      <Dialog.Root open={activityAt!==null} onOpenChange={next=>{if(!next)setActivityAt(null);}}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[110] bg-slate-950/20"/><Dialog.Content className="fixed left-1/2 top-1/2 z-[111] w-[90vw] max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-5 shadow-2xl"><Dialog.Close aria-label="关闭附近活动" className="float-right rounded-lg border px-2 py-1 text-xs">关闭</Dialog.Close>{activityAt!==null&&<NearbyActivity key={activityAt} at={activityAt} events={events} applications={applications}/>}</Dialog.Content></Dialog.Portal></Dialog.Root>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
export function BatteryTrendTabs(props: {points:Point[];start:number;end:number;events?:Event[];applications?:AppUsage[]}) {
  const [view,setView]=useState<'separate'|'combined'>('separate');
  return <div className="mt-4">
    <div role="tablist" aria-label="电池趋势展示方式" className="mb-3 flex gap-2">
      {(['separate','combined'] as const).map((value,i)=><button key={value} type="button" role="tab" id={`battery-tab-${value}`} aria-controls={`battery-panel-${value}`} aria-selected={view===value} tabIndex={view===value?0:-1} onClick={()=>setView(value)} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?1:1-i;setView(next===0?'separate':'combined');(event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[next] as HTMLElement)?.focus();}}} className={`rounded-xl px-4 py-2 text-sm font-semibold ${view===value?'bg-blue-600 text-white':'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>{value==='separate'?'分开展示':'合并展示'}</button>)}
    </div>
    <div role="tabpanel" id={`battery-panel-${view}`} aria-labelledby={`battery-tab-${view}`}>
      {view==='separate'?<div className="grid grid-cols-4 gap-3">{batteryMetrics.map(m=><BatteryPlot key={m.key} {...props} metric={m.key}/>)}</div>:<BatteryPlot key="combined" {...props}/>}
    </div>
  </div>;
}
const metricName=(kind:string)=>({cpu:'CPU',camera:'摄像头',audio:'音频',sensors:'传感器',screen:'屏幕',wifi:'Wi-Fi',bluetooth:'蓝牙',wakelock:'唤醒锁',idle:'待机',CPU:'CPU 总时间',Camera:'摄像头使用',Audio:'音频使用','Wake lock':'唤醒锁','Foreground activities':'前台活动','Foreground services':'前台服务','Top for':'顶部应用','Foreground for':'前台状态','Background for':'后台状态','Total running':'运行时间'} as Record<string,string>)[kind]||kind;
const formatDuration=(ms:number|null)=>ms===null?'未提供':`${(ms/1000).toFixed(3)} 秒`;
const decimalFormat=new Intl.NumberFormat('en-US',{useGrouping:false,maximumSignificantDigits:15});
export const formatMah=(value:number|null|undefined)=>value===null||value===undefined||!Number.isFinite(value)?'未提供':`${decimalFormat.format(value)} mAh`;
  const names:Record<string,string>={'android.sensor.accelerometer':'加速度计','android.sensor.gyroscope':'陀螺仪','android.sensor.proximity':'距离传感器','android.sensor.light':'光线传感器','android.sensor.magnetic_field':'磁场传感器','android.sensor.rotation_vector':'旋转矢量传感器'};
  const sensorName=(s:SensorUsage)=>s.name?(names[s.type?.split('(')[0].trim()||'']||s.name):'未知传感器';
const sensorRemainderLabel=(sensors:SensorUsage[])=>{
  const unresolved=sensors.filter(s=>s.estimatedMah===null);
  return unresolved.length?`${[...new Set(unresolved.map(sensorName))].join(' / ')}（耗电未拆分）`:sensors.length?'传感器剩余耗电（未拆分）':'未知传感器（未能拆分）';
};
export function SensorDetails({sensors,total}:{sensors:SensorUsage[];total:number|undefined}) {
  const known=sensors.filter(s=>s.estimatedMah!==null&&Number.isFinite(s.estimatedMah));
  const sum=known.reduce((v,s)=>v+s.estimatedMah!,0),residual=total!==undefined?total-sum:null;
  return <section className="rounded-2xl border bg-white p-5"><h2 className="font-semibold">传感器耗电明细</h2><p className="mt-1 text-xs text-slate-500">系统合计 {formatMah(total)}。单项按日志功耗参数 × 使用时长估算，缺少参数不分摊合计。</p>
    {sensors.map((s,i)=><div key={i} className="mt-3 border-t pt-3 text-sm"><div className="flex justify-between gap-3"><span className="font-semibold">{sensorName(s)} · 编号 {s.handle}</span><span>{s.estimatedMah===null?'缺少参数，耗电未拆分':formatMah(s.estimatedMah)}</span></div><p className="mt-1 text-xs text-slate-500">使用 {formatDuration(s.durationMs)} · {s.count===null?'次数未知':`${s.count} 次`}{s.powerMa!==null?` · ${s.powerMa} mA`:''}</p>{s.name&&<p className="mt-1 break-all text-xs text-slate-500">{s.name}</p>}<EvidenceView evidence={s.evidence}/>{s.definitionEvidence&&<EvidenceView evidence={s.definitionEvidence}/>}</div>)}
    {residual!==null&&residual>0&&<p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">{sensorRemainderLabel(sensors)}：{formatMah(residual)}</p>}
    {total!==undefined&&sum>total&&<p className="mt-3 text-xs text-amber-700">单项估算合计与系统总量不一致，分别展示，不强行配平。</p>}
    {!sensors.length&&<p className="mt-3 text-sm text-slate-500">未知传感器：日志未提供具体传感器使用明细。</p>}
  </section>;
}
export function AppPowerDetails({app,statistics,onBack}:{app:AppUsage;statistics:PowerStatistics|undefined;onBack:()=>void}) {
  const power=statistics?.uidPower.find(p=>p.uid===app.uid);
  const summaries=app.summaries.filter(s=>s.section===statistics?.section);
  const sensors=summaries.flatMap(s=>s.sensors||[]);
  const knownSensors=sensors.filter(s=>s.estimatedMah!==null&&Number.isFinite(s.estimatedMah)&&s.estimatedMah>=0);
  const knownTotal=knownSensors.reduce((sum,s)=>sum+s.estimatedMah!,0);
  const powerItems=(power?.components||[]).flatMap(c=>c.kind!=='sensors'?[{label:metricName(c.kind),value:c.mah}]:knownTotal>c.mah?[{label:'传感器合计（单项估算不一致）',value:c.mah}]:[...knownSensors.map(s=>({label:sensorName(s),value:s.estimatedMah!})),...(c.mah>knownTotal?[{label:sensorRemainderLabel(sensors),value:c.mah-knownTotal}]:[])]);

  return <div className="space-y-4">
    <button onClick={onBack} className="rounded-xl border bg-white px-4 py-2 text-sm">← 返回设备总览</button>
    <section className="rounded-2xl border bg-white p-5"><p className="text-xs text-slate-500">应用耗电明细 · UID {app.uid}</p><h1 className="mt-2 break-all text-xl font-bold">{app.packages.join(' / ')||`UID ${app.uid}（未提供应用名）`}</h1><p className="mt-2 text-sm text-slate-500">统计起点：{statistics?.period?.label||'未提供'} · {formatDuration(statistics?.totalMs??null)}</p><div className="mt-4 text-3xl font-semibold">{formatMah(power?.totalMah)}</div><p className="mt-1 text-xs text-slate-500">系统估算耗电 · 不等于实测耗电；缺失分项不按0处理</p>{app.packages.length>1&&<p className="mt-3 text-sm text-amber-700">这些包共享 UID，耗电与活动属于整个 UID，无法拆分到单个应用。</p>}</section>
    <div><PowerPie title="耗电分项" emptyMessage={power?"日志未提供可绘图的正值耗电分项":"日志有应用活动记录，但未提供该 UID 的 mAh 耗电估算，无法绘制占比。使用时长不等于耗电量。"} items={powerItems}/>{power&&<div className="mt-2 px-5"><EvidenceView evidence={power.evidence}/></div>}</div>
    {(summaries.some(s=>s.sensors?.length)||power?.components.some(c=>c.kind==='sensors'))&&<SensorDetails sensors={summaries.flatMap(s=>s.sensors||[])} total={power?.components.find(c=>c.kind==='sensors')?.mah}/>}
    <section className="rounded-2xl border bg-white p-5"><h2 className="font-semibold">详细使用情况</h2><p className="mt-1 text-xs text-slate-500">该统计周期累计值，不随整机曲线的时间筛选变化。前台活动时长不是前台 CPU 时间。</p>{summaries.length?summaries.map((summary,i)=><div key={i} className="mt-3 divide-y">{summary.metrics.map((m,j)=><div key={j} className="py-3"><div className="flex justify-between gap-4 text-sm"><span>{metricName(m.kind)}</span><span>{formatDuration(m.durationMs)}</span></div><EvidenceView evidence={m.evidence}/></div>)}</div>):<p className="mt-3 text-sm text-slate-400">报告未提供使用时长</p>}</section>
    <details className="rounded-2xl border bg-white p-5 text-sm"><summary className="cursor-pointer">UID 事件 · {app.events.length} 条</summary><p className="mt-2 text-xs text-slate-400">日志中该UID的事件，最多展示100条，不构造耗电时间线。</p>{app.events.slice(0,100).map((e,i)=><div key={i} className="mt-3 text-xs">{time(e.at)} · {e.type}<EvidenceView evidence={e.evidence}/></div>)}</details>
  </div>;
}
export function PowerPie({title,items,emptyMessage="没有可计算占比的正值数据"}:{title:string;items:Array<{label:string;value:number}>;emptyMessage?:string}) {
  const valid=items.filter(i=>Number.isFinite(i.value)&&i.value>0).sort((a,b)=>b.value-a.value),total=valid.reduce((sum,i)=>sum+i.value,0);
  const colors=['#2563eb','#8b5cf6','#f59e0b','#059669','#ef4444','#06b6d4','#db2777','#64748b'];
  const slices=valid.length>8?[...valid.slice(0,7),{label:'其他',value:valid.slice(7).reduce((sum,i)=>sum+i.value,0)}]:valid;
  let offset=0;
  return <section className="min-w-0 rounded-2xl border bg-white p-5"><h3 className="font-semibold">{title}</h3><p className="mt-1 text-xs text-slate-500">占已记录正值合计，不代表整机实测耗电占比。</p>{total>0&&Number.isFinite(total)?<><div className="mt-3 flex items-center gap-4"><svg viewBox="0 0 120 120" className="h-40 w-40 shrink-0" role="img" aria-label={`${title}，合计 ${formatMah(total)}`}>
    {slices.map((item,i)=>{const percent=item.value/total*100,at=offset;offset+=percent;return <circle key={i} cx="60" cy="60" r="42" fill="none" stroke={colors[i]} strokeWidth="25" pathLength="100" strokeDasharray={`${percent} ${100-percent}`} strokeDashoffset={-at} transform="rotate(-90 60 60)"><title>{item.label} · {formatMah(item.value)} · {percent.toFixed(2)}%</title></circle>;})}
    </svg><div className="min-w-0 flex-1 space-y-1">{slices.map((item,i)=><div key={i} className="flex items-center gap-2 text-xs"><span className="h-2 w-2 shrink-0 rounded-full" style={{background:colors[i]}}/><span className="min-w-0 flex-1 truncate" title={item.label}>{item.label}</span><span>{(item.value/total*100).toFixed(2)}%</span></div>)}</div></div><details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">全部明细 · 合计 {formatMah(total)}</summary><div className="mt-2 max-h-48 overflow-y-auto">{valid.map((i,n)=><div key={n} className="flex justify-between gap-3 py-1"><span className="break-all">{i.label}</span><span className="shrink-0">{formatMah(i.value)} · {(i.value/total*100).toFixed(2)}%</span></div>)}</div></details></>:<p className="py-10 text-center text-sm text-slate-400">{emptyMessage}</p>}</section>;
}
export function BugreportAnalysisPage() {
  const [mode,setMode]=useState<'upload'|'device'>('device'),[file,setFile]=useState<{token:string;name:string}|null>(null);
  const [devices,setDevices]=useState<Array<{serial:string;model?:string;state?:string}>>([]),[serial,setSerial]=useState('');
  const [loading,setLoading]=useState(false),[submitting,setSubmitting]=useState(false),[error,setError]=useState(''),[job,setJob]=useState<Job|null>(null);
  const [start,setStart]=useState(''),[end,setEnd]=useState(''),[sourceType,setSourceType]=useState('healthd');
  const [page,setPage]=useState(0),[eventPage,setEventPage]=useState(0);
  const [selectedUid,setSelectedUid]=useState<number|null>(null),[section,setSection]=useState(''),[appQuery,setAppQuery]=useState('');
  const [reports,setReports]=useState<Array<{key:string;createdAt:string;sourceName:string;serial:string;sourcePath:string}>>([]),[historyError,setHistoryError]=useState(''),[opening,setOpening]=useState(false);
  const [restoring,setRestoring]=useState(true);
  const jobRef=useRef<Job|null>(null),alive=useRef(true),submitLock=useRef(false);
  const locked=busy(job)||submitting||opening||restoring;
  const updateJob=(next:Job)=>{jobRef.current=next;setJob(next);if(next.result){const source=next.result.points.some(p=>p.sourceType==='healthd'&&p.at!==null)?'healthd':'batterystats',range=defaultBatteryDate(next.result.points,source);setSourceType(source);setStart(range?inputTime(range.start):'');setEnd(range?inputTime(range.end):'');}};
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{let stopped=false;void invoke('bugreport:current').then(r=>{if(stopped)return;if(r.error)throw Error(r.error);if(r.job)updateJob(r.job);}).catch(e=>{if(!stopped)setError(String(e));}).finally(()=>{if(!stopped)setRestoring(false);});return()=>{stopped=true;};},[]);
  useEffect(()=>{
    if(!busy(job))return;
    let stopped=false;let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{const next=await invoke('bugreport:status',{id:job!.id});if(stopped)return;if(!next.id)throw Error(next.error||'读取状态失败');updateJob(next);if(busy(next))timer=setTimeout(poll,800);}catch(e){if(!stopped){setError(String(e));timer=setTimeout(poll,2000);}}};
    timer=setTimeout(poll,500);return()=>{stopped=true;clearTimeout(timer);};
  },[job?.id,job?.status]);
  const loadDevices=async()=>{setLoading(true);setError('');try{const r=await invoke('performance:list-devices',{runtime:'android'});if(r.error)throw Error(r.error);if(!alive.current)return;const found=(r.devices||[]).filter((d:any)=>d.state==='device');setDevices(found);setSerial(current=>found.some((d:any)=>d.serial===current)?current:found[0]?.serial||'');}catch(e){if(alive.current)setError(String(e));}finally{if(alive.current)setLoading(false);}};
  const loadHistory=async()=>{try{const r=await invoke('bugreport:history');if(r.error)throw Error(r.error);if(alive.current){setReports(r.reports||[]);setHistoryError((r.errors||[]).join('\n'));}}catch(e){if(alive.current)setHistoryError(String(e));}};
  useEffect(()=>{void loadDevices();void loadHistory();},[]);
  useEffect(()=>{if(job?.status==='completed')void loadHistory();},[job?.id,job?.status]);
  const openReport=async(key:string)=>{if(locked)return;setOpening(true);setError('');try{const r=await invoke('bugreport:open-report',{key});if(r.error)throw Error(r.error);if(!alive.current)return;updateJob(r);setSelectedUid(null);setSection('');setAppQuery('');setPage(0);setEventPage(0);}catch(e){setError(String(e));}finally{setOpening(false);}};
  const revealSource=async()=>{try{const r=await invoke('bugreport:reveal-source',{key:job?.reportKey});if(r.error)throw Error(r.error);}catch(e){setError(String(e));}};
  const pick=async()=>{try{const r=await invoke('bugreport:pick');if(r.error)throw Error(r.error);if(!r.cancelled)setFile(r);}catch(e){setError(String(e));}};
  const execute=async()=>{
    if(submitLock.current||locked)return;submitLock.current=true;setSubmitting(true);setError('');
    try{const r=await invoke('bugreport:start',{mode,serial,token:file?.token});if(!r.id)throw Error(r.error||'启动失败');if(!alive.current)return;updateJob(r);setPage(0);setEventPage(0);setSelectedUid(null);setSection('');setAppQuery('');}catch(e){if(alive.current)setError(String(e));}finally{submitLock.current=false;if(alive.current)setSubmitting(false);}
  };
  const result=job?.result,startAt=parseTime(start),endAt=parseTime(end),validRange=Number.isFinite(startAt)&&Number.isFinite(endAt)&&startAt<=endAt;
  const inRange=(p:{at:number|null})=>validRange&&p.at!==null&&p.at>=startAt&&p.at<=endAt;
  const points=result?.points.filter(p=>p.sourceType===sourceType&&inRange(p))||[],events=result?.events.filter(inRange)||[];
  const statistics=result?.statistics.find(s=>String(s.section)===section)||result?.statistics[result.statistics.length-1];
  const selectedApp=result?.applications.find(a=>a.uid===selectedUid);
  const appRows=(result?.applications||[]).filter(a=>a.summaries.some(s=>s.section===statistics?.section)||statistics?.uidPower.some(p=>p.uid===a.uid)).map(app=>({app,power:statistics?.uidPower.find(p=>p.uid===app.uid)})).filter(({app})=>`${app.uid} ${app.packages.join(' ')}`.toLowerCase().includes(appQuery.toLowerCase())).sort((a,b)=>(b.power?.totalMah??-1)-(a.power?.totalMah??-1));
  const intervals: Array<{start:number;end:number;state:string;segment:string}>=[];
  for(const p of points){const last=intervals[intervals.length-1];if(last&&last.segment===p.segment&&last.state===p.state&&p.at!>=last.end&&p.at!-last.end<=60000)last.end=p.at!;else intervals.push({start:p.at!,end:p.at!,state:p.state,segment:p.segment});}
  return <div className="flex-1 min-h-0 overflow-auto bg-slate-50 p-5 text-slate-800"><div className="mx-auto max-w-[1600px] space-y-4">
    {selectedApp?<AppPowerDetails app={selectedApp} statistics={statistics} onBack={()=>setSelectedUid(null)}/>:<>
    <section className="rounded-2xl border border-slate-200 bg-white p-5"><h1 className="text-xl font-bold">耗电分析</h1><p className="mt-1 text-sm text-slate-500">导入日志，查看整机趋势、应用估算耗电和使用明细。</p>
      <div className="mt-5 flex gap-2">{(['device','upload'] as const).map(m=><button key={m} disabled={locked} onClick={()=>{setMode(m);}} className={`rounded-xl px-4 py-2 text-sm ${mode===m?'bg-blue-600 text-white':'bg-slate-100'}`}>{m==='upload'?'手动导入':'从设备导入'}</button>)}</div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {mode==='upload'?<div><div className="mb-1 text-sm font-semibold">Bugreport ZIP / batterystats TXT、LOG</div><button disabled={locked} onClick={()=>void pick()} className="w-full rounded-xl border p-3 text-left text-sm">{file?.name||'选择日志文件'}</button></div>:<label className="text-sm font-semibold">Android 设备<div className="mt-1 flex gap-2"><DeviceSerialSelect disabled={locked||loading} value={serial} onChange={setSerial} options={devices.map(d=>({value:d.serial,label:[d.serial,d.model].filter(Boolean).join(' / ')}))} placeholder={loading?'正在读取设备…':'未检测到设备'} /><button disabled={locked||loading} onClick={()=>void loadDevices()} className="h-8 rounded-xl border border-border/50 px-3 text-xs">刷新</button></div></label>}

      </div>
      {mode==='upload'&&<div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm"><p className="font-semibold">如何获取日志</p><p className="mt-1 text-xs text-slate-500">连接设备并允许 USB 调试，将 SERIAL 替换为设备序列号。在终端执行后，选择生成的 ZIP、TXT 或 LOG。</p><pre className="mt-2 overflow-x-auto text-xs leading-6">{'adb devices -l\n# 完整报告（推荐，通常需要数分钟）\nadb -s SERIAL bugreport ./bugreport.zip\n# 仅电池统计\nadb -s SERIAL shell dumpsys batterystats > ./batterystats.txt'}</pre></div>}
      {locked&&<div role="status" className="mt-4 flex items-center gap-3 rounded-xl bg-blue-50 p-4 text-blue-700"><LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true"/><div><p className="text-sm font-semibold">{job?.status==='collecting'?'正在从设备导出，请勿拔线':restoring?'正在恢复导入状态':opening?'正在打开历史报告':'正在分析并保存报告'}</p><p className="mt-1 text-xs">{job?.status==='collecting'?'导入在后台继续，可切换使用其他功能。请保持设备连接。':job?.phase||'请稍候…'}</p></div></div>}
      <div className="mt-4 flex items-center gap-3"><button disabled={locked||loading||(mode==='upload'?!file:!serial)} onClick={()=>void execute()} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{submitting?'正在启动…':'执行分析'}</button>{busy(job)&&<button onClick={()=>void invoke('bugreport:cancel',{id:job!.id}).then(r=>{if(r.id)updateJob(r);else setError(r.error);}).catch(e=>setError(String(e)))} className="rounded-xl border px-4 py-2">取消</button>}<span className="text-sm text-slate-500">{job?.phase||'仅在点击执行分析后采集或解析，不清除设备历史。'}</span></div>
      {(error||job?.error)&&<div role="alert" className="mt-3 whitespace-pre-wrap break-all rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error||job?.error}{job?.diagnostic&&<details><summary>命令诊断</summary><pre className="whitespace-pre-wrap">{job.diagnostic}</pre></details>}</div>}
      {job?.status==='cancelled'&&<p className="mt-2 text-xs text-slate-500">已停止本机命令与解析；Android 系统可能仍在收尾 dumpstate。</p>}
    </section>
    <section className="rounded-2xl border bg-white p-5"><details onToggle={e=>{if(e.currentTarget.open)void loadHistory();}}><summary className="cursor-pointer font-semibold">历史耗电报告 · {reports.length} 份</summary><p className="mt-2 text-xs text-slate-500">分析完成自动保存报告及日志副本，重启后仍可查看。</p>{historyError&&<p role="alert" className="mt-2 whitespace-pre-wrap text-xs text-rose-600">{historyError}</p>}<div className="mt-3 max-h-72 overflow-y-auto divide-y">{reports.map(report=><button key={report.key} disabled={locked} onClick={()=>void openReport(report.key)} className="flex w-full items-center justify-between gap-3 py-3 text-left text-sm disabled:opacity-50"><span className="min-w-0"><span className="block truncate">{report.sourceName}</span><span className="text-xs text-slate-400">{new Date(report.createdAt).toLocaleString()} {report.serial}</span></span><span className="shrink-0 text-blue-600">查看报告 ›</span></button>)}</div>{!reports.length&&<p className="mt-3 text-sm text-slate-400">暂无已保存报告</p>}</details></section>
    {result&&<>
      {job?.sourcePath&&<div className="rounded-xl border bg-white p-4 text-xs"><span className="text-slate-500">报告日志 · </span><button onClick={()=>void revealSource()} className="break-all text-left text-blue-600 hover:underline" title="在文件夹中显示">{job.sourcePath}</button><span className="ml-2 text-slate-400">点击定位文件</span></div>}
      <section className="rounded-2xl border bg-white p-5"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">设备耗电总览</h2><select aria-label="统计周期" value={statistics?.section??''} onChange={e=>setSection(e.target.value)} className="rounded-xl border px-3 py-2 text-sm">{result.statistics.map(s=><option key={s.section} value={s.section}>{s.period?.label||`统计段 ${s.section}`}</option>)}</select></div><p className="mt-2 text-xs text-slate-500">统计周期累计，不与曲线时间筛选混算；系统估算不等于实测耗电。</p><div className="mt-4 grid grid-cols-3 gap-3">{[['电池供电时间',formatDuration(statistics?.onBatteryMs??null)],['系统估算总量',formatMah(statistics?.computedMah)],['系统记录放电量',statistics?.actualDrain?`${statistics.actualDrain} mAh`:'未提供']].map(([name,value])=><div key={name} className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">{name}</p><p className="mt-2 text-lg font-semibold">{value}</p></div>)}</div>{statistics?.warnings.length?<details className="mt-3 text-xs text-amber-700"><summary className="cursor-pointer">数据完整性提示 · {statistics.warnings.length} 项</summary>{statistics.warnings.map((w,i)=><p key={i} className="mt-1">{w}</p>)}</details>:null}<details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">整机耗电分项</summary>{statistics?.global.map((g,i)=><div key={i} className="mt-2">{metricName(g.kind)} · {formatMah(g.mah)}<EvidenceView evidence={g.evidence}/></div>)}</details></section>
      <div className="grid gap-4 lg:grid-cols-2"><PowerPie title="各耗电项占比" items={(statistics?.global||[]).map(g=>({label:metricName(g.kind),value:g.mah}))}/><PowerPie title="各应用耗电占比" items={(statistics?.uidPower||[]).map(p=>({label:result.applications.find(a=>a.uid===p.uid)?.packages.join(' / ')||`UID ${p.uid}`,value:p.totalMah}))}/></div>
      <section className="rounded-2xl border bg-white p-5"><h2 className="font-semibold">整机电池采样趋势</h2><p className="mt-1 text-xs text-slate-500">这是电池侧采样，不是目标 App 耗电，也不是瞬时波形。按原始采样连线，时钟断点、缺失值或超过60秒的采样间隔断开，不积分 mAh 或推断过流关机。</p>
        <div className="mt-4 flex flex-wrap items-end gap-3"><label className="text-xs">数据来源<select value={sourceType} onChange={e=>{setSourceType(e.target.value);const range=defaultBatteryDate(result.points,e.target.value);setStart(range?inputTime(range.start):'');setEnd(range?inputTime(range.end):'');setPage(0);}} className="ml-2 rounded-lg border p-2"><option value="healthd">healthd</option><option value="batterystats">Batterystats 历史</option></select></label><label className="text-xs">日志日期<select aria-label="日志日期" value={start.slice(0,10)===end.slice(0,10)?start.slice(0,10):''} onChange={e=>{const range=batteryDates(result.points,sourceType).find(d=>d.day===e.target.value);if(range){setStart(inputTime(range.start));setEnd(inputTime(range.end));setPage(0);setEventPage(0);}}} className="ml-2 rounded-lg border p-2"><option value="" disabled>自定义时间范围</option>{batteryDates(result.points,sourceType).map(d=><option key={d.day} value={d.day}>{d.day}{Number(d.day.slice(0,4))<2000?'（时钟未校准）':''} · {d.count} 点</option>)}</select></label>{[['开始',start,setStart],['结束',end,setEnd]].map(([label,value,set])=><label key={label as string} className="text-xs">{label as string}<input type="datetime-local" step="0.001" value={value as string} onChange={e=>{(set as (s:string)=>void)(e.target.value);setPage(0);setEventPage(0);}} className="ml-2 rounded-lg border p-2"/></label>)}</div>
        <p className="mt-3 text-xs text-slate-500">{result.timeBasis} · 合并 {result.duplicateCount} 条重复 healthd 记录</p>
        {!validRange&&<p className="mt-2 text-sm text-amber-700">请选择有效时间范围；无可定位时间的数据仍可在诊断中查看。</p>}
        <BatteryTrendTabs events={result.events} applications={result.applications} points={points} start={startAt} end={endAt}/>
        <details className="mt-4 text-sm"><summary className="cursor-pointer">充放电区间（相邻同状态采样覆盖，间隔超过60秒断开）</summary><div className="mt-2 max-h-48 overflow-auto"><p className="text-xs text-slate-400">共 {intervals.length} 段；这里展示前200段，可缩小时间范围。</p>{intervals.slice(0,200).map((v,i)=><div key={i} className="py-1 text-xs">{time(v.start)} → {time(v.end)} · {stateName(v.state)} · {v.segment}</div>)}</div></details>
      </section>
      <section className="rounded-2xl border bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">应用耗电情况</h2><input aria-label="搜索应用或UID" value={appQuery} onChange={e=>setAppQuery(e.target.value)} placeholder="搜索包名或 UID" className="rounded-xl border px-3 py-2 text-sm"/></div><p className="mt-2 text-xs text-slate-500">按当前统计周期的系统估算 mAh 排序。无估算的条目仍可查看活动时长；共享 UID 只列一次。应用名称与图标未提供时显示包名。</p>
        {!appRows.length&&<p className="py-6 text-sm text-slate-400">未找到应用统计</p>}<div className="mt-3 divide-y">{appRows.map(({app,power})=><button key={app.uid} onClick={()=>setSelectedUid(app.uid)} className="flex w-full items-center justify-between gap-4 rounded-lg px-2 py-4 text-left hover:bg-slate-50"><span className="min-w-0"><span className="block truncate text-sm font-semibold">{app.packages.join(' / ')||`UID ${app.uid}`}</span><span className="text-xs text-slate-400">UID {app.uid}{app.packages.length>1?' · 共享 UID':''}</span></span><span className="shrink-0 text-sm"><span className="font-mono">{formatMah(power?.totalMah)}</span><span className="ml-3 text-slate-400">›</span></span></button>)}</div>
      </section>
      <section className="rounded-2xl border bg-white p-5"><details><summary className="cursor-pointer text-sm font-semibold">原始采样明细 · {points.length} 条</summary><div className="mt-3 overflow-auto"><table className="w-full text-left text-xs"><thead><tr>{['时间','电流 mA','电压 mV','温度 °C','电量 %','状态 / 证据'].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{points.slice(page*100,page*100+100).map((p,i)=><tr key={i} className="border-t"><td className="p-2 whitespace-nowrap">{time(p.at)}</td>{[p.currentMa,p.voltageMv,p.temperatureC,p.levelPercent].map((v,j)=><td key={j} className="p-2">{v??'不可用'}</td>)}<td className="p-2">{stateName(p.state)}<EvidenceView evidence={p.evidence}/></td></tr>)}</tbody></table></div><div className="mt-3 flex gap-3 text-sm"><button disabled={!page} onClick={()=>setPage(page-1)}>上一页</button><span>{page+1}</span><button disabled={(page+1)*100>=points.length} onClick={()=>setPage(page+1)}>下一页</button></div></details>
        <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold">通用系统事件 · {events.length} 条</summary>{events.slice(eventPage*100,eventPage*100+100).map((e,i)=><div key={i} className="mt-3 text-xs">{time(e.at)} · {e.type} · {e.scope==='uid'?'UID活动':'整机事件'}<EvidenceView evidence={e.evidence}/></div>)}<div className="mt-3 flex gap-3 text-sm"><button disabled={!eventPage} onClick={()=>setEventPage(eventPage-1)}>上一页</button><span>{eventPage+1}</span><button disabled={(eventPage+1)*100>=events.length} onClick={()=>setEventPage(eventPage+1)}>下一页</button></div></details>
        <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold">数据覆盖与诊断</summary><p className="mt-2 text-xs break-all">原始来源：{result.source} · 本地结果目录：{job.outputDirectory}</p>{result.warnings.map(w=><p key={w} className="mt-2 text-xs text-amber-700">{w}</p>)}<p className="mt-2 text-xs">电流按 AOSP healthd 的 μA 换算为 mA，厂商自定义字段须另行核对。充电状态电流不等于整机功率；应用耗电仅展示系统原始估算，不从电流曲线推算。ZIP只解析主报告文本，也支持batterystats TXT；报告不自动上传。</p>{result.events.filter(e=>e.at===null).slice(0,100).map((e,i)=><div key={i} className="mt-2 text-xs">未定位时间 · {e.type}<EvidenceView evidence={e.evidence}/></div>)}</details>
      </section>
    </>}
  </>}
  </div></div>;
}
