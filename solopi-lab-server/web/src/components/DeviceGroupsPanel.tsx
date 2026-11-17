import {PageHeaderActions} from './PageHeaderActions';
import {useEffect,useRef,useState} from 'react';
import {lab,type Catalog} from '../api/lab';
type Group=Catalog['groups'][number];
type Request={requestId:string;clientId:string;tool:string;args:any};
const pendingKey='solopi.lab.deviceGroup.pending.v1';
export function DeviceGroupsPanel(){
 const [catalogs,setCatalogs]=useState<Catalog[]>([]),[clientId,setClientId]=useState('');
 const [name,setName]=useState(''),[alias,setAlias]=useState(''),[code,setCode]=useState(''),[enabled,setEnabled]=useState(true);
 const [roles,setRoles]=useState<Record<string,string>>({}),[editing,setEditing]=useState<Group|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[open,setOpen]=useState(false);
 const pending=useRef<Request|null>(null),locked=useRef(false),mounted=useRef(true);
 const load=async()=>{const {items}=await lab<{items:Catalog[]}>('catalog');if(mounted.current){setCatalogs(items);setClientId(old=>items.some(c=>c.clientId===old)?old:items[0]?.clientId||'');}};
 useEffect(()=>{mounted.current=true;try{const raw=localStorage.getItem(pendingKey);if(raw){const request=JSON.parse(raw) as Request;if(request.tool!=='save_device_group'||!request.requestId||!request.clientId||!request.args||!Array.isArray(request.args.members))throw Error('保存记录无效，请联系维护者核对。');pending.current=request;setClientId(request.clientId);setName(request.args.name||'');setAlias(request.args.alias||'');setCode(request.args.code||'');setEnabled(request.args.enabled!==false);setRoles(Object.fromEntries(request.args.members.map((m:any)=>[m.deviceId,m.role])));setOpen(true);setNotice('上次保存结果待核对，请继续查询原请求。');}}catch(e){setError((e as Error).message);}void load().catch(e=>{if(mounted.current)setError(e.message);});return()=>{mounted.current=false;};},[]);
 const catalog=catalogs.find(c=>c.clientId===clientId),frozen=busy||!!pending.current;
 const edit=(c:Catalog,g?:Group)=>{if(frozen)return;setClientId(c.clientId);setEditing(g||null);setName(g?.name||'');setAlias(g?.alias||'');setCode(g?.code||'');setEnabled(g?.enabled!==false);setRoles(Object.fromEntries(g?.members.map(m=>[m.deviceId,m.role])||[]));setOpen(true);setError('');setNotice('');};
 const save=async()=>{
  if(locked.current)return;locked.current=true;setBusy(true);setError('');setNotice('');
  const request=pending.current||{requestId:crypto.randomUUID(),clientId,tool:'save_device_group',args:{...(editing?{groupId:editing.groupId}:{}),expectedRevision:editing?.revision||0,name:name.trim(),alias:alias.trim(),code:code.trim(),enabled,confirm:true,members:Object.entries(roles).filter(([,role])=>role).map(([deviceId,role])=>({deviceId,role}))}};
  const resume=!!pending.current;
  try{
   if(!resume)localStorage.setItem(pendingKey,JSON.stringify(request));
   pending.current=request;
   // A retry only reads the original receipt. It never sends a second mutation.
   if(!resume)await lab('commands',request);
   for(let i=0;i<20;i++){
    const r=await lab<{status:string;result?:{success?:boolean;error?:string;errorCode?:string;group?:Group}}>('commands/'+request.requestId);
    if(['succeeded','failed'].includes(r.status)){
     localStorage.removeItem(pendingKey);pending.current=null;
     if(r.status==='failed'||r.result?.success===false){await load();throw Error(r.result?.errorCode==='GROUP_REVISION_CONFLICT'?'设备组已被更新。请刷新并重新编辑。':r.result?.errorCode==='GROUP_BUSY'?'该设备组正在执行或核对任务，收尾后再编辑。':r.result?.error||r.result?.errorCode||'设备组未能保存');}
     await load();if(mounted.current){const saved=r.result?.group;if(saved)setCatalogs(rows=>rows.map(c=>c.clientId!==request.clientId?c:{...c,groups:c.groups.some(g=>g.groupId===saved.groupId)?c.groups.map(g=>g.groupId===saved.groupId&&g.revision<=saved.revision?saved:g):[...c.groups,saved]}));setOpen(false);setEditing(null);setNotice('设备组已保存到目标电脑。');}return;
    }
    await new Promise(resolve=>setTimeout(resolve,500));
   }
   if(mounted.current)setError('电脑尚未返回保存结果。请用“核对原请求”继续查询。');
  }catch(e){if(mounted.current)setError((e as Error).message);}finally{locked.current=false;if(mounted.current)setBusy(false);}
 };
 const selected=Object.entries(roles).filter(([,role])=>role),valid=selected.length>0&&new Set(selected.map(([,role])=>role)).size===selected.length;
 return <section className="execution-create device-group-settings">
  <PageHeaderActions><div><button disabled={frozen} onClick={()=>void load().catch(e=>setError(e.message))}>刷新</button><button disabled={frozen||!catalogs.length} onClick={()=>catalog&&edit(catalog)}>＋ 创建设备组</button></div></PageHeaderActions>
  {catalogs.map(c=><div key={c.clientId}><h3>{c.hostname}</h3>{!c.groups.length&&<p>暂无设备组</p>}<div className="dg-table-wrap"><table><thead><tr><th>别名 / 名称</th><th>设备组标识</th><th>手机</th><th>眼镜</th><th>状态</th><th>操作</th></tr></thead><tbody>{c.groups.map(g=><tr key={g.groupId}><td><strong>{g.alias||g.name}</strong>{g.alias&&<small>{g.name}</small>}</td><td><code>{g.code||g.groupId}</code></td>{['phone','glasses'].map(role=>{const member=g.members.find(m=>m.role===role),d=c.devices.find(d=>d.deviceId===member?.deviceId);return <td key={role}>{d?.name||'未连接设备'}<small>{d?.serial||member?.deviceId||'未配置'}</small></td>;})}<td><span className={'dg-state '+(g.enabled===false?'off':'on')}>{g.enabled===false?'已停用':'已启用'}</span></td><td><button disabled={frozen} onClick={()=>edit(c,g)}>编辑</button></td></tr>)}</tbody></table></div></div>)}
  {open&&<form className="dg-editor" onSubmit={e=>{e.preventDefault();void save();}}><h3>{editing?'编辑设备组':'创建设备组'}</h3><label>所属电脑<select disabled={frozen||!!editing} value={clientId} onChange={e=>{setClientId(e.target.value);setRoles({});}}>{catalogs.map(c=><option key={c.clientId} value={c.clientId}>{c.hostname}</option>)}</select></label><div className="dg-fields"><label>组名称<input required maxLength={128} disabled={frozen} value={name} onChange={e=>setName(e.target.value)}/></label><label>别名<input aria-label="设备组别名" placeholder="例如：1号坑" maxLength={128} disabled={frozen} value={alias} onChange={e=>setAlias(e.target.value)}/></label><label>业务标识<input aria-label="设备组业务标识" placeholder="例如：hangzhou-rokid-hz111" maxLength={128} disabled={frozen} value={code} onChange={e=>setCode(e.target.value)}/></label></div><label className="dg-enabled"><input type="checkbox" disabled={frozen} checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>启用设备组</label><p>请按实体配对指定设备类型，每种类型最多一台。</p><div className="dg-fields">{catalog?.devices.map(d=><label key={d.deviceId}>{d.name}<small>{d.serial||d.deviceId}</small><select aria-label={(d.serial||d.name)+'的设备类型'} disabled={frozen} value={roles[d.deviceId]||''} onChange={e=>setRoles(x=>({...x,[d.deviceId]:e.target.value}))}><option value="">不加入</option><option value="phone">手机</option><option value="glasses">眼镜</option></select></label>)}</div>{editing&&editing.members.some(m=>!catalog?.devices.some(d=>d.deviceId===m.deviceId))&&<p role="alert">原配对中有设备未连接。请先核对连接，保留的成员不会自动删除。</p>}<div className="dg-toolbar"><button className="primary" disabled={busy||!pending.current&&(!name.trim()||!valid)} type="submit">{busy?'保存中…':pending.current?'核对原请求':'保存设备组'}</button><button type="button" disabled={frozen} onClick={()=>setOpen(false)}>取消</button></div></form>}
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
 </section>;
}
