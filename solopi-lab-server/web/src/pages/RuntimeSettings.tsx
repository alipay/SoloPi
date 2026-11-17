import {useCallback,useEffect,useRef,useState} from 'react';
import {ApiModelSettings} from '@desktop-ui/ApiModelSettings';
import {ModelBackendSettings,type RuntimeApi} from './ModelBackendSettings';
import {serverApi} from './ServerAgent';
import {lab,type Catalog} from '../api/lab';
import {desktopSettings} from '../api/runtime-settings';
const serverRuntime:RuntimeApi=input=>serverApi('runtime-config',input);
function ApiModels({target}:{target:string}){
 const dirty=useRef(false);
 const empty=()=>({id:'',name:'',model:'',baseUrl:'',apiKey:'',protocol:'openai-completions'});
 const [items,setItems]=useState<any[]>([]),[draft,setDraft]=useState<any>(empty),[isNew,setNew]=useState(false),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const refresh=async()=>{const r=target==='server'?await serverApi<any>('api-models'):await desktopSettings(target,'read_configuration',{},AbortSignal.timeout(75000));const next=r.items||r.models||[];setItems(next);const p=next.find((x:any)=>x.id===r.selectedModelId)||next[0];setDraft(p?{...p,apiKey:''}:empty());setNew(!p)};
 useEffect(()=>{let live=true;const run=async()=>{try{const r=target==='server'?await serverApi<any>('api-models'):await desktopSettings(target,'read_configuration',{},AbortSignal.timeout(75000));if(!live)return;const next=r.items||r.models||[];setItems(next);if(dirty.current)return;const p=next.find((x:any)=>x.id===r.selectedModelId)||next[0];setDraft(p?{...p,apiKey:''}:empty());setNew(!p)}catch(e){if(live)setMessage((e as Error).message)}};void run();return()=>{live=false}},[target]);
 const save=async()=>{setBusy(true);setMessage('');try{if(target==='server')await serverApi('api-models',draft);else await desktopSettings(target,'save_configuration',{model:{id:draft.id||crypto.randomUUID(),name:draft.name,model:draft.model,baseUrl:draft.baseUrl}},AbortSignal.timeout(75000));await refresh();setMessage('已保存')}catch(e){setMessage((e as Error).message)}finally{setBusy(false)}};
 return <ApiModelSettings items={items} draft={draft} isNew={isNew} busy={busy} message={message} onChange={patch=>{dirty.current=true;setDraft((d:any)=>({...d,...patch}))}} onAdd={()=>{dirty.current=true;setDraft(empty());setNew(true)}} onSelect={id=>{setDraft({...items.find(x=>x.id===id),apiKey:''});setNew(false)}} onSave={()=>void save()} onDelete={target==='server'?()=>{setBusy(true);void serverApi('api-models',{operation:'delete',id:draft.id}).then(refresh).catch(e=>setMessage(e.message)).finally(()=>setBusy(false))}:undefined} credentialsEditable={target==='server'} anthropic={target==='server'}/>;
}
function HostSettings({target,host}:{target:string;host:string}){
 const api=useCallback<RuntimeApi>(input=>target==='server'?serverRuntime(input):desktopSettings(target,'agent_runtime_config',input,AbortSignal.timeout(75000)),[target]);
 return <ModelBackendSettings api={api} hostLabel={host}><ApiModels target={target}/></ModelBackendSettings>
}
export function RuntimeSettings(){
 const initial=new URLSearchParams(location.hash.split('?')[1]||'').get('clientId')||'server';
 const [target,setTarget]=useState(initial),[people,setPeople]=useState<Catalog[]>([]),[error,setError]=useState('');
 useEffect(()=>{const c=new AbortController();void lab<{items:Catalog[]}>('catalog',undefined,c.signal).then(r=>setPeople(r.items)).catch(e=>{if(!c.signal.aborted)setError(e.message)});return()=>c.abort()},[]);
 const host=target==='server'?'Server 所在电脑':people.find(x=>x.clientId===target)?.hostname||'所选电脑';
 return <section className="settings-page"><label className="config-target">配置目标<select aria-label="配置目标" value={target} onChange={e=>{setTarget(e.target.value);history.replaceState(null,'','#/settings/runtime'+(e.target.value==='server'?'':'?clientId='+encodeURIComponent(e.target.value)))}}><option value="server">Server · Superagent</option>{people.map(p=><option key={p.clientId} value={p.clientId}>{p.hostname} · Desktop{Date.now()-p.updatedAt>=30000?'（离线）':''}</option>)}</select></label>{error&&<p role="alert">{error}</p>}<div className="model-target-settings" key={target}><HostSettings target={target} host={host}/></div></section>
}
