import {DeviceGroupsPanel} from './DeviceGroupsPanel';
import {Overview} from '../pages/Overview';
export function DeviceWorkspace({screens=false}:{screens?:boolean}){return <section className="device-workspace" aria-label="设备管理"><nav className="workspace-sections" aria-label="设备管理视图"><a href="#/devices/groups" aria-current={!screens?'page':undefined}>设备组配置</a><a href="#/devices/screens" aria-current={screens?'page':undefined}>设备屏幕</a></nav>{screens?<Overview deviceHub/>:<DeviceGroupsPanel/>}</section>;}
