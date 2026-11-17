import {PageHeaderActions} from '../components/PageHeaderActions';
import {useEffect,useMemo,useRef,useState} from 'react';
import {lab,type Catalog} from '../api/lab';
import {nativeTaskLink} from '../api/client-tasks';
import {readWorkingGroups,type WorkingSnapshot} from '../api/working-groups';
import type {DataArea} from '../api/areas';
import type {ClientRecord} from '../api/types';
import {isRevokedClient} from '../api/types';
import {createRoClientsRead} from '../api/readonly-proxy';
import {createClientsRead} from '../api/fetchers-v015';
import type {RuntimeConnection} from '../api/connection';
import {useDeliveryArea} from '../hooks/useDeliveryArea';
import {usePollingArea} from '../hooks/usePollingArea';
import {useDevicesReadView} from '../hooks/useDevicesReadView';
import {OnlineBadge} from '../components/StateBadge';
import {DeviceGroupScreens} from '../components/DeviceGroupScreens';

type ReadState={snapshot?:WorkingSnapshot;catalog?:Catalog;error?:string};
export function WorkingOverview({onGoto}:{onGoto?:(page:'workspace'|'clients'|'records'|'guide')=>void}){
  const base=useMemo<DataArea<ClientRecord>>(()=>({key:'clients',title:'Client',wired:false,pendingReason:[],draftEndpoints:[],pollIntervalMs:10000}),[]);
  const area=useDeliveryArea(base,()=>createRoClientsRead(),(conn:RuntimeConnection)=>createClientsRead(conn));
  const clients=usePollingArea(area),devices=useDevicesReadView();
  const visible=clients.rows.filter(c=>!isRevokedClient(c));
  const [states,setStates]=useState<Record<string,ReadState>>({}),[catalogError,setCatalogError]=useState('');
  const currentClients=useRef(visible);currentClients.current=visible;
  const clientKey=visible.map(c=>c.clientId+':'+c.online).sort().join('|');
  useEffect(()=>{
    if(!clientKey)return;
    const ctl=new AbortController();let timer:ReturnType<typeof setTimeout>;setStates({});
    const load=async()=>{
      try{
        const {items}=await lab<{items:Catalog[]}>('catalog',undefined,ctl.signal);
        if(ctl.signal.aborted)return;
        setCatalogError('');
        await Promise.all(currentClients.current.filter(c=>c.online==='online').map(async client=>{
          const catalog=items.find(c=>c.clientId===client.clientId);
          const request=new AbortController(),abort=()=>request.abort();ctl.signal.addEventListener('abort',abort,{once:true});
          const timeout=setTimeout(()=>request.abort(Error('读取工作状态超时')),30000);
          try{
            if(!catalog)throw Error('电脑尚未上报设备组');
            const snapshot=await readWorkingGroups(catalog,request.signal);
            if(!ctl.signal.aborted)setStates(old=>({...old,[client.clientId]:{snapshot,catalog}}));
          }catch(e){if(!ctl.signal.aborted)setStates(old=>({...old,[client.clientId]:{error:request.signal.aborted?'读取工作状态超时':(e as Error).message}}));}
          finally{clearTimeout(timeout);ctl.signal.removeEventListener('abort',abort);}
        }));
      }catch(e){if(!ctl.signal.aborted){setCatalogError((e as Error).message);setStates({});}}
      finally{if(!ctl.signal.aborted)timer=setTimeout(load,5000);}
    };
    void load();return()=>{ctl.abort();clearTimeout(timer);};
  },[clientKey]);
  const confirmed=visible.filter(c=>c.online==='online'&&states[c.clientId]?.snapshot);
  const working=confirmed.flatMap(c=>states[c.clientId].snapshot!.groups);
  const tasks=confirmed.flatMap(c=>[...states[c.clientId].snapshot!.groups.flatMap(g=>g.tasks),...states[c.clientId].snapshot!.unmatched]);
  const ready=clients.status==='ready'||clients.status==='empty';
  const allConfirmed=ready&&!catalogError&&visible.every(c=>c.online==='offline'||!!states[c.clientId]?.snapshot);
  const deviceRows=devices.state.kind==='confirmed'?devices.rows:[];
  return <section className="working-overview">
    <PageHeaderActions><a href="#/devices">管理设备 →</a></PageHeaderActions>
    <div className="working-summary" aria-label="实验室工作摘要"><span><b>{ready?visible.filter(c=>c.online==='online').length:'—'}</b> 台电脑在线</span><span><i className="working-dot"/><b>{allConfirmed?working.length:'—'}</b> 个设备组工作中</span><span><b>{allConfirmed?tasks.length:'—'}</b> 个任务执行中</span><small>自动更新</small></div>
    {(!ready||clients.error)&&<p role="status">{clients.error?'电脑状态读取失败：'+clients.error:'正在读取实验室电脑…'}</p>}
    {catalogError&&<p role="alert">工作状态暂不可用：{catalogError}</p>}
    {ready&&!visible.length&&<div className="working-empty"><h3>尚未接入电脑</h3><button onClick={()=>onGoto?.('guide')}>接入电脑</button></div>}
    <div className="working-computers">{visible.map(c=>{
      const state=states[c.clientId],snapshot=c.online==='online'&&ready?state?.snapshot:undefined;
      return <article className={`working-computer${snapshot?.groups.length?' has-work':''}`} key={c.clientId} data-testid={`ov-client-${c.clientId}`}>
        <header className="working-computer-head"><span className="working-machine" aria-hidden="true">▰</span><h2>{c.displayName}</h2><OnlineBadge presence={c.online??'unknown'}/><span className="working-computer-state">{c.online!=='online'?'工作状态未知':snapshot?snapshot.groups.length?`${snapshot.groups.length} 组工作中`:snapshot.unmatched.length?'任务设备组待确认':'空闲':state?.error?'状态读取失败':'正在核对任务…'}</span></header>
        {c.online==='online'&&state?.error&&<p role="alert" className="working-read-error">{state.error}，稍后自动重试</p>}
        {snapshot?.unmatched.map(t=><p className="working-unmatched" key={t.id}><a href={nativeTaskLink(c.clientId,t.id)}>{t.name}</a> 正在执行，尚未匹配到唯一设备组 · <a href="#/devices">查看设备配置</a></p>)}
        {snapshot?.groups.map(({group,tasks})=>{return <section className="working-group" key={group.groupId} aria-label={group.alias||group.name}>
          <header className="working-group-head"><h3><i className="working-dot"/>{group.alias||group.name}</h3><span>工作中</span></header>
          <div className="working-task-lines">{tasks.map(t=><a href={nativeTaskLink(c.clientId,t.id)} key={t.id}><span>{t.name}</span><small>{t.status==='stopping'?'正在停止':t.total!=null?`${t.completed??0} / ${t.total} 用例`:'执行中'} ↗</small></a>)}</div>
          <DeviceGroupScreens clientId={c.clientId} mediaCapable={c.capabilities?.media===true} devices={[...group.members].sort((a,b)=>Number(b.role==='phone')-Number(a.role==='phone')).map(m=>{const d=deviceRows.find(d=>d.clientId===c.clientId&&d.deviceId===m.deviceId),definition=state.catalog?.devices.find(d=>d.deviceId===m.deviceId);return {deviceId:m.deviceId,role:m.role,name:d?.deviceName||definition?.name||m.deviceId,online:d?d.status==='online'?true:d.status==='offline'?false:null:null}})}/>

        </section>})}
      </article>;
    })}</div>
  </section>;
}
