import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { DevicePreview } from './AgentMirrors';
type Target = { role: 'phone' | 'glasses'; serial: string; taskId: string };
export default function WorkflowMirrors() {
  const [targets, setTargets] = useState<Target[]>([]);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try { const r = await window.glassbox?.ipcRenderer.invoke('preview:targets'); if (live) setTargets(r?.targets || []); }
      catch { if (live) setTargets([]); }
      if (live) timer = setTimeout(refresh, 500);
    };
    void refresh();
    return () => { live = false; clearTimeout(timer); void window.glassbox?.ipcRenderer.invoke('preview:stop'); };
  }, []);
  if (!targets.length) return null;
  return <aside aria-label="运行设备投屏" className="w-[28%] min-w-[220px] max-w-[380px] shrink-0 border-l border-slate-200 bg-slate-50 p-3 flex flex-col gap-3 min-h-0 overflow-y-auto">
    <div className="text-xs text-slate-500">设备画面</div>
    {targets.map(target => <div key={target.taskId} className="relative flex flex-col flex-1 min-h-[200px]">
      <button aria-label="关闭此投屏" title="关闭投屏，不停止任务" className="absolute right-2 top-12 z-10 rounded bg-white/80 p-1" onClick={() => void window.glassbox?.ipcRenderer.invoke('preview:close', target)}><X size={14} /></button>
      <DevicePreview target={target} sessionId="workflow" embedded />
    </div>)}
  </aside>;
}
