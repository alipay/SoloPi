import {useState} from 'react';
import {MediaViewerPanel} from './MediaViewerPanel';
type ScreenDevice={deviceId:string;role:string;name?:string;online:boolean|null};
export function DeviceGroupScreens({clientId,devices,mediaCapable}:{clientId:string;devices:ScreenDevice[];mediaCapable:boolean}){
 const [requested,setFocused]=useState<string>();
 const focused=devices.some(d=>d.deviceId===requested)?requested:undefined;
 return <div className={`working-screen-grid${focused?' is-focused':''}`}>
 {devices.map(m=><article className={`working-device ${m.role}`} key={m.deviceId} hidden={Boolean(focused&&focused!==m.deviceId)}><header><span>{m.role==='phone'?'手机':'眼镜'}</span><strong>{m.name}</strong><button type="button" className="working-device-focus" aria-label={focused===m.deviceId?'恢复双画面':`只显示${m.role==='phone'?'手机':'眼镜'}`} title={focused===m.deviceId?'恢复双画面':`只显示${m.role==='phone'?'手机':'眼镜'}`} aria-pressed={focused===m.deviceId} onClick={()=>setFocused(value=>value===m.deviceId?undefined:m.deviceId)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{focused===m.deviceId?<><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/></>:<><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><path d="m3 3 6 6m12-6-6 6M3 21l6-6m12 6-6-6"/></>}</svg></button></header><MediaViewerPanel clientId={clientId} deviceId={m.deviceId} deviceName={m.name} deviceOnline={m.online} mediaCapable={mediaCapable} autoStart compact showZoomControl={false}/></article>)}
 </div>;
}
