import { useEffect, useRef, useState } from 'react';
import type { AgentMessage } from './agent-turns';
type Attachment = NonNullable<AgentMessage['attachments']>[number];
export type AttachmentImageLoader=(attachment:Attachment)=>Promise<{success?:boolean;dataUrl?:string;error?:string}>;
function ImageAttachment({ attachment,loadImage }: { attachment: Attachment;loadImage?:AttachmentImageLoader }) {
  const target = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [thumbnail, setThumbnail] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState('');
  const [previewError, setPreviewError] = useState('');
  useEffect(() => {
    if (!target.current || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '200px' });
    observer.observe(target.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    const api = window.glassbox?.ipcRenderer;
    if (!api&&!loadImage) { setUnavailable(true); return; }
    void (loadImage?loadImage(attachment):api!.invoke('file:read-image-data-url', { path: attachment.path, maxDimension: 384 })).then((r: {success?: boolean; dataUrl?: string}) => {
      if (!live) return;
      if (r.success && r.dataUrl) setThumbnail(r.dataUrl); else setUnavailable(true);
    }).catch(() => { if (live) setUnavailable(true); });
    return () => { live = false; };
  }, [visible, attachment.path,loadImage]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setPreviewError('');
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', escape);
    const api = window.glassbox?.ipcRenderer;
    if (!api&&!loadImage) setPreviewError('当前环境无法读取图片');
    else void (loadImage?loadImage(attachment):api!.invoke('file:read-image-data-url', attachment.path)).then((r: {success?: boolean; dataUrl?: string; error?: string}) => {
      if (!live) return;
      if (r.success && r.dataUrl) setFull(r.dataUrl);
      else setPreviewError(r.error || '图片无法读取');
    }).catch((error: unknown) => { if (live) setPreviewError(error instanceof Error ? error.message : '图片无法读取'); });
    return () => { live = false; setFull(''); window.removeEventListener('keydown', escape); };
  }, [open, attachment.path,loadImage]);
  return <div ref={target} className="mt-2">
    <button type="button" aria-label={`查看图片 ${attachment.name}`} onClick={() => setOpen(true)} className="overflow-hidden rounded-xl border border-slate-300 bg-white p-1 text-left hover:border-blue-400 focus-visible:outline-blue-500">
      {thumbnail && !unavailable ? <img src={thumbnail} alt={attachment.name} loading="lazy" onError={() => setUnavailable(true)} className="max-h-40 max-w-60 rounded-lg object-contain" /> : <span className="block p-3 text-xs text-slate-500">{unavailable ? '图片不可用' : '加载图片…'} · {attachment.name}</span>}
    </button>
    {open && <div role="dialog" aria-modal="true" aria-label={`图片预览 ${attachment.name}`} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-8" onClick={() => setOpen(false)}>
      <button type="button" autoFocus aria-label="关闭图片预览" className="absolute right-5 top-5 rounded-lg bg-white px-3 py-2 text-sm text-slate-800" onClick={() => setOpen(false)}>关闭</button>
      {previewError && <p role="alert" className="rounded-lg bg-white p-4 text-sm text-red-700">{previewError}</p>}
      {!full && !thumbnail && !previewError && <p className="text-white">正在加载图片…</p>}
      {!previewError && (full || thumbnail) && <img src={full || thumbnail} alt={attachment.name} className="max-h-full max-w-full object-contain" onClick={event => event.stopPropagation()} onError={() => setPreviewError('图片无法显示')} />}
    </div>}
  </div>;
}
function FileAttachment({ attachment }: { attachment: Attachment }) {
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  const reveal = async () => {
    setError('');
    setOpening(true);
    try {
      const api = window.glassbox?.ipcRenderer;
      if (!api) throw new Error('当前环境无法打开文件夹');
      const result = await api.invoke('shell:show-item-in-folder', attachment.path) as { success?: boolean; error?: string };
      if (!result.success) throw new Error(result.error || '无法定位文件');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法定位文件');
    } finally { setOpening(false); }
  };
  return <div className="mt-2">
    <button type="button" disabled={opening} aria-label={`在文件夹中显示 ${attachment.name}`} title="打开所在文件夹并选中文件" onClick={() => void reveal()} className="rounded-lg border border-slate-300 px-3 py-2 text-left text-xs hover:border-blue-400 hover:bg-white/60 focus-visible:outline-blue-500 disabled:opacity-50">文件 · {attachment.name} · {Math.ceil(attachment.size / 1024)} KB</button>
    {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
  </div>;
}
export default function AgentMessageAttachments({ attachments,loadImage }: { attachments?: AgentMessage['attachments'];loadImage?:AttachmentImageLoader }) {
  return <div className="flex flex-wrap gap-2">{attachments?.map(a => a.mime.startsWith('image/')
    ? <ImageAttachment key={a.id} attachment={a} loadImage={loadImage}/>
    : <FileAttachment key={a.id} attachment={a} />)}</div>;
}
