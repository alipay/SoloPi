import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, MousePointer2, X } from 'lucide-react';
import { demoStops, type Demo, type OnboardingDestination } from './OnboardingDemo';

type Rect = {left:number;top:number;width:number;height:number};
export function tooltipPosition(rect:Rect|null,width:number,height:number,panelHeight:number) {
  const cardWidth=Math.min(380,Math.max(0,width-32)),gap=24;
  if(!rect)return {left:Math.max(16,(width-cardWidth)/2),top:Math.max(16,(height-panelHeight)/2),width:cardWidth};
  const right=rect.left+rect.width, bottom=rect.top+rect.height;
  const beside=right+gap+cardWidth<=width-16?right+gap:rect.left-gap-cardWidth>=16?rect.left-gap-cardWidth:null;
  const left=beside??Math.max(16,Math.min(rect.left,width-cardWidth-16));
  const below=height-bottom-gap-16,above=rect.top-gap-16;
  const useBelow=below>=Math.min(panelHeight,above);
  const maxHeight=beside!==null?height-32:Math.max(80,useBelow?below:above);
  const actualHeight=Math.min(panelHeight,maxHeight);
  const idealTop=beside!==null?rect.top:useBelow?bottom+gap:rect.top-actualHeight-gap;
  return {left,top:Math.max(16,Math.min(idealTop,height-actualHeight-16)),width:cardWidth,maxHeight};
}
/** Only the transparent proxy can navigate; the real page remains inert. */
export function OnboardingSpotlight({demo,progress,onNavigate,onNext,onBack,onExit,error,busy=false,nextLabel='下一项'}:{
 demo:Demo;progress:string;onNavigate:(where:OnboardingDestination)=>void;onNext:()=>void;onBack:()=>void;onExit:()=>void;error?:string;busy?:boolean;nextLabel?:string;
}) {
  const stops=useMemo(()=>demoStops(demo),[demo]);const [index,setIndex]=useState(0);
  const [rect,setRect]=useState<Rect|null>(null),[missing,setMissing]=useState(false),[retry,setRetry]=useState(0);
  const [viewport,setViewport]=useState({width:window.innerWidth,height:window.innerHeight}),[panelHeight,setPanelHeight]=useState(360);
  const panel=useRef<HTMLDivElement>(null),navigate=useRef(onNavigate);navigate.current=onNavigate;
  const maskId=useId().replace(/:/g,'');const stop=stops[index];
  const [arrived,setArrived]=useState(false);
  useEffect(()=>{setArrived(false);},[stop]);
  useLayoutEffect(()=>{
    const el=panel.current;if(!el)return;
    el.focus();const observer=new ResizeObserver(()=>setPanelHeight(el.getBoundingClientRect().height));observer.observe(el);return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    setRect(null);setMissing(false);let target:HTMLElement|null=null,frame=0,missingTimer:ReturnType<typeof setTimeout>|undefined;
    const unavailable=()=>{setRect(null);if(!missingTimer)missingTimer=setTimeout(()=>setMissing(true),2500);};
    const resizeObserver=new ResizeObserver(()=>schedule());
    const measure=()=>{
      frame=0;const next=document.querySelector<HTMLElement>(`[data-onboarding-target="${stop.target}"]`);
      if(next!==target){resizeObserver.disconnect();target=next;if(target){target.scrollIntoView({block:'nearest',inline:'nearest'});resizeObserver.observe(target);}}
      if(!target){unavailable();return;}
      const r=target.getBoundingClientRect();
      if(r.width<=0||r.height<=0||r.bottom<=0||r.top>=window.innerHeight||r.right<=0||r.left>=window.innerWidth){unavailable();return;}
      const left=Math.max(4,r.left-5),top=Math.max(4,r.top-5);
      const value={left,top,width:Math.min(window.innerWidth-4,r.right+5)-left,height:Math.min(window.innerHeight-4,r.bottom+5)-top};
      setRect(old=>old&&Object.keys(value).every(k=>old[k as keyof Rect]===value[k as keyof Rect])?old:value);setMissing(false);clearTimeout(missingTimer);missingTimer=undefined;
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};
    const resized=()=>{setViewport({width:window.innerWidth,height:window.innerHeight});schedule();};
    const mutationObserver=new MutationObserver(schedule);const root=document.getElementById('root');if(root)mutationObserver.observe(root,{childList:true,subtree:true});
    window.addEventListener('resize',resized);window.addEventListener('scroll',schedule,true);schedule();
    return()=>{clearTimeout(missingTimer);cancelAnimationFrame(frame);resizeObserver.disconnect();mutationObserver.disconnect();window.removeEventListener('resize',resized);window.removeEventListener('scroll',schedule,true);};
  },[stop,retry]);
  const advance=()=>{if(index<stops.length-1){navigate.current(stop.destination);setIndex(index+1);}else if(!arrived){navigate.current(stop.destination);setArrived(true);}else onNext();};
  const position=tooltipPosition(rect,viewport.width,viewport.height,panelHeight);
  return createPortal(<div data-onboarding-spotlight={demo.id} className="fixed inset-0 z-[200]" style={{pointerEvents:'auto'}} onKeyDown={e=>{
    e.stopPropagation();if(e.key==='Escape'){e.preventDefault();if(!busy)onExit();}
    if(e.key==='Tab'){
      const buttons=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const first=buttons[0],last=buttons.at(-1);if((e.shiftKey&&document.activeElement===first)||(!e.shiftKey&&document.activeElement===last)){e.preventDefault();(e.shiftKey?last:first)?.focus();}
    }
  }}>
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true"><defs><mask id={maskId}><rect width="100%" height="100%" fill="white"/>{rect&&<rect x={rect.left} y={rect.top} width={rect.width} height={rect.height} rx="12" fill="black"/>}</mask></defs><rect width="100%" height="100%" fill="rgba(15,23,42,.65)" mask={`url(#${maskId})`}/></svg>
    {rect&&<><button type="button" disabled={busy} aria-label={`演示点击${stop.label}`} onClick={advance} className="absolute rounded-xl border-2 border-blue-400 bg-transparent shadow-[0_0_0_4px_rgba(96,165,250,.25)] focus-visible:outline focus-visible:outline-4 focus-visible:outline-white" style={{left:rect.left,top:rect.top,width:rect.width,height:rect.height}}/><MousePointer2 aria-hidden="true" className="pointer-events-none absolute h-8 w-8 fill-white text-blue-500 drop-shadow-lg" style={{left:Math.min(viewport.width-36,rect.left+rect.width-6),top:Math.min(viewport.height-36,rect.top+rect.height-6)}}/></>}
    <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={`${maskId}-title`} aria-describedby={`${maskId}-description`} data-onboarding-tooltip className="absolute max-h-[calc(100dvh-32px)] overflow-y-auto rounded-2xl border border-blue-100 bg-white p-5 shadow-2xl outline-none" style={position}>
      <button type="button" aria-label="退出演示" disabled={busy} className="absolute right-3 top-3 rounded-lg p-1 text-slate-400 hover:bg-slate-100" onClick={onExit}><X className="h-4 w-4"/></button>
      <p className="pr-6 text-xs font-bold text-blue-600">{progress} · 入口 {index+1}/{stops.length}</p>
      <h3 id={`${maskId}-title`} className="mt-2 text-lg font-bold text-slate-900">{demo.title}</h3>
      <p className="mt-2 text-sm font-bold text-blue-700">{arrived?'已打开':'点击高亮的'}「{stop.label}」</p>
      <p id={`${maskId}-description`} className="mt-2 text-sm leading-6 text-slate-600">{demo.purpose}</p>
      <p className="mt-3 rounded-xl bg-blue-50 p-3 text-sm leading-6 text-slate-600">{demo.result}</p>
      <p className="mt-3 text-xs leading-5 text-slate-400">正在展示真实页面。演示点击只切换页面，不修改配置或执行操作。</p>
      {!rect&&<p role="status" className="mt-3 text-sm text-amber-700">{missing?'未找到对应入口，可重试定位或返回引导。':'正在定位页面入口…'}</p>}
      {missing&&!rect&&<button type="button" className="mt-2 text-sm text-blue-600" onClick={()=>{navigate.current(stop.destination);setRetry(n=>n+1);}}>重新定位</button>}
      {error&&<p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-4"><button type="button" disabled={busy} className="text-sm text-slate-500" onClick={index>0?()=>{navigate.current(stops[index-1].destination);setIndex(index-1);}:onBack}>返回</button><button type="button" disabled={busy||!rect} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40" onClick={advance}>{index<stops.length-1?'下一处':!arrived?'查看页面':nextLabel}<ArrowRight className="h-4 w-4"/></button></div>
    </div>
  </div>,document.body);
}
