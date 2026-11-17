import {useEffect,useState} from 'react';
import {lab,type Catalog} from '../api/lab';
import {firstTaskPage} from '../api/task-navigation';
import {createRoClientsRead} from '../api/readonly-proxy';
import {DeviceGroupScreens} from './DeviceGroupScreens';
import {taskScreenGroup} from '../api/task-screen-group';
export function TaskLiveScreens({clientId,task}:{clientId:string;task:any}){
 const [resolvedTask,setResolvedTask]=useState(task),[catalog,setCatalog]=useState<Catalog>(),[error,setError]=useState(''),[mediaCapable,setMediaCapable]=useState(false),[online,setOnline]=useState<boolean|null>(null);
 useEffect(()=>{const c=new AbortController();setError('');setCatalog(undefined);setMediaCapable(false);setResolvedTask(task);if(!task.groupExecution?.groupId&&!task.group?.groupId&&!Object.values(task.devices||{}).some((d:any)=>d?.serial)){void firstTaskPage(clientId,task.taskId||task.id).then(r=>{if(!c.signal.aborted)setResolvedTask(r.task||r);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});}void createRoClientsRead()('',c.signal).then(rows=>{if(c.signal.aborted)return;const client=rows.find(r=>r.clientId===clientId);setMediaCapable(client?.capabilities.media===true);setOnline(client?.online==='offline'?false:null);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});void lab<{items:Catalog[]}>('catalog',undefined,c.signal).then(r=>{const item=r.items.find(c=>c.clientId===clientId);if(!item)throw Error('当前电脑尚未上报设备组');setCatalog(item);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[clientId,task.taskId||task.id]);
 const currentTask={...resolvedTask,...task,devices:task.devices??resolvedTask.devices,groupExecution:task.groupExecution??resolvedTask.groupExecution};
 const devices=Object.entries(currentTask.devices||{}).filter(([,d]:any)=>d?.serial);
 const group=taskScreenGroup(catalog,currentTask);
 const panel = <div className="task-screen-inline" role="region" aria-label="当前设备组实时投屏"><header><div><strong>{group?.alias||group?.name||'当前设备组'}</strong><small>实时画面</small></div></header>{error?<p role="alert">{error}</p>:!catalog?<p role="status">正在读取设备组…</p>:!group?<p role="status">{!devices.length?'该报告没有保存设备组或设备信息，无法确定投屏目标。':'设备组未能唯一匹配，请到设备页核对配对。'}<a href="#/devices">查看设备</a></p>:<DeviceGroupScreens key={clientId+':'+group.groupId} clientId={clientId} mediaCapable={mediaCapable} devices={group.members.map(m=>({deviceId:m.deviceId,role:m.role,name:catalog.devices.find(d=>d.deviceId===m.deviceId)?.name,online}))}/>}</div>;
 return panel;
}
