import { useEffect, useRef, useState } from 'react';
import { Loader2, Monitor, Smartphone, RefreshCw } from 'lucide-react';
import { PreviewFeedback } from '@/lib/preview-feedback';
import { H264PreviewDecoder, type H264Batch } from '@/lib/h264-preview';
type Target = { role: 'phone' | 'glasses'; serial: string; taskId: string };
export function DevicePreview({ target, sessionId, embedded = false }:  { target: Target; sessionId: string; embedded?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const [error, setError] = useState('');
  const [fps, setFps] = useState(0);
  const [retry, setRetry] = useState(0);
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const changed = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    let animation = 0;
    let frames = 0;
    const meter = setInterval(() => { setFps(frames); frames = 0; feedback.flush(); }, 1000);
    let videoFrame: VideoFrame | null = null;
    let frameStreamId = '';
    let decoderStreamId = '';
    setHasFrame(false); setError('');
    const api = window.glassbox?.ipcRenderer;
    const acknowledge = (payload: Record<string, unknown>) => void api?.invoke('preview:frame-ack', { ...target, ...payload }).catch(() => {});
    const feedback = new PreviewFeedback(acknowledge);
    const decoder = new H264PreviewDecoder((image, streamId) => {
      videoFrame?.close(); videoFrame = image; frameStreamId = streamId;
      if (animation) return;
      animation = requestAnimationFrame(() => {
        animation = 0;
        const current = videoFrame; videoFrame = null;
        if (!current) return;
        try {
          const element = canvas.current;
          if (live && element) {
            if (element.width !== current.displayWidth) element.width = current.displayWidth;
            if (element.height !== current.displayHeight) element.height = current.displayHeight;
            const context = element.getContext('2d', { alpha: false });
            if (!context) throw Error('无法创建视频画布');
            context.drawImage(current, 0, 0);
            frames++; setHasFrame(true); setError('');
            feedback.draw(frameStreamId);
          }
        } catch (error) { if (live) { const message = error instanceof Error ? error.message : String(error); setError(message); acknowledge({streamId:frameStreamId,error:message}); } } finally { current.close(); }
      });
    }, error => { if (live) { setError(error.message); acknowledge({streamId:decoderStreamId,error:error.message}); } });
    const frame = (_event: unknown, payload: Target & Partial<H264Batch> & { sessionId: string; status?: string; error?: string }) => {
      if (!live || payload.sessionId !== sessionId || payload.taskId !== target.taskId || payload.role !== target.role || payload.serial !== target.serial) return;
      if (payload.format !== 'h264-annexb') { setError(payload.status === 'connecting' ? '视频准备较慢，仍在连接…' : payload.error || ''); return; }
      decoderStreamId = payload.streamId || '';
      feedback.reset(decoderStreamId);
      void decoder.push(payload as H264Batch).then(() => {
        if (live) feedback.ack(payload.frameId!, payload.streamId!);
      }).catch(error => {
        if (live) { setError(error.message); acknowledge({ streamId: payload.streamId, error: error.message }); }
      });
    };
    api?.on('agent:mirror-frame', frame);
    void api?.invoke(embedded ? 'preview:start' : 'agent:mirror-start', { id: sessionId, ...target }).then((r: { success?: boolean; error?: string }) => {
      if (live && !r?.success) setError('无法启动投屏，请查看诊断日志。');
    }).catch(() => { if (live) setError('无法启动投屏，请查看诊断日志。'); });
    return () => { live = false; clearInterval(meter); cancelAnimationFrame(animation); videoFrame?.close(); decoder.close(); api?.removeListener('agent:mirror-frame', frame); void api?.invoke(embedded ? 'preview:stop' : 'agent:mirror-stop', { id: sessionId, ...target, force: document.hidden }); };
  }, [sessionId, target.role, target.serial, target.taskId, embedded, retry, visible]);
  return <section className="flex-1 min-h-0 flex flex-col rounded-xl border border-slate-200 bg-white overflow-hidden">
    <header className="flex items-center gap-2 px-3 py-2.5 text-xs border-b border-slate-100">{target.role === 'phone' ? <Smartphone size={14} /> : <Monitor size={14} />}<span>{target.role === 'phone' ? '手机' : '眼镜'}</span><span className="ml-auto shrink-0 text-slate-400" title="实际绘制帧率；静止画面可能没有新帧">{fps} FPS</span><span className="text-slate-400 truncate" title={target.serial}>{target.serial}</span></header>
    <div className="relative flex-1 min-h-0 flex items-center justify-center bg-slate-950 p-2">
      <canvas ref={canvas} aria-label={`${target.role === 'phone' ? '手机' : '眼镜'}实时画面`} className={`w-full h-full object-contain ${hasFrame ? '' : 'invisible'}`} />
      {(!hasFrame || error) && <div role="status" className="absolute inset-0 flex items-center justify-center p-4 text-xs text-center text-slate-400 bg-slate-950/80"><div>{error || <span><Loader2 className="animate-spin mx-auto mb-2" size={18} />连接画面…</span>}{error && <button type="button" className="mt-3 mx-auto flex items-center gap-1 rounded border border-slate-600 px-3 py-1.5 text-slate-200" onClick={() => setRetry(value => value + 1)}><RefreshCw size={12} />重新连接</button>}</div></div>}
    </div>
  </section>;
}
export default function AgentMirrors({ sessionId }: { sessionId: string }) {
  const [targets, setTargets] = useState<Target[]>([]);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const api = window.glassbox?.ipcRenderer;
    setTargets([]);
    const refresh = async () => {
      try { const r = await api?.invoke('agent:mirror-targets', { id: sessionId }); if (live) setTargets(r?.targets || []); }
      catch { if (live) setTargets([]); }
      if (live) timer = setTimeout(refresh, 1000);
    };
    void refresh();
    return () => { live = false; clearTimeout(timer); void api?.invoke('agent:mirror-stop', { id: sessionId }); };
  }, [sessionId]);
  if (!targets.length) return null;
  // One phone and one glasses panel, from the newest active task in this conversation.
  const panels = targets.filter(t => t.taskId === targets[targets.length - 1].taskId);
  return <aside aria-label="设备投屏" className="w-[28%] min-w-[220px] max-w-[380px] shrink-0 border-l border-slate-200 bg-slate-50 p-3 flex flex-col gap-3 min-h-0">
    <div className="text-xs text-slate-500">设备画面 <span className="text-slate-400">· scrcpy</span></div>
    {panels.map(t => <DevicePreview key={`${t.taskId}:${t.role}:${t.serial}`} target={t} sessionId={sessionId} />)}
  </aside>;
}
