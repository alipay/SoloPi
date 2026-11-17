import { useEffect, useState } from 'react';
import type { createReportThumbnailStore } from '../lib/report-thumbnail-store';

type Store = ReturnType<typeof createReportThumbnailStore>;
type Invoke = (channel: string, request: { path: string; maxDimension: number }) => Promise<unknown>;
export default function ReportScreenshot({ path, index, store, invoke }: {
  path: string; index: number; store: Store; invoke?: Invoke;
}) {
  const [url, setUrl] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [decoded, setDecoded] = useState(false);
  useEffect(() => {
    setUrl(''); setLoaded(false); setDecoded(false);
    if (!invoke) { setLoaded(true); return; }
    let cancelled = false;
    const unsubscribe = store.subscribe(path, async imagePath => (
      await invoke('file:read-image-data-url', { path: imagePath, maxDimension: 512 }) as { success?: boolean; dataUrl?: string }
    ), value => { if (!cancelled) { setUrl(value); setLoaded(true); } });
    return () => { cancelled = true; unsubscribe(); };
  }, [path, store, invoke]);
  return <div className="relative flex h-full w-full items-center justify-center" aria-busy={!loaded || Boolean(url && !decoded)}>
    {url && <img src={url} alt={`截图 ${index + 1}`} decoding="async" loading="lazy" onLoad={() => setDecoded(true)} onError={() => { store.imageFailed(path); setUrl(''); setLoaded(true); }} className="h-full w-full object-contain" />}
    {(!url || !decoded) && <div role={loaded && !url ? undefined : 'status'} aria-live="polite" className="absolute inset-0 flex items-center justify-center px-3 text-center text-[11px] font-black text-slate-400">{loaded && !url ? '预览暂不可用，点击打开原图' : '正在加载截图…'}</div>}
  </div>;
}
