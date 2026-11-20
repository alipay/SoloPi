// Bugreport text is untrusted data. Only known Android fields are interpreted.
const MAX_POINTS = 50000, MAX_EVENTS = 20000;
function duration(text) {
  const s = String(text).trim(); if (s === '0') return 0;
  let total = 0, end = 0, found = false;
  const re = /(\d+)(ms|d|h|m|s)/g; let m;
  while ((m = re.exec(s))) { if (s.slice(end, m.index).trim()) return null; total += Number(m[1]) * ({d:86400000,h:3600000,m:60000,s:1000,ms:1}[m[2]]); end = re.lastIndex; found = true; }
  return found && !s.slice(end).trim() && Number.isSafeInteger(total) ? total : null;
}
function finite(value) { const number=Number(value); return Number.isFinite(number)?number:null; }
function uidNumber(uid) {
  if (/^\d+$/.test(uid)) return Number(uid);
  const m = /^u(\d+)a(\d+)$/.exec(uid); return m ? Number(m[1])*100000+10000+Number(m[2]) : null;
}
function wallTime(text) {
  const m = /^(\d{4})[-/](\d\d)[-/](\d\d)[ T-](\d\d)[:-](\d\d)[:-](\d\d)(?:\.(\d{1,3}))?$/.exec(text);
  if (!m) return null;
  const values = m.slice(1,7).map(Number), [y,mo,d,h,mi,se] = values;
  const ms = Date.UTC(y,mo-1,d,h,mi,se,Number((m[7]||'').padEnd(3,'0'))), dt = new Date(ms);
  return dt.getUTCFullYear()===y && dt.getUTCMonth()===mo-1 && dt.getUTCDate()===d && h<24 && mi<60 && se<60 ? ms : null;
}
function parseBugreport(text, source) {
  const lines = text.split(/\r?\n/), points = [], events = [], warnings = new Set(), mappings = new Map(), summaries = [];
  const evidence = (i, line) => ({ source, line: i+1, text: line.slice(0,1600) });
  const addMapping = (name, uid) => { if(uid === null || !/^[\w]+(?:\.[\w]+)*$/.test(name)) return; const set = mappings.get(name)||new Set(); set.add(uid); mappings.set(name,set); };
  const addPoint = p => { if(points.length>=MAX_POINTS) throw Error('电池点超过50000条，无法完整展示'); points.push(p); };
  const addEvent = e => { if(events.length>=MAX_EVENTS) throw Error('系统事件超过20000条，无法完整展示'); events.push(e); };
  const header = text.slice(0,10000).match(/dumpstate:\s*(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)/);
  const capturedAt = header ? wallTime(header[1]) : null;
  let currentPackage = '', inHistory = false, historySegment = 0, anchor = null, previousOffset = null, historyState = 'unknown';
  let healthSegment = 0, previousHealth = null, buffer = 0, historyRun = 0, batterySection = false, currentSummary = null, section = 0, period = null;
  const statistics = new Map(), sensorCatalog = new Map();
  const stats = () => { if(!statistics.has(section))statistics.set(section,{section,period:null,onBatteryMs:null,totalMs:null,capacityMah:null,computedMah:null,actualDrain:null,global:[],uidPower:[],evidence:null});return statistics.get(section); };
  let inPower=false;
  const dedup = new Map(); let duplicateCount = 0, unplacedHealthCount = 0;
  for (let i=0;i<lines.length;i++) {
    const line = lines[i];
    const sensorDefinition=/^\s*0x([\da-f]+)\)\s*([^|]+)\|[^|]*\|.*?type:\s*([^|]+)/i.exec(line);
    if(sensorDefinition){const handle=parseInt(sensorDefinition[1],16),power=/\bpower\s*[:=]\s*([\d.]+)\s*mA\b/i.exec(line);sensorCatalog.set(handle,{handle,name:sensorDefinition[2].trim(),type:sensorDefinition[3].trim(),powerMa:power?finite(power[1]):null,evidence:evidence(i,line)});}

    const pkg = /^\s*Package \[([^\]]+)\]/.exec(line); if(pkg) currentPackage=pkg[1];
    if (/^\S|^  (?!Package )\S/.test(line) && !pkg) currentPackage='';
    const userId = /^\s+userId=(\d+)/.exec(line); if(currentPackage && userId) addMapping(currentPackage,Number(userId[1]));
    const pm = /^package:(\S+)\s+uid:(\d+)/.exec(line); if(pm) addMapping(pm[1],Number(pm[2]));
    for (const m of line.matchAll(/(?:[+-](?:fg|top|proc)|[+-]?pkginst)=(u\d+a\d+|\d+):"([\w.]+)"/g)) addMapping(m[2],uidNumber(m[1]));
    if (/^------.*(?:LOG|log)|^--------- beginning/.test(line)) { buffer++; healthSegment++; previousHealth=null; }
    if (/DUMP OF SERVICE batterystats:|^Battery History/.test(line)) { batterySection=true; currentSummary=null; period=null; inPower=false; section++; }
    else if (/^DUMP OF SERVICE /.test(line)) { batterySection=false; currentSummary=null; inHistory=false; }
    if (/^Battery History/.test(line)) { inHistory=true; anchor=null; previousOffset=null; historySegment++; historyRun++; }
    const history = inHistory && /^\s*(0|\+[^\s]+)\s+\(\d+\)\s+(.*)$/.exec(line);
    if (history) {
      const offset = duration(history[1].replace(/^\+/,'')), body=history[2]; if(offset===null) { warnings.add('存在无法解析的历史时间'); continue; }
      const boundary = /\b(?:START|SHUTDOWN|RESET|OVERFLOW)\b/.exec(body), time = /(?:RESET:)?TIME:\s*(\d{4}-\d\d-\d\d-\d\d-\d\d-\d\d)/.exec(body);
      if(boundary || time || (previousOffset!==null && offset<previousOffset)) {
        historySegment++; historyState='unknown';
        if(boundary) anchor=null;
        if(previousOffset!==null && offset<previousOffset) warnings.add('历史相对时间回退，已断开曲线');
      }
      if(time) { const t=wallTime(time[1]); anchor=t===null?null:t-offset; if(t!==null && new Date(t).getUTCFullYear()<2000) warnings.add('存在早期/未校准系统时钟，按独立时间段展示'); }
      const rawAt = anchor===null?null:anchor+offset;
      const at = rawAt!==null && Math.abs(rawAt)<=8640000000000000?rawAt:null, segment=`history-${historyRun}-${historySegment}`;
      if(previousOffset!==null && offset-previousOffset>60000) { historySegment++; warnings.add('历史记录存在超过60秒的稀疏间隔，图中不跨缺口连线'); }
      previousOffset=offset;
      if(boundary) addEvent({at,offset,segment,type:boundary[0],scope:'device',evidence:evidence(i,line)});
      if(time) addEvent({at,offset,segment,type:'时间锚点',scope:'device',evidence:evidence(i,line)});
      const state = /\bstatus=(\w+)/.exec(body), plug=/\bplug=(\w+)/.exec(body);
      if(state) historyState=state[1];
      if(plug) { addEvent({at,offset,segment,type:`供电:${plug[1]}`,scope:'device',evidence:evidence(i,line)}); }
      const level=/^(\d{3})\s/.exec(body), temp=/\btemp=(-?\d+)/.exec(body), volt=/\bvolt=(\d+)/.exec(body);
      if(level||temp||volt) addPoint({at,offset,segment:`history-${historyRun}-${historySegment}`,sourceType:'batterystats',levelPercent:level&&Number(level[1])<=100?Number(level[1]):null,temperatureC:temp&&finite(temp[1])!==null?Number(temp[1])/10:null,voltageMv:volt?finite(volt[1]):null,currentMa:null,state:historyState,evidence:evidence(i,line)});
      for (const m of body.matchAll(/([+-])(screen|charging|plugged|camera|audio|wake_lock|running|fg|top)\b(?:=(u\d+a\d+|\d+):"([^"]*)")?/g)) addEvent({at,offset,segment,type:`${m[1]}${m[2]}`,scope:m[3]?'uid':'device',uid:m[3]?uidNumber(m[3]):null,name:m[4]||'',evidence:evidence(i,line)});
      continue;
    }
    if(inHistory && line.trim() && !/^\s|^Battery History/.test(line)) inHistory=false;
    if (/healthd\s*:.*battery l=/.test(line)) {
      const time = /(?:^|\s)(\d\d-\d\d)\s+(\d\d:\d\d:\d\d\.\d{3})/.exec(line), payload=line.slice(line.indexOf('battery l='));
      if(!time||capturedAt===null) { unplacedHealthCount++; continue; }
      const y=new Date(capturedAt).getUTCFullYear();
      const dates=[y-1,y,y+1].map(year=>wallTime(`${year}-${time[1]} ${time[2]}`)).filter(t=>t!==null);
      const at=dates.sort((a,b)=>Math.abs(a-capturedAt)-Math.abs(b-capturedAt))[0];
      if(at===undefined) {unplacedHealthCount++;continue;}
      const fields=Object.fromEntries([...payload.matchAll(/\b(l|v|t|st|c|chg)=([^\s]*)/g)].map(m=>[m[1],m[2]]));
      const num=k=>/^-?\d+(?:\.\d+)?$/.test(fields[k]||'')?finite(fields[k]):null;
      const key=`${at}:${payload}`;
      if(dedup.has(key)) { duplicateCount++; const p=dedup.get(key); if(p.duplicates.length<4) p.duplicates.push(evidence(i,line)); continue; }
      if(previousHealth!==null && (at<previousHealth || at-previousHealth>60000)) { healthSegment++; warnings.add('healthd 时钟回退或间隔超过60秒，已断开曲线'); }
      previousHealth=at;
      const state=({2:'charging',3:'discharging',4:'not-charging',5:'full'})[fields.st]||'unknown';
      const point={at,segment:`healthd-${buffer}-${healthSegment}`,sourceType:'healthd',levelPercent:num('l')!==null && num('l')>=0 && num('l')<=100?num('l'):null,voltageMv:num('v'),temperatureC:num('t'),currentMa:num('c')===null?null:num('c')/1000,state,plug:fields.chg??null,evidence:evidence(i,line),duplicates:[]};
      addPoint(point);dedup.set(key,point);
    }
    if(/^Statistics since /.test(line)&&!batterySection){batterySection=true;section++;}
    if(batterySection) {
      const stat=stats();
      const clock=/^\s*Start clock time: (.+)$/.exec(line);if(clock)stat.period={label:clock[1],evidence:evidence(i,line)};
      const timing=/^\s*(Time on battery|Total run time): (.+?) realtime/.exec(line);if(timing)stat[timing[1]==='Time on battery'?'onBatteryMs':'totalMs']=duration(timing[2].replace(/\s*\([^)]*\)\s*$/,''));
      if(/^\s*Estimated power use \(mAh\):/.test(line)){inPower=true;stat.evidence=evidence(i,line);}
      if(inPower){
        const total=/^\s*Capacity: ([\d.eE+-]+), Computed drain: ([\d.eE+-]+), actual drain: (.+)$/.exec(line);
        if(total){stat.capacityMah=finite(total[1]);stat.computedMah=finite(total[2]);stat.actualDrain=total[3];}
        const power=/^    UID (u\d+a\d+|\d+): ([\d.eE+-]+)(?: \( (.*?) \))?\s*$/.exec(line);
        if(power){const value=finite(power[2]);if(value!==null&&value>=0)stat.uidPower.push({uid:uidNumber(power[1]),totalMah:value,components:[...(power[3]||'').matchAll(/([\w.-]+)=([\d.eE+-]+)/g)].map(m=>({kind:m[1],mah:finite(m[2])})).filter(m=>m.mah!==null&&m.mah>=0),evidence:evidence(i,line)});}
        const global=/^      ([\w.-]+): ([\d.eE+-]+)(?: |$)/.exec(line);if(global&&finite(global[2])!==null)stat.global.push({kind:global[1],mah:finite(global[2]),evidence:evidence(i,line)});
        if(line.trim()&&!/^ {4,}/.test(line)&&!/^\s*Estimated power use/.test(line))inPower=false;
      }

      const startClock=/^\s*Start clock time: (.+)$/.exec(line); if(startClock)period={label:startClock[1],evidence:evidence(i,line)};
      const uid=/^  (u\d+a\d+|\d+):\s*$/.exec(line);
      if(uid) { currentSummary={uid:uidNumber(uid[1]),uidLabel:uid[1],section,period,metrics:[],evidence:evidence(i,line)}; summaries.push(currentSummary); }
      if(currentSummary) {
        const apk=/^    Apk ([\w.]+):/.exec(line);if(apk) addMapping(apk[1],currentSummary.uid);
        const cpu=/^    Total cpu time: u=(.+?) s=(.+?)\s*$/.exec(line);
        if(cpu) { const u=duration(cpu[1]),s=duration(cpu[2]); currentSummary.metrics.push({kind:'CPU',durationMs:u===null||s===null?null:u+s,detail:line.trim(),evidence:evidence(i,line)}); }
        const activity=/^    (Camera|Audio): (.+?) realtime/.exec(line);
        if(activity) currentSummary.metrics.push({kind:activity[1],durationMs:duration(activity[2]),detail:line.trim(),evidence:evidence(i,line)});
        const usage=/^    (Foreground activities|Foreground services|Top for|Foreground for|Background for|Total running|Sensor \d+): (.+?)(?: realtime| \(|\s*$)/.exec(line);
        if(usage)currentSummary.metrics.push({kind:usage[1],durationMs:duration(usage[2]),detail:line.trim(),evidence:evidence(i,line)});
        if(/^    (?:Wake lock |TOTAL wake:)/.test(line)) { const d=/:\s*((?:\d+(?:ms|d|h|m|s)\s*)+)/.exec(line);currentSummary.metrics.push({kind:'Wake lock',durationMs:d?duration(d[1]):null,detail:line.trim(),evidence:evidence(i,line)}); }
      }
    }
  }
  for(const summary of summaries){
    summary.sensors=summary.metrics.filter(m=>/^Sensor \d+$/.test(m.kind)).map(m=>{
      const handle=Number(m.kind.slice(7)),definition=sensorCatalog.get(handle),count=/\((\d+) times\)/.exec(m.detail);
      return {handle,name:definition?.name||null,type:definition?.type||null,durationMs:m.durationMs,count:count?Number(count[1]):null,powerMa:definition?.powerMa??null,estimatedMah:m.durationMs!==null&&definition?.powerMa!=null?m.durationMs*definition.powerMa/3600000:null,evidence:m.evidence,definitionEvidence:definition?.evidence||null};
    });
  }
  const allUids=new Set([...summaries.map(s=>s.uid),...[...statistics.values()].flatMap(s=>s.uidPower.map(p=>p.uid))]);
  const applications=[...allUids].filter(uid=>uid!==null).map(uid=>({uid,packages:[...mappings].filter(([,set])=>set.has(uid)).map(([name])=>name),summaries:summaries.filter(s=>s.uid===uid),events:events.filter(e=>e.scope==='uid'&&e.uid===uid)}));
  for(const stat of statistics.values()){
    stat.warnings=[];
    if(stat.uidPower.length&&!(stat.computedMah>0))stat.warnings.push('整机估算总量为0或缺失，不计算应用耗电占比');
    for(const power of stat.uidPower){
      const summary=summaries.find(s=>s.uid===power.uid&&s.section===stat.section);
      if(summary?.metrics.some(m=>m.kind==='CPU'&&m.durationMs>0)&&!power.components.some(c=>c.kind==='cpu'))stat.warnings.push(`UID ${power.uid} 有CPU活动但未提供CPU耗电分项`);
      for(const [key,kind] of [['camera','Camera'],['audio','Audio']]){
        const ms=summary?.metrics.find(m=>m.kind===kind)?.durationMs,mah=power.components.find(c=>c.kind===key)?.mah;
        if(ms>0&&mah>0&&Math.abs(mah*3600000/ms-0.1)<0.005)stat.warnings.push(`UID ${power.uid} ${kind} 估算参数接近0.1mA，疑似默认功耗参数，需厂商校准核验`);
      }
    }
  }
  if(unplacedHealthCount) warnings.add(`${unplacedHealthCount}条healthd记录缺少可验证的墙上时钟锚点，未加入时间趋势`);
  if(!points.some(p=>p.currentMa!==null)) warnings.add('未发现可定位到时间的电流采样，电流不可用');
  if(!applications.length) warnings.add('没有可识别的UID应用统计');
  if(!points.length&&!applications.length)throw Error('未发现电池历史或应用统计，请导入完整Bugreport或dumpsys batterystats文本');
  const coverage=points.filter(p=>p.at!==null).map(p=>p.at);
  return {schemaVersion:2,source,capturedAt,timeBasis:'设备日志墙上时钟；时区未验证，不与电脑时区转换',points,events,applications,statistics:[...statistics.values()].filter(s=>s.period||s.uidPower.length||s.totalMs!==null||summaries.some(a=>a.section===s.section)),warnings:[...warnings],duplicateCount,unplacedHealthCount,coverage:coverage.length?{start:Math.min(...coverage),end:Math.max(...coverage)}:null};
}
module.exports={parseBugreport,duration,uidNumber,wallTime};
